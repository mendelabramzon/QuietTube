import { readFile, access, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const extension = resolve(root, 'extension');
const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert(!manifest.host_permissions.includes('<all_urls>'));
const resources = [
  ...manifest.background.scripts,
  manifest.action.default_popup,
  ...manifest.content_scripts.flatMap(script => [...script.js, ...(script.css || [])]),
  ...manifest.declarative_net_request.rule_resources.map(rule => rule.path)
];
for (const file of resources) await access(resolve(extension, file));
for (const file of (await readdir(extension)).filter(file => file.endsWith('.js'))) {
  const result = spawnSync(process.execPath, ['--check', resolve(extension, file)], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}
const rules = JSON.parse(await readFile(resolve(extension, 'rules/youtube-ads.json'), 'utf8'));
const ids = new Set();
const filters = [];
for (const rule of rules) {
  assert(!ids.has(rule.id), 'Rule IDs must be unique');
  ids.add(rule.id);
  assert.equal(rule.action.type, 'block');
  assert(!rule.condition.resourceTypes.includes('media'), 'Video delivery must not be blanket-blocked');
  const filter = rule.condition.urlFilter;
  assert(filter.startsWith('|https://'), 'Rule must use an anchored HTTPS URL');
  filters.push(filter);
}
// These rules use only a start anchor, a literal URL, and an optional terminal
// separator. Check that literal scope against positive and negative fixtures;
// Safari itself still needs to validate rule compilation and request behavior.
function matches(url) {
  return filters.some(filter => {
    const separator = filter.endsWith('^');
    const prefix = filter.slice(1, separator ? -1 : undefined);
    if (!url.startsWith(prefix)) return false;
    const next = url[prefix.length];
    return !separator || next === undefined || !/[a-zA-Z0-9_.%-]/.test(next);
  });
}
for (const host of ['www.youtube.com', 'youtube.com', 'm.youtube.com']) {
  assert(matches(`https://${host}/pagead/test`));
  assert(matches(`https://${host}/api/stats/ads?test=1`));
  assert(matches(`https://${host}/api/stats/ads`));
  assert(!matches(`https://${host}/api/stats/adsomething`));
  assert(!matches(`https://${host}/youtubei/v1/player`));
  assert(!matches(`https://${host}/api/stats/watchtime`));
}
assert(!matches('https://r1.googlevideo.com/videoplayback?test=1'));
assert(!matches('https://example.com/pagead/test'));
assert(!matches('https://www.youtube.com.evil.test/pagead/test'));
console.log('Manifest resources, JavaScript syntax, and request-rule boundaries checked.');
