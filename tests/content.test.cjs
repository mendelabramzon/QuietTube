const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function harness({ players = [], cards = [] } = {}) {
  const documentEvents = new Map();
  const windowEvents = new Map();
  const attributes = new Map();
  const intervals = new Map();
  const timeouts = new Map();
  const observers = [];
  const configurations = [];
  let nextTimer = 0;
  let resolveRead, rejectRead, storageListener, messageListener;
  const read = new Promise((resolve, reject) => { resolveRead = resolve; rejectRead = reject; });
  function add(map, type, handler) {
    if (!map.has(type)) map.set(type, []);
    map.get(type).push(handler);
  }
  function emit(map, type, event = {}) { for (const handler of map.get(type) || []) handler(event); }
  const document = {
    documentElement: { setAttribute(key, value) { attributes.set(key, value); } },
    addEventListener(type, handler) { add(documentEvents, type, handler); },
    dispatchEvent(event) {
      emit(documentEvents, event.type, event);
      if (event.type === 'quiettube:configure') configurations.push(JSON.parse(event.detail));
    },
    querySelectorAll(selector) { return selector === '.html5-video-player' ? players : cards; }
  };
  const context = vm.createContext({
    URL, document,
    CustomEvent: class { constructor(type, { detail }) { this.type = type; this.detail = detail; } },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; this.active = false; observers.push(this); }
      observe() { this.active = true; }
      disconnect() { this.active = false; }
    },
    getComputedStyle: () => ({ visibility: 'visible', display: 'block' }),
    setInterval(callback) { const id = ++nextTimer; intervals.set(id, callback); return id; },
    clearInterval(id) { intervals.delete(id); },
    setTimeout(callback) { const id = ++nextTimer; timeouts.set(id, callback); return id; },
    clearTimeout(id) { timeouts.delete(id); },
    addEventListener(type, handler) { add(windowEvents, type, handler); },
    browser: {
      storage: { local: { get: () => read }, onChanged: { addListener(handler) { storageListener = handler; } } },
      runtime: { onMessage: { addListener(handler) { messageListener = handler; } } }
    }
  });
  vm.runInContext('window = globalThis', context);
  for (const file of ['core.js', 'content.js']) vm.runInContext(fs.readFileSync(require.resolve('../extension/' + file), 'utf8'), context);
  const flush = () => new Promise(setImmediate);
  return {
    attributes, intervals, timeouts, observers, configurations,
    async load(settings) { resolveRead({ settings }); await flush(); },
    async failRead() { rejectRead(new Error('unavailable')); await flush(); },
    change(settings, area = 'local') { storageListener({ settings: { newValue: settings } }, area); },
    documentEvent(type) { emit(documentEvents, type); },
    windowEvent(type, value) { emit(windowEvents, type, value); },
    mutation() { for (const observer of observers) if (observer.active) observer.callback(); },
    tick() { for (const callback of [...intervals.values()]) callback(); },
    status() { return messageListener({ type: 'status.get' }); }
  };
}

function playerFixture() {
  const video = { duration: 180, paused: false, currentSrc: 'content.mp4', currentTime: 70, readyState: 4 };
  const player = {
    ad: false,
    classList: { contains(name) { return player.ad && name === 'ad-showing'; } },
    querySelector() { return video; }, querySelectorAll() { return []; }
  };
  return { player, video };
}

test('a fresh page honors a saved disabled master switch without starting any filters', async () => {
  const { player, video } = playerFixture();
  player.ad = true;
  const extension = harness({ players: [player], cards: [{}] });
  await extension.load({ enabled: false });
  extension.documentEvent('DOMContentLoaded');
  extension.mutation();
  extension.tick();
  const status = await extension.status();
  assert.equal(status.settings.enabled, false);
  assert.equal(extension.intervals.size, 0);
  assert.equal(extension.timeouts.size, 0);
  assert(extension.observers.every(observer => !observer.active));
  assert.equal(extension.attributes.get('data-quiettube-hide-ads'), 'false');
  assert.equal(extension.configurations.at(-1).enabled, false);
  assert.equal(status.stats.skipActions, 0);
  assert.equal(status.stats.adCardsHidden, 0);
  assert.equal(video.currentTime, 70);
});

