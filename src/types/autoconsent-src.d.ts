// Types for the bundler-only '@autoconsent-src' alias (autoconsent's TS sources, see wxt.config.ts).
declare module '@autoconsent-src/web' {
  export { default } from '@duckduckgo/autoconsent';
}

declare module '@autoconsent-src/eval-snippets' {
  export const snippets: Record<string, (...args: unknown[]) => unknown>;
}

declare module '@autoconsent-src/eval-handler' {
  export const evalState: { pending: Map<string, unknown> };
}
