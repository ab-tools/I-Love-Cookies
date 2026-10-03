import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  resolve: { alias: { '@autoconsent-src': resolve('node_modules/@duckduckgo/autoconsent/lib') } },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'happy-dom',
  },
});
