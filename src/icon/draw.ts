import { octicons } from '../octicons';
import type { IconState } from './state';

const COLORS = {
  base: '#24292f',
  glyph: '#ffffff',
  orange: '#e16f24',
  red: '#cf222e',
  green: '#1f883d',
};

const GRAYED_ALPHA = 0.35;
const DOT_RADIUS = 3.3;
// ドットの周りを切り抜く幅。ツールバーがライトでもダークでも、ドットとベースの境目が見えるようにする
const CUTOUT_RADIUS = 4.4;
const TOP_RIGHT = { x: 12.4, y: 3.6 };
const BOTTOM_RIGHT = { x: 12.4, y: 12.4 };

// Path2D は実行環境ごとに実装が異なる（service worker とテスト用の Canvas）ので、生成方法を外から渡す
export const drawIcon = (
  ctx: OffscreenCanvasRenderingContext2D,
  size: number,
  state: IconState,
  createPath: (d: string) => Path2D,
): void => {
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  // 16 単位の座標系で設計し、16px と 32px の両方に同じ見た目で拡大する
  ctx.scale(size / 16, size / 16);

  // グレーアウトは色を変えてもモノトーンのベースと区別しにくいので、全体を薄くして表す
  ctx.globalAlpha = state.grayed ? GRAYED_ALPHA : 1;
  ctx.beginPath();
  ctx.roundRect(0, 0, 16, 16, 3.5);
  ctx.fillStyle = COLORS.base;
  ctx.fill();

  ctx.save();
  ctx.translate(2.5, 2.5);
  ctx.scale(11 / 16, 11 / 16);
  ctx.fillStyle = COLORS.glyph;
  ctx.fill(createPath(octicons.pullRequest));
  ctx.restore();
  ctx.globalAlpha = 1;

  if (!state.grayed) {
    if (state.reviewerDot) drawDot(ctx, TOP_RIGHT, COLORS.orange);
    if (state.revieweeDot) drawDot(ctx, BOTTOM_RIGHT, COLORS[state.revieweeDot]);
  }
  ctx.restore();
};

const drawDot = (
  ctx: OffscreenCanvasRenderingContext2D,
  { x, y }: { x: number; y: number },
  color: string,
): void => {
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.arc(x, y, CUTOUT_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.beginPath();
  ctx.arc(x, y, DOT_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
};
