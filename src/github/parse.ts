import { z } from 'zod';
import { parseDocument } from 'htmlparser2';
import { findAll, findOne, getAttributeValue } from 'domutils';
import type { Element } from 'domhandler';
import { DataSourceError } from './errors';
import type {
  CiState,
  OpinionatedReview,
  PullRequestSummary,
  SidebarReviewer,
  SidebarReviewerState,
} from './types';

const queriesSchema = z.object({
  payload: z.object({
    pullsInboxSurfaceContentRoute: z.object({
      results: z.array(
        z.object({
          id: z.string(),
          number: z.number(),
          title: z.string(),
          permalink: z.string(),
          repoNameWithOwner: z.string(),
          author: z.object({ displayLogin: z.string() }),
          isDraft: z.boolean(),
          updatedAt: z.string(),
        }),
      ),
      pageInfo: z.object({ totalCount: z.number() }),
    }),
  }),
});

const deferredSchema = z.object({
  payload: z.object({
    pullsInboxSurfaceContentDeferredData: z.object({
      results: z.array(
        z.object({
          id: z.string(),
          statusCheckRollup: z
            .object({ state: z.enum(['SUCCESS', 'FAILURE', 'PENDING', 'ERROR', 'EXPECTED']) })
            .nullable(),
        }),
      ),
    }),
  }),
});

const mergeBoxSchema = z.object({
  pullRequest: z.object({
    latestOpinionatedReviews: z.array(
      z.object({
        author: z.object({ login: z.string() }),
        state: z.enum(['APPROVED', 'CHANGES_REQUESTED']),
      }),
    ),
    pendingReviewRequests: z.array(
      z.object({
        reviewer: z.object({ login: z.string(), type: z.string() }),
      }),
    ),
  }),
});

const validate = <T>(schema: z.ZodType<T>, json: unknown, source: string): T => {
  const result = schema.safeParse(json);
  if (!result.success) {
    throw new DataSourceError('schema', `${source} の形式が想定と異なります: ${result.error.message}`);
  }
  return result.data;
};

export const parseQueries = (
  json: unknown,
): { items: PullRequestSummary[]; truncated: boolean } => {
  const route = validate(queriesSchema, json, 'PR 一覧').payload.pullsInboxSurfaceContentRoute;
  const items = route.results.map((r) => ({
    id: r.id,
    number: r.number,
    title: r.title,
    url: r.permalink,
    repo: r.repoNameWithOwner,
    author: r.author.displayLogin,
    isDraft: r.isDraft,
    updatedAt: r.updatedAt,
  }));
  // エンドポイントは 1 回で最大 25 件しか返さずページ送りも効かないため、欠けていることを利用者に伝えられるようにする
  return { items, truncated: route.pageInfo.totalCount > items.length };
};

export const parseDeferred = (json: unknown): Map<string, { ci: CiState | null }> => {
  const results = validate(deferredSchema, json, 'CI 状態').payload
    .pullsInboxSurfaceContentDeferredData.results;
  return new Map(
    results.map((r) => [
      r.id,
      { ci: r.statusCheckRollup ? (r.statusCheckRollup.state.toLowerCase() as CiState) : null },
    ]),
  );
};

export const parseMergeBox = (
  json: unknown,
): { opinionatedReviews: OpinionatedReview[]; pendingReviewers: string[] } => {
  const pr = validate(mergeBoxSchema, json, 'レビュー状態').pullRequest;
  return {
    opinionatedReviews: pr.latestOpinionatedReviews.map((r) => ({
      login: r.author.login,
      state: r.state === 'APPROVED' ? 'approved' : 'changes_requested',
    })),
    // チームへの依頼は個人のレビュー状態と突き合わせられないので除く
    pendingReviewers: pr.pendingReviewRequests
      .filter((r) => r.reviewer.type === 'USER')
      .map((r) => r.reviewer.login),
  };
};

const iconStates: [string, SidebarReviewerState][] = [
  ['octicon-comment', 'commented'],
  ['octicon-check', 'approved'],
  ['octicon-file-diff', 'changes_requested'],
  ['octicon-dot-fill', 'pending'],
];

const hasClass = (el: Element, name: string): boolean =>
  (getAttributeValue(el, 'class') ?? '').split(/\s+/).includes(name);

// 公式 API を使わない方針のため、commented レビューは PR ページのサイドバー HTML からしか取れない
export const parseSidebarReviewers = (html: string): SidebarReviewer[] => {
  const doc = parseDocument(html);
  // Assignees 欄も同じ data-assignee-name を持つので、レビュアー欄のフォームに範囲を絞る
  const form = findOne(
    (el) => el.name === 'form' && (el.attribs.id ?? '').startsWith('pull-request-reviewers-form-'),
    doc.children,
  );
  if (!form) {
    throw new DataSourceError('schema', 'サイドバーにレビュアー欄が見つかりません');
  }

  return findAll((el) => el.attribs['data-assignee-name'] !== undefined, form.children).map(
    (nameEl) => {
      const login = nameEl.attribs['data-assignee-name'] ?? '';
      const row = nameEl.parent as Element | null;
      const icon = row
        ? findOne(
            (el) => el.name === 'svg' && el.parent !== null && hasClass(el.parent as Element, 'reviewers-status-icon'),
            row.children,
          )
        : null;
      const state = icon && iconStates.find(([cls]) => hasClass(icon, cls))?.[1];
      if (!state) {
        throw new DataSourceError('schema', `レビュアー ${login} の状態アイコンを解釈できません`);
      }
      return { login, state };
    },
  );
};
