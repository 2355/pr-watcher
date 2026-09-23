import { writeFileSync } from 'node:fs';
import { createCanvas, Path2D } from '@napi-rs/canvas';
import { drawIcon } from '../src/icon/draw';

// manifest の静的アイコンは、拡張機能の管理画面や初回の setIcon 前に表示される。ドット付きアイコンと見た目をそろえるため、同じ描画処理から生成する
for (const size of [16, 32, 48, 128]) {
  const canvas = createCanvas(size, size);
  drawIcon(
    canvas.getContext('2d') as unknown as OffscreenCanvasRenderingContext2D,
    size,
    { reviewerDot: false, revieweeDot: null, grayed: false },
    (d) => new Path2D(d) as unknown as globalThis.Path2D,
  );
  writeFileSync(new URL(`../public/icons/icon-${size}.png`, import.meta.url), canvas.toBuffer('image/png'));
}
