import { describe, expect, it } from 'vitest';
import { applyRateLimit, DEFAULT_INTERVAL_MINUTES, normalizeInterval, shouldPoll } from '../src/schedule';
import type { Snapshot } from '../src/snapshot';
import { ok } from './helpers/builders';

const now = new Date('2026-09-23T08:00:00Z');

const rateLimited = (extra: Partial<Extract<Snapshot, { status: 'error' }>> = {}, retryAfterSeconds?: number): Snapshot => ({
  status: 'error',
  fetchedAt: now.toISOString(),
  error: { kind: 'rate_limited', message: 'HTTP 429', ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }) },
  ...extra,
});

describe('normalizeInterval', () => {
  it('既定値は 5 分', () => {
    expect(DEFAULT_INTERVAL_MINUTES).toBe(5);
  });

  it.each([1, 5, 60])('1〜60 の整数 %i はそのまま使う', (value) => {
    expect(normalizeInterval(value)).toBe(value);
  });

  it.each([0, 61, 2.5, Number.NaN, '5', undefined, null])('範囲外や整数でない値 %s は無効として null を返す', (value) => {
    expect(normalizeInterval(value)).toBeNull();
  });
});

describe('shouldPoll', () => {
  it('操作中なら取得する', () => {
    expect(shouldPoll({ idleState: 'active', snapshot: ok(), now })).toBe(true);
  });

  it.each(['idle', 'locked'] as const)('%s（離席中・画面ロック中）なら取得しない', (idleState) => {
    expect(shouldPoll({ idleState, snapshot: ok(), now })).toBe(false);
  });

  it('制限による待機中は取得しない', () => {
    const snapshot = rateLimited({ retryAt: '2026-09-23T08:10:00Z' });

    expect(shouldPoll({ idleState: 'active', snapshot, now })).toBe(false);
  });

  it('待機時刻を過ぎていれば取得する', () => {
    const snapshot = rateLimited({ retryAt: '2026-09-23T07:59:00Z' });

    expect(shouldPoll({ idleState: 'active', snapshot, now })).toBe(true);
  });

  it('まだ取得していなければ取得する', () => {
    expect(shouldPoll({ idleState: 'active', snapshot: undefined, now })).toBe(true);
  });
});

describe('applyRateLimit', () => {
  it('制限以外の結果はそのまま返す', () => {
    const snapshot = ok();

    expect(applyRateLimit(snapshot, undefined, 5, now)).toBe(snapshot);
  });

  it('GitHub が Retry-After で待ち時間を指定したらそれに従う', () => {
    expect(applyRateLimit(rateLimited({}, 90), undefined, 5, now)).toMatchObject({
      retryAt: '2026-09-23T08:01:30.000Z',
    });
  });

  it('待ち時間の指定が無い初回は、更新間隔の 2 倍待つ', () => {
    expect(applyRateLimit(rateLimited(), ok(), 5, now)).toMatchObject({
      retryAt: '2026-09-23T08:10:00.000Z',
      waitMinutes: 10,
    });
  });

  it('制限が続くと待ち時間を倍にする', () => {
    const previous = rateLimited({ retryAt: '2026-09-23T07:50:00Z', waitMinutes: 10 });

    expect(applyRateLimit(rateLimited(), previous, 5, now)).toMatchObject({ waitMinutes: 20 });
  });

  it('待ち時間は最大 60 分にする', () => {
    const previous = rateLimited({ retryAt: '2026-09-23T07:50:00Z', waitMinutes: 40 });

    expect(applyRateLimit(rateLimited(), previous, 5, now)).toMatchObject({
      retryAt: '2026-09-23T09:00:00.000Z',
      waitMinutes: 60,
    });
  });
});
