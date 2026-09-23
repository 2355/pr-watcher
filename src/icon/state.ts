import type { Snapshot } from '../snapshot';

export type IconState = {
  reviewerDot: boolean;
  revieweeDot: 'red' | 'green' | null;
  grayed: boolean;
};

// ドットは取得結果だけから決める。ポップアップを開いたかどうかでは消さず、GitHub 上で対応したときにだけ消えるようにするため
export const iconStateOf = (snapshot: Snapshot | undefined): IconState => {
  if (snapshot?.status === 'error') {
    // 古いデータでドットを出し続けると、対応済みの通知を見せてしまうおそれがある
    return { reviewerDot: false, revieweeDot: null, grayed: true };
  }
  const myPrs = snapshot?.myPrs ?? [];
  return {
    reviewerDot: (snapshot?.reviewRequests.length ?? 0) > 0,
    revieweeDot: myPrs.some((pr) => pr.review.needsFix)
      ? 'red'
      : myPrs.some((pr) => pr.review.approved)
        ? 'green'
        : null,
    grayed: false,
  };
};
