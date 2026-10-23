import type { OpinionatedReview, SidebarReviewer } from './github/types';

export type AuthorReviewState = 'changes_requested' | 'commented' | 'approved' | 'none';

export type AuthorReviewStatus = {
  state: AuthorReviewState;
  // commented も含めるのは、指摘コメントも修正対応が必要なものとして扱う方針のため
  needsFix: boolean;
  approved: boolean;
  // レビュー済みの人と依頼中の人。誰に見てもらっているかを知るためのものなので bot と自分は含めない
  reviewers: string[];
};

type Input = {
  me: string;
  opinionatedReviews: OpinionatedReview[];
  pendingReviewers: string[];
  // サイドバーの HTML 解析は壊れやすいので、失敗時は null を受け取り merge_box だけで判定する
  sidebarReviewers: SidebarReviewer[] | null;
};

// レビュー bot はほぼ全 PR にコメントするため、数えると要修正が常に立ってしまう
const isBot = (login: string): boolean => login.endsWith('[bot]');

const isOtherHuman = (login: string, me: string): boolean => !isBot(login) && login !== me;

export const deriveAuthorReviewStatus = ({
  me,
  opinionatedReviews,
  pendingReviewers,
  sidebarReviewers,
}: Input): AuthorReviewStatus => {
  const states = new Map<string, AuthorReviewState>();
  for (const r of sidebarReviewers ?? []) {
    if (r.state === 'commented') states.set(r.login, 'commented');
  }
  // GitHub は approve / changes requested を出した後のコメントでは判定を上書きしないので、merge_box の判定で上書きする
  for (const r of opinionatedReviews) states.set(r.login, r.state);

  const pending = new Set(pendingReviewers);
  const counted = [...states].filter(([login]) => isOtherHuman(login, me));
  // 再レビュー依頼中のレビュアーの指摘は「対応済みで返した」ものとみなす
  const active = new Set(counted.filter(([login]) => !pending.has(login)).map(([, s]) => s));
  const approved = counted.some(([, s]) => s === 'approved');

  const state: AuthorReviewState = active.has('changes_requested')
    ? 'changes_requested'
    : active.has('commented')
      ? 'commented'
      : approved
        ? 'approved'
        : 'none';

  return {
    state,
    needsFix: state === 'changes_requested' || state === 'commented',
    approved,
    reviewers: [...new Set([...states.keys(), ...pendingReviewers])].filter((login) => isOtherHuman(login, me)),
  };
};
