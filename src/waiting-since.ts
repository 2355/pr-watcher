import type { Snapshot } from './snapshot';

// GitHub からレビュー依頼の日時を得るには PR ページの HTML（1 件約 1MB）を取るしかなく、定期取得には重すぎる。
// そのため拡張が「レビュー待ち」を最初に検知した時刻を PR ごとに覚えておき、依頼日時の代わりに使う
export type WaitingSince = Record<string, string>;

// 自分の PR とレビュー依頼では「待ち」の意味が違うので、同じ PR でも別々に数える
export const reviewRequestKey = (id: string): string => `review:${id}`;
export const myPrKey = (id: string): string => `mine:${id}`;

const REVIEW_PREFIX = reviewRequestKey('');
const MY_PR_PREFIX = myPrKey('');

export const waitingSinceOf = (snapshot: Snapshot, previous: WaitingSince): WaitingSince | undefined => {
  // 取得に失敗したときは待ちが終わったのか分からないので、記録を消さずに残す
  if (snapshot.status !== 'ok') return undefined;
  // 一覧は作成日の新しい順なので、上限から溢れるのは作成の古い＝長く待っていそうな PR。溢れただけで記録を消すと最も知りたい値が失われる
  const keptPrefixes = [
    ...(snapshot.truncated.reviewRequests ? [REVIEW_PREFIX] : []),
    ...(snapshot.truncated.myPrs ? [MY_PR_PREFIX] : []),
  ];
  const entries: [string, string][] = Object.entries(previous).filter(([key]) =>
    keptPrefixes.some((prefix) => key.startsWith(prefix)),
  );
  for (const pr of snapshot.reviewRequests) {
    if (pr.waitingSince) entries.push([reviewRequestKey(pr.id), pr.waitingSince]);
  }
  for (const pr of snapshot.myPrs) {
    if (pr.waitingSince) entries.push([myPrKey(pr.id), pr.waitingSince]);
  }
  return Object.fromEntries(entries);
};
