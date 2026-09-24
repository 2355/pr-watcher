import { describe, expect, it } from 'vitest';
import type { GitHubClient } from '../src/github/client';
import type { PullRequestSummary } from '../src/github/types';
import { buildSnapshot } from '../src/snapshot';
import { waitingSinceOf } from '../src/waiting-since';
import { myPr, ok, row } from './helpers/builders';

const summary = (id: string): PullRequestSummary => ({
  id,
  number: 1,
  title: 't',
  url: 'https://github.com/o/r/pull/1',
  repo: 'o/r',
  author: 'me',
  isDraft: false,
  updatedAt: '2026-09-23T00:00:00Z',
});

// fixtures が無くても待ち時間の引き継ぎを確かめられるよう、HTTP ではなくクライアントを差し替える
const stubClient = ({
  mine = [],
  requested = [],
  awaiting = new Set<string>(),
}: {
  mine?: PullRequestSummary[];
  requested?: PullRequestSummary[];
  awaiting?: Set<string>;
}): GitHubClient => ({
  searchPulls: async (query) => ({
    items: query.includes('author:@me') ? mine : requested,
    truncated: false,
  }),
  fetchCiStates: async () => new Map(),
  fetchMergeBox: async (_repo, number) => ({
    opinionatedReviews: [],
    pendingReviewers: [],
    awaitingReview: awaiting.has(String(number)),
  }),
  fetchSidebarReviewers: async () => [],
});

const now = () => new Date('2026-09-23T12:00:00Z');

describe('buildSnapshot: 待ち始めの時刻', () => {
  it('初めて見たレビュー依頼は取得時刻から数え始める', async () => {
    const snapshot = await buildSnapshot(stubClient({ requested: [summary('A')] }), now, {});

    expect(snapshot.status === 'ok' && snapshot.reviewRequests[0]!.waitingSince).toBe('2026-09-23T12:00:00.000Z');
  });

  it('前回までに見ていたレビュー依頼は記録済みの時刻を引き継ぐ', async () => {
    const snapshot = await buildSnapshot(stubClient({ requested: [summary('A')] }), now, {
      'review:A': '2026-09-20T00:00:00.000Z',
    });

    expect(snapshot.status === 'ok' && snapshot.reviewRequests[0]!.waitingSince).toBe('2026-09-20T00:00:00.000Z');
  });

  it('自分の PR はレビュー依頼が残っている間だけ待ち時間を持つ', async () => {
    const snapshot = await buildSnapshot(
      stubClient({ mine: [{ ...summary('A'), number: 1 }, { ...summary('B'), number: 2 }], awaiting: new Set(['1']) }),
      now,
      { 'mine:A': '2026-09-22T00:00:00.000Z', 'mine:B': '2026-09-22T00:00:00.000Z' },
    );

    expect(snapshot.status === 'ok' && snapshot.myPrs.map((pr) => pr.waitingSince)).toEqual([
      '2026-09-22T00:00:00.000Z',
      null,
    ]);
  });

  it('自分の PR とレビュー依頼の記録は混ざらない', async () => {
    const snapshot = await buildSnapshot(stubClient({ requested: [summary('A')] }), now, {
      'mine:A': '2026-09-20T00:00:00.000Z',
    });

    expect(snapshot.status === 'ok' && snapshot.reviewRequests[0]!.waitingSince).toBe('2026-09-23T12:00:00.000Z');
  });
});

describe('waitingSinceOf', () => {
  it('レビュー待ちの PR だけを記録し、待ちが終わった PR は記録から外す', () => {
    expect(
      waitingSinceOf(
        ok({
          myPrs: [myPr({ id: 'A', waitingSince: '2026-09-22T00:00:00Z' }), myPr({ id: 'B', waitingSince: null })],
          reviewRequests: [row({ id: 'C', waitingSince: '2026-09-21T00:00:00Z' })],
        }),
        { 'mine:B': '2026-09-20T00:00:00Z', 'review:D': '2026-09-20T00:00:00Z' },
      ),
    ).toEqual({ 'mine:A': '2026-09-22T00:00:00Z', 'review:C': '2026-09-21T00:00:00Z' });
  });

  it('上限件数で切り捨てられた一覧では、載っていない PR の記録を残す', () => {
    expect(
      waitingSinceOf(
        ok({
          reviewRequests: [row({ id: 'C', waitingSince: '2026-09-21T00:00:00Z' })],
          truncated: { myPrs: false, reviewRequests: true },
        }),
        { 'review:X': '2026-09-01T00:00:00Z', 'mine:Y': '2026-09-01T00:00:00Z' },
      ),
    ).toEqual({ 'review:X': '2026-09-01T00:00:00Z', 'review:C': '2026-09-21T00:00:00Z' });
  });

  it('取得に失敗したときは記録を更新しない', () => {
    expect(
      waitingSinceOf(
        { status: 'error', fetchedAt: '2026-09-23T00:00:00Z', error: { kind: 'network', message: 'x' } },
        { 'review:A': '2026-09-20T00:00:00Z' },
      ),
    ).toBeUndefined();
  });
});
