const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function harness(fetchImpl) {
  const events = new Map();
  const reports = [];
  const document = {
    addEventListener(type, handler) { if (!events.has(type)) events.set(type, []); events.get(type).push(handler); },
    dispatchEvent(event) { for (const handler of events.get(event.type) || []) handler(event); if (event.type === 'quiettube:page-status') reports.push(JSON.parse(event.detail)); }
  };
  class XHR {
    open(method, url) { this.url = url; this.readyState = 1; }
    load(body, type = '') { this._body = body; this.responseType = type; this.readyState = 4; this.status = 200; }
    get responseText() { if (this.responseType === 'json') throw new Error('InvalidStateError'); return this._body; }
    get response() { return this._body; }
  }
  const context = vm.createContext({
    URL, Headers, Response, Request, document, XMLHttpRequest: XHR,
    CustomEvent: class { constructor(type, { detail }) { this.type = type; this.detail = detail; } },
    location: { href: 'https://www.youtube.com/watch?v=video' },
    fetch: fetchImpl || (async () => new Response(JSON.stringify({ adPlacements: [], videoDetails: { videoId: 'video' } }), { headers: { 'content-type': 'application/json', 'content-length': '123' } }))
  });
  vm.runInContext('window = globalThis', context);
  for (const file of ['core.js', 'page.js']) vm.runInContext(fs.readFileSync(require.resolve('../extension/' + file), 'utf8'), context);
  function configure(enabled = true, filterPlayerResponses = true) {
    document.dispatchEvent({ type: 'quiettube:configure', detail: JSON.stringify({ enabled, filterPlayerResponses }) });
  }
  return { context, configure, reports, XHR };
}

test('initial response hooks cover assignments before and after configuration', () => {
  const { context, configure, reports } = harness();
  context.ytInitialPlayerResponse = { adSlots: [], videoDetails: { videoId: 'first' } };
  assert('adSlots' in context.ytInitialPlayerResponse);
  configure();
  assert(!('adSlots' in context.ytInitialPlayerResponse));
  context.ytInitialPlayerResponse = { playerAds: [], captions: { track: 'en' } };
  assert(!('playerAds' in context.ytInitialPlayerResponse));
  assert.equal(context.ytInitialPlayerResponse.captions.track, 'en');
  assert.equal(reports.at(-1).responsesFiltered, 2);
  configure(false);
  context.ytInitialPlayerResponse = { playerAds: [] };
  assert('playerAds' in context.ytInitialPlayerResponse);
});

test('fetch filters only player responses and leaves native response clones usable', async () => {
  const response = new Response(JSON.stringify({ adPlacements: [], streamingData: { formats: [{ url: 'content' }] } }), { headers: { 'content-type': 'application/json', 'content-length': '99', 'content-encoding': 'gzip' } });
  Object.defineProperty(response, 'url', { value: 'https://www.youtube.com/youtubei/v1/player' });
  const { context, configure, reports } = harness(async () => response);
  configure();
  const filtered = await context.fetch('/youtubei/v1/player');
  assert.notEqual(filtered, response);
  assert.equal(filtered.url, response.url);
  assert.equal(filtered.status, response.status);
  assert.equal(filtered.headers.get('content-length'), null);
  assert.equal(filtered.headers.get('content-encoding'), null);
  assert.equal(filtered.headers.get('content-type'), 'application/json');
  assert.deepEqual(await filtered.clone().json(), { streamingData: { formats: [{ url: 'content' }] } });
  assert.equal(response.bodyUsed, false);
  assert.equal(reports.at(-1).responsesFiltered, 1);
  assert.equal(await context.fetch('/youtubei/v1/next'), response);
  configure(false);
  assert.equal(await context.fetch('/youtubei/v1/player'), response);
});

test('fetch respects Request inputs, rejection, HTTP failure, malformed and ad-free responses', async () => {
  const { context, configure } = harness(async input => {
    if (String(input) === 'fail') throw new Error('network');
    return new Response('not json "adSlots"');
  });
  configure();
  assert.equal(await (await context.fetch(new Request('https://www.youtube.com/youtubei/v1/player'))).text(), 'not json "adSlots"');
  await assert.rejects(context.fetch('fail'), /network/);
  for (const response of [new Response('{"adSlots":[]}', { status: 403 }), new Response('{"videoDetails":{}}')]) {
    const other = harness(async () => response); other.configure();
    assert.equal(await other.context.fetch('/youtubei/v1/player'), response);
  }
});

test('XHR text/json filtering is targeted, cached, and preserves native invalid-state behavior', () => {
  const { configure, reports, XHR } = harness();
  configure();
  const xhr = new XHR(); xhr.open('POST', '/youtubei/v1/player'); xhr.load('{"adSlots":[],"videoDetails":{"videoId":"video"}}');
  assert.deepEqual(JSON.parse(xhr.responseText), { videoDetails: { videoId: 'video' } });
  assert.equal(xhr.response, xhr.responseText);
  assert.equal(reports.at(-1).responsesFiltered, 1);
  xhr.open('POST', '/youtubei/v1/player'); xhr.load({ adSlots: [], captions: { language: 'en' } }, 'json');
  assert.deepEqual(xhr.response, { captions: { language: 'en' } });
  assert.throws(() => xhr.responseText, /InvalidStateError/);
  assert.equal(reports.at(-1).responsesFiltered, 2);
  xhr.open('GET', '/unrelated'); xhr.load('{"adSlots":[]}');
  assert.equal(xhr.responseText, '{"adSlots":[]}');
  configure(false);
  xhr.open('GET', '/youtubei/v1/player'); xhr.load('{"adSlots":[]}');
  assert.equal(xhr.responseText, '{"adSlots":[]}');
});

test('disabling while a fetch is pending prevents filtering', async () => {
  let resolve;
  const { context, configure } = harness(() => new Promise(done => { resolve = done; }));
  configure();
  const request = context.fetch('/youtubei/v1/player');
  configure(false);
  const response = new Response('{"adSlots":[]}'); resolve(response);
  assert.equal(await request, response);
});
