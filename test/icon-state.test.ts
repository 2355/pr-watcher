import { describe, expect, it } from 'vitest';
import { iconStateOf } from '../src/icon/state';
import type { Snapshot } from '../src/snapshot';
import { myPr, ok, row } from './helpers/builders';

describe('iconStateOf', () => {
  it('まだ取得していなければドットを出さない', () => {
    expect(iconStateOf(undefined)).toEqual({ reviewerDot: false, revieweeDot: null, grayed: false });
  });

  it('対象が無ければドットを出さない', () => {
    expect(iconStateOf(ok())).toEqual({ reviewerDot: false, revieweeDot: null, grayed: false });
  });

  it('自分宛てのレビュー依頼があれば右上のドットを出す', () => {
    expect(iconStateOf(ok({ reviewRequests: [row()] })).reviewerDot).toBe(true);
  });

  it('要修正の PR があれば右下を赤にする', () => {
    expect(iconStateOf(ok({ myPrs: [myPr({ review: { needsFix: true } })] })).revieweeDot).toBe('red');
  });

  it('approved の PR があれば右下を緑にする', () => {
    expect(iconStateOf(ok({ myPrs: [myPr({ review: { approved: true } })] })).revieweeDot).toBe('green');
  });

  it('要修正と approved が両方あれば赤を優先する', () => {
    const snapshot = ok({ myPrs: [myPr({ review: { approved: true } }), myPr({ review: { needsFix: true } })] });

    expect(iconStateOf(snapshot).revieweeDot).toBe('red');
  });

  it('取得に失敗していればグレーアウトし、ドットは出さない', () => {
    const snapshot: Snapshot = {
      status: 'error',
      fetchedAt: '2026-09-23T00:00:00Z',
      error: { kind: 'unauthenticated', message: '' },
    };

    expect(iconStateOf(snapshot)).toEqual({ reviewerDot: false, revieweeDot: null, grayed: true });
  });
});
