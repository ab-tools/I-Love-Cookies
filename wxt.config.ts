import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { defineConfig } from 'wxt';
import { GECKO_ID } from './src/shared/constants';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  // Firefox defaults to MV2 in WXT – we ship MV3 everywhere.
  manifestVersion: 3,
  // autoconsent's TS sources (its package only exports a prebuilt bundle). Bundler-only alias: TypeScript uses
  // the declarations in src/types/autoconsent-src.d.ts instead of type-checking autoconsent's sources.
  vite: () => ({
    resolve: { alias: { '@autoconsent-src': resolve('node_modules/@duckduckgo/autoconsent/lib') } },
    // Build identifier in problem reports: the commit the package was built from (+ marker for local changes).
    define: { __ILC_BUILD__: JSON.stringify(buildId()) },
  }),
  // Source archive for AMO review: everything needed to reproduce the build, nothing else.
  zip: { excludeSources: ['.github/**'] },
  manifest: ({ browser, mode }) => ({
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    // browsingData: test builds only (wiping site data between automated visits). debugger (Chromium): real mouse
    // clicks for consent dialogs that ignore synthetic ones.
    permissions: [
      'scripting',
      'storage',
      'webNavigation',
      'alarms',
      ...(browser === 'firefox' ? [] : ['debugger']),
      ...(mode === 'e2e' ? ['browsingData'] : []),
    ],
    host_permissions: ['<all_urls>'],
    action: { default_title: '__MSG_extName__' },
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: GECKO_ID,
              // ESR 140; MAIN-world scripting + match_origin_as_fallback need 128, data_collection_permissions 140
              strict_min_version: '140.0',
              // Nothing is collected; problem reports are sent only when the user asks for it.
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

function buildId(): string {
  try {
    const commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    const dirty = execSync('git status --porcelain --untracked-files=no', { encoding: 'utf8' }).trim() !== '';
    return dirty ? `${commit}+` : commit;
  } catch {
    return 'unknown';
  }
}
