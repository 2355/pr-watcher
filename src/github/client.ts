import { DataSourceError, toErrorMessage } from './errors';
import { parseDeferred, parseMergeBox, parseQueries, parseSidebarReviewers } from './parse';

const ORIGIN = 'https://github.com';

// Retry-After は秒数か HTTP 日付のどちらかで返ってくる
const parseRetryAfter = (value: string | null): number | undefined => {
  if (value === null || value.trim() === '') return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, Math.ceil((date - Date.now()) / 1000));
};

export type GitHubClient = ReturnType<typeof createGitHubClient>;

// PAT を使わない方針のため、github.com の画面が内部で呼んでいるエンドポイントをログイン Cookie 付きで叩く
export const createGitHubClient = (fetchFn: typeof fetch) => {
  const request = async (path: string, headers: Record<string, string>): Promise<Response> => {
    let res: Response;
    try {
      res = await fetchFn(ORIGIN + path, { credentials: 'include', cache: 'no-store', headers });
    } catch (e) {
      // 見出しはポップアップが種別から出すので、どの種別でも詳細には技術的な原因だけを残す
      throw new DataSourceError('network', toErrorMessage(e));
    }
    if (res.redirected && new URL(res.url).pathname === '/login') {
      throw new DataSourceError('unauthenticated', 'ログイン画面へリダイレクトされました');
    }
    const retryAfterSeconds = parseRetryAfter(res.headers.get('Retry-After'));
    // GitHub は制限時に 429、または Retry-After 付きの 403 を返す
    if (res.status === 429 || (res.status === 403 && retryAfterSeconds !== undefined)) {
      throw new DataSourceError('rate_limited', `${path} が HTTP ${res.status} を返しました`, res.status, retryAfterSeconds);
    }
    if (!res.ok) {
      throw new DataSourceError('http', `${path} が HTTP ${res.status} を返しました`, res.status);
    }
    return res;
  };

  const requestJson = async (path: string, headers: Record<string, string>): Promise<unknown> => {
    const res = await request(path, { Accept: 'application/json', ...headers });
    try {
      return await res.json();
    } catch {
      throw new DataSourceError('schema', `${path} が JSON を返しませんでした`);
    }
  };

  return {
    searchPulls: async (query: string) => {
      try {
        return parseQueries(await requestJson(`/pulls/inbox/queries?filter=${encodeURIComponent(query)}`, {}));
      } catch (e) {
        // 一覧エンドポイントは未ログイン時にログイン画面へリダイレクトせず 404 を返す
        if (e instanceof DataSourceError && e.status === 404) {
          throw new DataSourceError('unauthenticated', 'PR 一覧の取得が HTTP 404 になりました', 404);
        }
        throw e;
      }
    },

    fetchCiStates: async (ids: string[]) => {
      const params = new URLSearchParams({ page: '1' });
      for (const id of ids) params.append('ids[]', id);
      return parseDeferred(await requestJson(`/pulls/inbox/deferred?${params}`, {}));
    },

    fetchMergeBox: async (repo: string, number: number) =>
      // X-Requested-With が無いと 406 になる
      parseMergeBox(
        await requestJson(`/${repo}/pull/${number}/page_data/merge_box`, {
          'X-Requested-With': 'XMLHttpRequest',
        }),
      ),

    fetchSidebarReviewers: async (repo: string, number: number) => {
      const res = await request(`/${repo}/issues/${number}/show_partial?partial=issues%2Fsidebar`, {
        Accept: 'text/html',
      });
      return parseSidebarReviewers(await res.text());
    },
  };
};
