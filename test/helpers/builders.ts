import type { MyPullRequest, PullRequestRow, Snapshot } from '../../src/snapshot';

type OkSnapshot = Extract<Snapshot, { status: 'ok' }>;

export const row = (overrides: Partial<PullRequestRow> = {}): PullRequestRow => ({
  id: 'PR_1',
  number: 1,
  title: 'タイトル',
  url: 'https://github.com/owner/repo/pull/1',
  repo: 'owner/repo',
  author: 'someone',
  isDraft: false,
  updatedAt: '2026-09-23T00:00:00Z',
  ci: 'success',
  waitingSince: null,
  ...overrides,
});

// review は一部のフィールドだけ指定できるよう、既定値にマージする
export const myPr = ({
  review,
  ...overrides
}: Partial<Omit<MyPullRequest, 'review'>> & { review?: Partial<MyPullRequest['review']> } = {}): MyPullRequest => ({
  ...row({ author: 'me', ...overrides }),
  review: { state: 'none', needsFix: false, approved: false, reviewers: [], ...review },
});

export const ok = (overrides: Partial<OkSnapshot> = {}): Snapshot => ({
  status: 'ok',
  fetchedAt: '2026-09-23T07:44:08.018Z',
  myPrs: [],
  reviewRequests: [],
  warnings: [],
  truncated: { myPrs: false, reviewRequests: false },
  ...overrides,
});
