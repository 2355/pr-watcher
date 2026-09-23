import { createCanvas, Path2D } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { drawIcon } from '../src/icon/draw';
import type { IconState } from '../src/icon/state';

const none: IconState = { reviewerDot: false, revieweeDot: null, grayed: false };

// 16 単位の座標系で見た点の画素を返す。アイコンは 16 単位で設計しているので、どのサイズでも同じ座標で確かめられる
const render = (size: number, state: IconState) => {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  drawIcon(ctx as unknown as OffscreenCanvasRenderingContext2D, size, state, (d) => new Path2D(d) as unknown as globalThis.Path2D);
  const data = ctx.getImageData(0, 0, size, size).data;
  return (x: number, y: number) => {
    const k = size / 16;
    const i = (Math.floor(y * k) * size + Math.floor(x * k)) * 4;
    return [...data.slice(i, i + 4)];
  };
};

const rgba = (hex: string, a = 255) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
  a,
];

const TOP_RIGHT = [12.4, 3.6] as const;
const BOTTOM_RIGHT = [12.4, 12.4] as const;

describe('drawIcon', () => {
  it.each([16, 32])('%ipx でベースを黒の角丸で描く', (size) => {
    expect(render(size, none)(1, 8)).toEqual(rgba('#24292f'));
  });

  it.each([16, 32])('%ipx でレビュー依頼のドットを右上にオレンジで描く', (size) => {
    expect(render(size, { ...none, reviewerDot: true })(...TOP_RIGHT)).toEqual(rgba('#e16f24'));
  });

  it('レビュー依頼が無ければ右上にドットを描かない', () => {
    expect(render(32, none)(...TOP_RIGHT)).not.toEqual(rgba('#e16f24'));
  });

  it.each([
    ['red', '#cf222e'],
    ['green', '#1f883d'],
  ] as const)('レビュイー状態 %s のドットを右下に描く', (dot, color) => {
    expect(render(32, { ...none, revieweeDot: dot })(...BOTTOM_RIGHT)).toEqual(rgba(color));
  });

  it('ツールバーの色に関係なく輪郭が見えるよう、ドットの周りを透明に切り抜く', () => {
    const pixel = render(32, { ...none, reviewerDot: true });

    expect(pixel(8.75, 3.6)[3]).toBe(0);
  });

  it('グレーアウト時は全体を半透明にし、ドットを描かない', () => {
    const pixel = render(32, { reviewerDot: true, revieweeDot: 'red', grayed: true });

    expect(pixel(1, 8)[3]).toBeLessThan(128);
    expect(pixel(...TOP_RIGHT)).not.toEqual(rgba('#e16f24'));
    expect(pixel(...BOTTOM_RIGHT)).not.toEqual(rgba('#cf222e'));
  });
});
