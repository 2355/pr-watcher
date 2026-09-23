import { describe, expect, it } from 'vitest';
import {
  parseDeferred,
  parseMergeBox,
  parseQueries,
  parseSidebarReviewers,
} from '../src/github/parse';
import { DataSourceError } from '../src/github/errors';
import { fixturesAvailable, loadJson, loadText, rawMergeBox, rawPulls } from './helpers/fixtures';

describe.runIf(fixturesAvailable)('parseQueries', () => {
  it('PR 一覧を表示に必要な項目へ変換する', () => {
    const [raw] = rawPulls('queries-mine.json').results;

    expect(parseQueries(loadJson('queries-mine.json')).items).toEqual([
      {
        id: raw!.id,
        number: raw!.number,
        title: raw!.title,
        url: raw!.permalink,
        repo: raw!.repoNameWithOwner,
        author: raw!.author.displayLogin,
        isDraft: raw!.isDraft,
        updatedAt: raw!.updatedAt,
      },
    ]);
  });

  it('結果が 0 件なら空配列を返す', () => {
    expect(parseQueries(loadJson('queries-empty.json')).items).toEqual([]);
  });

  it('総件数が取得件数を上回るとき truncated になる', () => {
    const raw = rawPulls('queries-list.json');
    const result = parseQueries(loadJson('queries-list.json'));

    expect(raw.totalCount).toBeGreaterThan(raw.results.length);
    expect(result.items).toHaveLength(raw.results.length);
    expect(result.truncated).toBe(true);
  });

  it('全件取得できていれば truncated にならない', () => {
    expect(parseQueries(loadJson('queries-mine.json')).truncated).toBe(false);
  });

  it('想定外の構造ならスキーマエラーにする', () => {
    expect(() => parseQueries({ payload: {} })).toThrow(
      expect.objectContaining({ kind: 'schema' }),
    );
  });
});

describe.runIf(fixturesAvailable)('parseDeferred', () => {
  it('PR ID ごとの CI 状態を返す', () => {
    const raw = (loadJson('deferred.json') as {
      payload: { pullsInboxSurfaceContentDeferredData: { results: { id: string }[] } };
    }).payload.pullsInboxSurfaceContentDeferredData.results;
    const result = parseDeferred(loadJson('deferred.json'));

    expect(result.get(raw[0]!.id)).toEqual({ ci: 'success' });
    expect(result.size).toBe(raw.length);
  });

  it('想定外の構造ならスキーマエラーにする', () => {
    expect(() => parseDeferred({})).toThrow(DataSourceError);
  });
});

describe.runIf(fixturesAvailable)('parseMergeBox', () => {
  it('再レビュー依頼中のレビュアーを pendingReviewers に入れる', () => {
    const raw = rawMergeBox('merge-box-pending-rerequest.json');

    expect(parseMergeBox(loadJson('merge-box-pending-rerequest.json'))).toEqual({
      opinionatedReviews: [],
      pendingReviewers: raw.pendingReviewRequests.map((r) => r.reviewer.login),
    });
  });

  it('approve したレビュアーを返す', () => {
    const [raw] = rawMergeBox('merge-box-approved.json').latestOpinionatedReviews;

    expect(parseMergeBox(loadJson('merge-box-approved.json')).opinionatedReviews).toEqual([
      { login: raw!.author.login, state: 'approved' },
    ]);
  });

  it('changes requested を出したレビュアーを返す', () => {
    const [raw] = rawMergeBox('merge-box-changes-requested.json').latestOpinionatedReviews;

    expect(
      parseMergeBox(loadJson('merge-box-changes-requested.json')).opinionatedReviews,
    ).toEqual([{ login: raw!.author.login, state: 'changes_requested' }]);
  });

  it('想定外の構造ならスキーマエラーにする', () => {
    expect(() => parseMergeBox({ pullRequest: {} })).toThrow(DataSourceError);
  });
});

describe.runIf(fixturesAvailable)('parseSidebarReviewers', () => {
  const assigneeOf = (html: string) =>
    html.match(/aria-label="Select assignees"[\s\S]*?data-assignee-name="([^"]+)"/)?.[1];

  it('レビュアー欄だけを読み、Assignees 欄の人は含めない', () => {
    const html = loadText('sidebar-commented-bot-and-pending.html');
    const result = parseSidebarReviewers(html);

    expect(result.map((r) => r.state)).toEqual(['commented', 'pending']);
    expect(result[0]!.login).toBe('coderabbitai[bot]');
    expect(assigneeOf(html)).toBeDefined();
    expect(result.map((r) => r.login)).not.toContain(assigneeOf(html));
  });

  it('commented と approved を区別する', () => {
    expect(
      parseSidebarReviewers(loadText('sidebar-commented-and-approved.html')).map((r) => r.state),
    ).toEqual(['commented', 'commented', 'approved']);
  });

  it('changes requested を読み取る', () => {
    expect(
      parseSidebarReviewers(loadText('sidebar-changes-requested.html')).map((r) => r.state),
    ).toEqual(['commented', 'changes_requested']);
  });
});

describe('parseSidebarReviewers（構造変化の検知）', () => {
  it('レビュアー欄が見つからなければスキーマエラーにする', () => {
    expect(() => parseSidebarReviewers('<div>no reviewers</div>')).toThrow(
      expect.objectContaining({ kind: 'schema' }),
    );
  });

  it('未知のアイコンならスキーマエラーにする', () => {
    const html =
      '<form id="pull-request-reviewers-form-1"><div><span data-assignee-name="alice"></span>' +
      '<span class="reviewers-status-icon"><svg class="octicon octicon-unknown"></svg></span></div></form>';

    expect(() => parseSidebarReviewers(html)).toThrow(
      expect.objectContaining({ kind: 'schema' }),
    );
  });

  it('レビュアーがいなければ空配列を返す', () => {
    expect(parseSidebarReviewers('<form id="pull-request-reviewers-form-1"></form>')).toEqual([]);
  });
});
