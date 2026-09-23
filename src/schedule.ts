import type { Snapshot } from './snapshot';

export const DEFAULT_INTERVAL_MINUTES = 5;
const MAX_INTERVAL_MINUTES = 60;
const MAX_WAIT_MINUTES = 60;

export type IdleState = 'active' | 'idle' | 'locked';

export const normalizeInterval = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_INTERVAL_MINUTES
    ? value
    : null;

// 離席中や画面ロック中に取得しても誰も見ないので、GitHub へ不要なリクエストを送らない
export const shouldPoll = ({
  idleState,
  snapshot,
  now,
}: {
  idleState: IdleState;
  snapshot: Snapshot | undefined;
  now: Date;
}): boolean => {
  if (idleState !== 'active') return false;
  const retryAt = snapshot?.status === 'error' ? snapshot.retryAt : undefined;
  return retryAt === undefined || now >= new Date(retryAt);
};

// 制限中に叩き続けると制限が長引くので、そのときだけ設定した更新間隔より長く待つ
export const applyRateLimit = (
  snapshot: Snapshot,
  previous: Snapshot | undefined,
  intervalMinutes: number,
  now: Date,
): Snapshot => {
  if (snapshot.status !== 'error' || snapshot.error.kind !== 'rate_limited') return snapshot;

  const { retryAfterSeconds } = snapshot.error;
  if (retryAfterSeconds !== undefined) {
    return { ...snapshot, retryAt: new Date(now.getTime() + retryAfterSeconds * 1000).toISOString() };
  }
  const previousWait =
    previous?.status === 'error' && previous.error.kind === 'rate_limited' ? previous.waitMinutes : undefined;
  const waitMinutes = Math.min(previousWait ? previousWait * 2 : intervalMinutes * 2, MAX_WAIT_MINUTES);
  return {
    ...snapshot,
    retryAt: new Date(now.getTime() + waitMinutes * 60_000).toISOString(),
    waitMinutes,
  };
};
