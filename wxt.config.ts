import { resolve } from 'node:path';
import { defineConfig } from 'wxt';
import { EXTENSION_NAME, GECKO_ID } from './src/shared/constants';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  // Firefox defaults to MV2 in WXT – we ship MV3 everywhere.
  manifestVersion: 3,
  // autoconsent's TS sources (its package only exports a prebuilt bundle). Bundler-only alias: TypeScript uses
  // the declarations in src/types/autoconsent-src.d.ts instead of type-checking autoconsent's sources.
  vite: () => ({ resolve: { alias: { '@autoconsent-src': resolve('node_modules/@duckduckgo/autoconsent/lib') } } }),
  // Source archive for AMO review: everything needed to reproduce the build, nothing else.
  zip: { excludeSources: ['.github/**'] },
  manifest: ({ browser }) => ({
    name: EXTENSION_NAME,
    description: 'Automatically accepts ALL cookies on cookie consent banners, so every website works 100 %.',
    permissions: ['scripting', 'storage', 'webNavigation', 'browsingData'],
    host_permissions: ['<all_urls>'],
    action: { default_title: EXTENSION_NAME },
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: GECKO_ID,
              // ESR 140; MAIN-world scripting + match_origin_as_fallback need 128, data_collection_permissions 140
              strict_min_version: '140.0',
              // We collect nothing; problem reports are user-initiated GitHub issues.
              data_collection_permissions: { required: ['none'] },
            },
            // Firefox for Android supports data_collection_permissions from 142.
            gecko_android: { strict_min_version: '142.0' },
          },
        }
      : {
          // MAIN-world scripting
          minimum_chrome_version: '111',
        }),
  }),
});