test('master disable stops scans, clears pending work, and removes cosmetic hiding', async () => {
  const extension = harness({ cards: [{}] });
  assert.equal(extension.intervals.size, 0);
  await extension.load();
  assert.equal(extension.attributes.get('data-quiettube-hide-ads'), 'true');
  assert.equal(extension.intervals.size, 1);
  extension.mutation();
  assert.equal(extension.timeouts.size, 1);
  extension.change({ enabled: false });
  assert.equal(extension.intervals.size, 0);
  assert.equal(extension.timeouts.size, 0);
  assert(extension.observers.every(observer => !observer.active));
  assert.equal(extension.attributes.get('data-quiettube-hide-ads'), 'false');
  assert.equal(extension.configurations.at(-1).enabled, false);
  assert.equal((await extension.status()).stats.adCardsHidden, 1);
});

test('a late startup snapshot cannot undo a newer disable action', async () => {
  const extension = harness();
  extension.change({ enabled: false });
  await extension.load({ enabled: true });
  assert.equal((await extension.status()).settings.enabled, false);
  assert.equal(extension.intervals.size, 0);
  assert.equal(extension.configurations.at(-1).enabled, false);
});

test('successful settings changes recover from startup read failure', async () => {
  const extension = harness();
  await extension.failRead();
  assert.match((await extension.status()).error, /could not be loaded/);
  assert.equal(extension.intervals.size, 0);
  extension.change({ enabled: true });
  assert.equal((await extension.status()).error, null);
  assert.equal(extension.intervals.size, 1);
});

test('a late startup read error cannot invalidate newer settings', async () => {
  const extension = harness();
  extension.change({ enabled: true });
  await extension.failRead();
  assert.equal((await extension.status()).error, null);
  assert.equal(extension.intervals.size, 1);
});

test('settings changes retain the content-source guard during a mid-roll handover', async () => {
  const { player, video } = playerFixture();
  const extension = harness({ players: [player] });
  await extension.load();
  player.ad = true;
  extension.change({ hideAdCards: false });
  assert.equal(video.currentTime, 70);
  assert.equal((await extension.status()).stats.skipActions, 0);
});

test('back/forward restoration resumes once and retains a disable action made while hidden', async () => {
  const extension = harness({ cards: [{}] });
  await extension.load();
  extension.windowEvent('pagehide');
  assert.equal(extension.intervals.size, 0);
  assert.equal(extension.configurations.at(-1).enabled, false);
  extension.windowEvent('pageshow', { persisted: true });
  assert.equal(extension.intervals.size, 1);
  assert.equal((await extension.status()).stats.adCardsHidden, 1);
  extension.windowEvent('pagehide');
  extension.change({ enabled: false });
  extension.windowEvent('pageshow', { persisted: true });
  assert.equal(extension.intervals.size, 0);
  assert.equal((await extension.status()).settings.enabled, false);
  assert.equal(extension.attributes.get('data-quiettube-hide-ads'), 'false');
});

test('navigation suppresses skipping until completion and preserves the old content source', async () => {
  const { player, video } = playerFixture();
  const extension = harness({ players: [player] });
  await extension.load();
  extension.documentEvent('yt-navigate-start');
  player.ad = true;
  extension.tick();
  assert.equal(video.currentTime, 70);
  extension.documentEvent('yt-navigate-finish');
  extension.tick();
  assert.equal(video.currentTime, 70);
  video.currentSrc = 'new-ad.mp4'; video.duration = 15; video.currentTime = 0;
  extension.tick();
  assert.equal(video.currentTime, 15);
  assert.equal((await extension.status()).stats.skipActions, 1);
});

test('a periodic scan cancels its already-scheduled mutation scan', async () => {
  const extension = harness();
  await extension.load();
  extension.mutation();
  assert.equal(extension.timeouts.size, 1);
  extension.tick();
  assert.equal(extension.timeouts.size, 0);
});
