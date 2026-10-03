// Builds src/rules/generated/rules.json from autoconsent's full rules.json (the compact set has no opt-in
// steps) and src/rules/ilc/*.json (same name overrides). Keeps only non-cosmetic rules with opt-in steps.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const upstream = require('@duckduckgo/autoconsent/rules/rules.json');
// package.json is not in autoconsent's "exports" map – read it from disk.
const upstreamVersion = JSON.parse(
  readFileSync(join(root, 'node_modules', '@duckduckgo', 'autoconsent', 'package.json'), 'utf8'),
).version;

const isUsable = (rule) =>
  !rule.name.startsWith('auto_') && !rule.cosmetic && Array.isArray(rule.optIn) && rule.optIn.length > 0;

const byName = new Map();
for (const rule of upstream.autoconsent) {
  if (isUsable(rule)) byName.set(rule.name, { ...rule, _source: 'autoconsent' });
}

const ilcDir = join(root, 'src', 'rules', 'ilc');
let ilcCount = 0;
for (const file of readdirSync(ilcDir).filter((f) => f.endsWith('.json')).sort()) {
  const content = JSON.parse(readFileSync(join(ilcDir, file), 'utf8'));
  for (const rule of Array.isArray(content) ? content : [content]) {
    if (!isUsable(rule)) throw new Error(`${file}: rule "${rule.name}" has no opt-in steps or is cosmetic`);
    byName.set(rule.name, { ...rule, _source: 'ilc' });
    ilcCount++;
  }
}

// Drop metadata that is not needed at runtime to keep the bundle small.
const rules = [...byName.values()].map(({ _metadata, comment, vendorUrl, ...rule }) => rule);
const outDir = join(root, 'src', 'rules', 'generated');
mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, 'rules.json'),
  JSON.stringify({ upstreamVersion, builtAt: new Date().toISOString().slice(0, 10), autoconsent: rules }),
);
console.log(
  `rules: ${rules.length} (autoconsent ${upstreamVersion}: ${rules.length - ilcCount}, ilc: ${ilcCount}) -> src/rules/generated/rules.json`,
);
