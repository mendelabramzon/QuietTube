const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

async function harness({ failRules = false, failStorage = false, initialEnabled = ['youtube_ads'] } = {}) {
  let stored = {};
  let listener;
  const calls = [];
  const enabled = new Set(initialEnabled);
  const context = vm.createContext({
    console,
    browser: {
      storage: { local: {
        async get() { return structuredClone(stored); },
        async set(value) { if (failStorage) throw new Error('storage failed'); stored = structuredClone(value); }
      } },
      declarativeNetRequest: {
        async getEnabledRulesets() { return [...enabled]; },
        async updateEnabledRulesets(value) {
          if (failRules) throw new Error('rules failed');
          for (const ruleset of value.disableRulesetIds || []) {
            if (!enabled.has(ruleset)) throw new Error('cannot redundantly disable a ruleset');
          }
          calls.push(structuredClone(value));
          for (const ruleset of value.disableRulesetIds || []) enabled.delete(ruleset);
          for (const ruleset of value.enableRulesetIds || []) enabled.add(ruleset);
        }
      },
      runtime: {
        onInstalled: { addListener() {} }, onStartup: { addListener() {} },
        onMessage: { addListener(fn) { listener = fn; } }
      }
    }
  });
  for (const file of ['core.js', 'background.js']) vm.runInContext(fs.readFileSync(require.resolve('../extension/' + file), 'utf8'), context);
  // Await startup initialization through the same serialized message queue.
  await listener({ type: 'settings.get' });
  return { send: listener, calls, stored: () => stored };
}

test('master switch disables request rules and survives reads', async () => {
  const extension = await harness();
  assert.equal(extension.calls.length, 0);
  const result = await extension.send({ type: 'settings.set', patch: { enabled: false } });
  assert.equal(result.ok, true);
  assert.equal(result.settings.enabled, false);
  assert.deepEqual(extension.calls.at(-1).disableRulesetIds, ['youtube_ads']);
  assert.equal((await extension.send({ type: 'settings.get' })).settings.enabled, false);
});

test('concurrent patches are serialized without losing changes', async () => {
  const extension = await harness();
  const results = await Promise.all([
    extension.send({ type: 'settings.set', patch: { hideAdCards: false } }),
    extension.send({ type: 'settings.set', patch: { skipAds: false } })
  ]);
  assert(results.every(result => result.ok));
  const settings = (await extension.send({ type: 'settings.get' })).settings;
  assert.equal(settings.hideAdCards, false);
  assert.equal(settings.skipAds, false);
});

test('invalid settings are rejected and a failed write restores request rules', async () => {
  const extension = await harness({ failStorage: true });
  const invalid = await extension.send({ type: 'settings.set', patch: { enabled: 'false' } });
  assert.equal(invalid.ok, false);
  assert.equal(extension.calls.length, 0);
  assert.equal((await extension.send({ type: 'settings.set', patch: { toString: false } })).ok, false);
  const result = await extension.send({ type: 'settings.set', patch: { enabled: false } });
  assert.equal(result.ok, false);
  assert.match(result.error, /storage failed/);
  assert.deepEqual(extension.calls.at(-1).enableRulesetIds, ['youtube_ads']);
  assert.deepEqual(extension.stored(), {});
});

test('startup enables an inactive ruleset and redundant settings never update rules', async () => {
  const extension = await harness({ initialEnabled: [] });
  assert.deepEqual(extension.calls[0].enableRulesetIds, ['youtube_ads']);
  assert.equal(extension.calls[0].disableRulesetIds, undefined);
  await extension.send({ type: 'settings.set', patch: { enabled: true } });
  await extension.send({ type: 'settings.set', patch: { hideAdCards: false } });
  assert.equal(extension.calls.length, 1);
  await extension.send({ type: 'settings.set', patch: { enabled: false } });
  assert.equal(extension.calls.at(-1).enableRulesetIds, undefined);
  await extension.send({ type: 'settings.set', patch: { enabled: false } });
  assert.equal(extension.calls.length, 2);
});

test('failed request-rule updates leave stored settings unchanged', async () => {
  const extension = await harness({ failRules: true });
  const result = await extension.send({ type: 'settings.set', patch: { enabled: false } });
  assert.equal(result.ok, false);
  assert.match(result.error, /rules failed/);
  assert.deepEqual(extension.stored(), {});
});
