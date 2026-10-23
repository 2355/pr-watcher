import { describe, expect, it } from 'vitest';
import { createGitHubClient } from '../src/github/client';
import { buildSnapshot } from '../src/snapshot';
import { fixturesAvailable, loadJson, loadText, rawMergeBox, rawPulls } from './helpers/fixtures';

type Route = (url: URL, headers: Headers) => Response | undefined;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'text/html' } });

const myPr = () => rawPulls('queries-mine.json').results[0]!;

// 実サーバと同じく、必要なヘッダが無いリクエストには JSON を返さない
const githubRoutes = (overrides: Partial<Record<string, Route>> = {}): Route[] => {
  const { repoNameWithOwner: repo, number } = myPr();
  const routes: Record<string, Route> = {
    myPrs: (url, headers) =>
      url.pathname === '/pulls/inbox/queries' && url.searchParams.get('filter')?.includes('author:@me')
        ? headers.get('Accept') === 'application/json'
          ? json(loadJson('queries-mine.json'))
          : html('<html></html>')
        : undefined,
    reviewRequests: (url) =>
      url.pathname === '/pulls/inbox/queries' &&
      url.searchParams.get('filter')?.includes('review-requested:@me')
        ? json(loadJson('queries-empty.json'))
        : undefined,
    deferred: (url) =>
      url.pathname === '/pulls/inbox/deferred' ? json(loadJson('deferred.json')) : undefined,
    mergeBox: (url, headers) =>
      url.pathname === `/${repo}/pull/${number}/page_data/merge_box`
        ? headers.get('X-Requested-With') === 'XMLHttpRequest'
          ? json(loadJson('merge-box-pending-rerequest.json'))
          : new Response('', { status: 406 })
        : undefined,
    sidebar: (url) =>
      url.pathname === `/${repo}/issues/${number}/show_partial` &&
      url.searchParams.get('partial') === 'issues/sidebar'
        ? html(loadText('sidebar-commented-bot-and-pending.html'))
        : undefined,
  };
  return Object.values({ ...routes, ...overrides }).filter((r): r is Route => r !== undefined);
};

const fakeFetch =
  (routes: Route[]): typeof fetch =>
  async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    if (init?.credentials !== 'include') return json({ error: 'Couldn’t authenticate you' }, 404);
    for (const route of routes) {
      const res = route(url, headers);
      if (res) return res;
    }
    throw new Error(`unexpected request: ${url}`);
  };

const now = () => new Date('2026-09-23T00:00:00Z');

const snapshotWith = (routes: Route[]) =>
  buildSnapshot(createGitHubClient(fakeFetch(routes)), now);

