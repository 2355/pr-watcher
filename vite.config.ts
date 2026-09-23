import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Chrome は manifest に書いたファイル名でしか service worker を読めないので、ハッシュを付けない
    rollupOptions: {
      input: { background: 'src/background.ts', popup: 'popup.html' },
      output: { entryFileNames: '[name].js' },
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
});
