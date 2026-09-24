import type { GitHubClient } from './github/client';
import { DataSourceError, toErrorMessage, type DataSourceErrorKind } from './github/errors';
import type { CiState, PullRequestSummary } from './github/types';
import { deriveAuthorReviewStatus, type AuthorReviewStatus } from './review-status';
import { myPrKey, reviewRequestKey, type WaitingSince } from './waiting-since';

export type PullRequestRow = PullRequestSummary & {
  ci: CiState | null;
  // レビュー待ちでなければ null
  waitingSince: string | null;
};

export type MyPullRequest = PullRequestRow & { review: AuthorReviewStatus };

export type Snapshot =
  | {
      status: 'ok';
      fetchedAt: string;
      myPrs: MyPullRequest[];
      reviewRequests: PullRequestRow[];
      // 取得は成功したが一部の情報が欠けていることを、利用者に伝えるためのもの
      warnings: string[];
      // 上限件数で切り捨てられた一覧では、載っていない PR が消えたのか溢れただけなのか区別できない
      truncated: { myPrs: boolean; reviewRequests: boolean };
    }
  | {
      status: 'error';
      fetchedAt: string;
      error: { kind: DataSourceErrorKind; message: string; retryAfterSeconds?: number };
      // 制限されたときだけ付く。この時刻までは定期取得を控える
      retryAt?: string;
      waitMinutes?: number;
    };

const MY_PRS_QUERY = 'is:pr author:@me state:open archived:false sort:updated-desc';
const REVIEW_REQUESTS_QUERY = 'is:pr review-requested:@me state:open archived:false sort:updated-desc';

const reviewOf = async (
  client: GitHubClient,
  pr: PullRequestSummary,
  warnings: string[],
): Promise<{ review: AuthorReviewStatus; awaitingReview: boolean }> => {
  const [mergeBox, sidebar] = await Promise.all([
    client.fetchMergeBox(pr.repo, pr.number),
    client.fetchSidebarReviewers(pr.repo, pr.number).catch((e: unknown) => {
      // commented の判定は壊れやすい HTML 解析に頼っているので、失敗しても全体をエラーにはしない
      warnings.push(`${pr.repo}#${pr.number} のコメントレビューを取得できませんでした: ${toErrorMessage(e)}`);
      return null;
    }),
  ]);
  return {
    review: deriveAuthorReviewStatus({
      // 自分の PR の作者は常に自分なので、ログイン名を別途問い合わせずに済む
      me: pr.author,
      opinionatedReviews: mergeBox.opinionatedReviews,
      pendingReviewers: mergeBox.pendingReviewers,
      sidebarReviewers: sidebar,
    }),
    awaitingReview: mergeBox.awaitingReview,
  };
};

export const buildSnapshot = async (
  client: GitHubClient,
  now: () => Date,
  previousWaitingSince: WaitingSince = {},
): Promise<Snapshot> => {
  try {
    const [mine, requested] = await Promise.all([
      client.searchPulls(MY_PRS_QUERY),
      client.searchPulls(REVIEW_REQUESTS_QUERY),
    ]);
    const warnings: string[] = [];
    if (mine.truncated) warnings.push('自分の PR が多すぎるため、一部のみ表示しています');
    if (requested.truncated) warnings.push('レビュー依頼が多すぎるため、一部のみ表示しています');

    const ids = [...mine.items, ...requested.items].map((pr) => pr.id);
    const [ciStates, reviews] = await Promise.all([
      ids.length > 0 ? client.fetchCiStates(ids) : new Map<string, { ci: CiState | null }>(),
      Promise.all(mine.items.map((pr) => reviewOf(client, pr, warnings))),
    ]);
    const fetchedAt = now().toISOString();
    const toRow = (pr: PullRequestSummary, waitingKey: string | null): PullRequestRow => ({
      ...pr,
      ci: ciStates.get(pr.id)?.ci ?? null,
      waitingSince: waitingKey === null ? null : (previousWaitingSince[waitingKey] ?? fetchedAt),
    });

    return {
      status: 'ok',
      fetchedAt,
      myPrs: mine.items.map((pr, i) => {
        const { review, awaitingReview } = reviews[i]!;
        return { ...toRow(pr, awaitingReview ? myPrKey(pr.id) : null), review };
      }),
      // 検索条件が review-requested:@me なので、一覧に居る間はずっと自分のレビュー待ち
      reviewRequests: requested.items.map((pr) => toRow(pr, reviewRequestKey(pr.id))),
      warnings,
      truncated: { myPrs: mine.truncated, reviewRequests: requested.truncated },
    };
  } catch (e) {
    const error =
      e instanceof DataSourceError
        ? {
            kind: e.kind,
            message: e.message,
            ...(e.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: e.retryAfterSeconds }),
          }
        : { kind: 'unknown' as const, message: toErrorMessage(e) };
    return { status: 'error', fetchedAt: now().toISOString(), error };
  }
};