describe.runIf(fixturesAvailable)('buildSnapshot', () => {
  it('自分の PR とレビュー依頼を CI・レビュー状態付きでまとめる', async () => {
    const snapshot = await snapshotWith(githubRoutes());
    const requested = rawMergeBox('merge-box-pending-rerequest.json')
      .pendingReviewRequests.map((r) => r.reviewer.login)
      .filter((login) => !login.endsWith('[bot]'));

    expect(snapshot).toEqual({
      status: 'ok',
      fetchedAt: '2026-09-23T00:00:00.000Z',
      myPrs: [
        expect.objectContaining({
          number: myPr().number,
          repo: myPr().repoNameWithOwner,
          ci: 'success',
          review: { state: 'none', needsFix: false, approved: false, reviewers: requested },
        }),
      ],
      reviewRequests: [],
      warnings: [],
      truncated: { myPrs: false, reviewRequests: false },
    });
  });

  it('レビュー依頼が上限件数を超えていたら警告を付ける', async () => {
    const snapshot = await snapshotWith(
      githubRoutes({
        reviewRequests: (url) =>
          url.searchParams.get('filter')?.includes('review-requested:@me')
            ? json(loadJson('queries-list.json'))
            : undefined,
      }),
    );

    expect(snapshot.status === 'ok' && snapshot.reviewRequests.map((pr) => pr.ci)).toEqual([
      'success',
      'success',
      'success',
    ]);
    expect(snapshot.status === 'ok' && snapshot.warnings).toEqual([
      expect.stringContaining('レビュー依頼'),
    ]);
  });

  it('未ログインならエラー状態 unauthenticated になる', async () => {
    const snapshot = await snapshotWith(
      githubRoutes({
        myPrs: (url) =>
          url.pathname === '/pulls/inbox/queries'
            ? json(loadJson('not-logged-in.json') as object, 404)
            : undefined,
      }),
    );

    expect(snapshot).toEqual({
      status: 'error',
      fetchedAt: '2026-09-23T00:00:00.000Z',
      error: { kind: 'unauthenticated', message: expect.any(String) },
    });
  });

  it('ログイン画面へリダイレクトされたら unauthenticated になる', async () => {
    const snapshot = await snapshotWith([
      (url) => {
        if (url.pathname !== '/pulls/inbox/queries') return undefined;
        const res = html('<html>login</html>');
        Object.defineProperty(res, 'redirected', { value: true });
        Object.defineProperty(res, 'url', { value: 'https://github.com/login?return_to=x' });
        return res;
      },
    ]);

    expect(snapshot.status === 'error' && snapshot.error.kind).toBe('unauthenticated');
  });

  it('通信に失敗したらエラー状態 network になる', async () => {
    const snapshot = await buildSnapshot(
      createGitHubClient(async () => {
        throw new TypeError('Failed to fetch');
      }),
      now,
    );

    expect(snapshot.status === 'error' && snapshot.error).toEqual({
      kind: 'network',
      // 種別ごとの見出しはポップアップ側で出すので、詳細には原因だけを入れる
      message: 'Failed to fetch',
    });
  });

  it('429 が返ったら制限されたとみなし、Retry-After の待ち時間を記録する', async () => {
    const snapshot = await snapshotWith([
      (url) =>
        url.pathname === '/pulls/inbox/queries'
          ? new Response('', { status: 429, headers: { 'Retry-After': '120' } })
          : undefined,
    ]);

    expect(snapshot.status === 'error' && snapshot.error).toMatchObject({
      kind: 'rate_limited',
      retryAfterSeconds: 120,
    });
  });

  it('Retry-After 付きの 403 も制限とみなす', async () => {
    const snapshot = await snapshotWith([
      (url) =>
        url.pathname === '/pulls/inbox/queries'
          ? new Response('', { status: 403, headers: { 'Retry-After': '60' } })
          : undefined,
    ]);

    expect(snapshot.status === 'error' && snapshot.error.kind).toBe('rate_limited');
  });

  it('Retry-After の無い 429 は待ち時間を記録しない', async () => {
    const snapshot = await snapshotWith([
      (url) => (url.pathname === '/pulls/inbox/queries' ? new Response('', { status: 429 }) : undefined),
    ]);

    expect(snapshot.status === 'error' && snapshot.error).toEqual({ kind: 'rate_limited', message: expect.any(String) });
  });

  it('Retry-After の無い 403 は通常の HTTP エラーにする', async () => {
    const snapshot = await snapshotWith([
      (url) => (url.pathname === '/pulls/inbox/queries' ? new Response('', { status: 403 }) : undefined),
    ]);

    expect(snapshot.status === 'error' && snapshot.error.kind).toBe('http');
  });

  it('merge_box の形式が変わっていたらエラー状態 schema になる', async () => {
    const snapshot = await snapshotWith(
      githubRoutes({
        mergeBox: (url) => (url.pathname.endsWith('/merge_box') ? json({ pullRequest: {} }) : undefined),
      }),
    );

    expect(snapshot.status === 'error' && snapshot.error.kind).toBe('schema');
  });

  it('サイドバーを取得できなくても merge_box だけで判定し、警告を付ける', async () => {
    const snapshot = await snapshotWith(
      githubRoutes({
        sidebar: (url) => (url.pathname.endsWith('/show_partial') ? html('', 500) : undefined),
      }),
    );

    expect(snapshot.status).toBe('ok');
    const { repoNameWithOwner: repo, number } = myPr();
    expect(snapshot.status === 'ok' && snapshot.warnings).toEqual([
      `${repo}#${number} のコメントレビューを取得できませんでした: /${repo}/issues/${number}/show_partial?partial=issues%2Fsidebar が HTTP 500 を返しました`,
    ]);
  });

  it('対象の PR が無ければ CI 状態を問い合わせない', async () => {
    const snapshot = await snapshotWith(
      githubRoutes({
        myPrs: (url) =>
          url.searchParams.get('filter')?.includes('author:@me')
            ? json(loadJson('queries-empty.json'))
            : undefined,
        // ルートを消しておくと、問い合わせた時点で unexpected request になり失敗する
        deferred: undefined,
      }),
    );

    expect(snapshot).toMatchObject({ status: 'ok', myPrs: [], reviewRequests: [] });
  });
});
