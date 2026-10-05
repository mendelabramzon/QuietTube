const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../extension/core.js');

test('player pruning preserves video, captions, and unrelated objects', () => {
  const response = {
    adPlacements: [{ tracking: 'ad' }], playerAds: [], adSlots: [], adBreakHeartbeatParams: 'ad',
    streamingData: { adaptiveFormats: [{ url: 'https://r1.googlevideo.com/videoplayback' }] },
    captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ languageCode: 'en' }] } },
    videoDetails: { videoId: 'video', lengthSeconds: '600' },
    unrelated: { adSlots: ['keep'] }
  };
  const expected = structuredClone(response);
  for (const key of ['adPlacements', 'playerAds', 'adSlots', 'adBreakHeartbeatParams']) delete expected[key];
  assert.equal(core.stripPlayerAds(response), 4);
  assert.deepEqual(response, expected);
  assert.equal(core.stripPlayerAds(response), 0);
});

test('known player wrappers and legacy serialized responses are filtered', () => {
  const response = [{ playerResponse: { adSlots: [], videoDetails: { videoId: 'one' } } },
    { player_response: JSON.stringify({ adPlacements: [], streamingData: { formats: [] } }) }];
  assert.equal(core.stripPlayerAds(response), 2);
  assert.equal(response[0].playerResponse.videoDetails.videoId, 'one');
  assert.deepEqual(JSON.parse(response[1].player_response), { streamingData: { formats: [] } });
});

test('malformed, frozen, and circular responses fail open', () => {
  assert.deepEqual(core.filterPlayerText('<html>"adPlacements"</html>'), { text: '<html>"adPlacements"</html>', removed: 0 });
  const frozen = Object.freeze({ adSlots: ['ad'], player_response: '{bad' });
  assert.equal(core.stripPlayerAds(frozen), 0);
  const circular = { adPlacements: [] }; circular.playerResponse = circular;
  assert.equal(core.stripPlayerAds(circular), 1);
});

test('XSSI prefix is preserved and ad-free text is byte-for-byte unchanged', () => {
  const input = ")]}'\n" + JSON.stringify({ adSlots: [], videoDetails: { videoId: 'content' } });
  const output = core.filterPlayerText(input);
  assert.equal(output.removed, 1);
  assert.equal(output.text, ")]}'\n" + JSON.stringify({ videoDetails: { videoId: 'content' } }));
  const untouched = '{ "videoDetails" : { "videoId": "ordinary" } }';
  assert.equal(core.filterPlayerText(untouched).text, untouched);
});

test('only the HTTPS YouTube player endpoint is eligible for interception', () => {
  const base = 'https://www.youtube.com/watch?v=video';
  for (const input of ['/youtubei/v1/player?key=test', new URL('/youtubei/v1/player', base), { url: base.replace('/watch?v=video', '/youtubei/v1/player') }]) {
    assert.equal(core.isPlayerRequest(input, base), true);
  }
  for (const input of ['http://www.youtube.com/youtubei/v1/player', 'https://youtube.com.evil.test/youtubei/v1/player', '/youtubei/v1/next', '/youtubei/v1/player/extra', 'https://r1.googlevideo.com/videoplayback', null]) {
    assert.equal(core.isPlayerRequest(input, base), false);
  }
});

test('settings accept booleans and discard unexpected or malformed values', () => {
  assert.deepEqual(core.normalizeSettings({ enabled: false, skipAds: 'false', secret: true }), { ...core.DEFAULT_SETTINGS, enabled: false });
  assert.deepEqual(core.normalizeSettings(null), core.DEFAULT_SETTINGS);
});

function fixture({ ad = false, duration = 30, paused = false, source = 'ad.mp4', currentTime = 0, readyState = 4, buttons = [] } = {}) {
  const video = { duration, paused, currentSrc: source, currentTime, readyState, muted: false, volume: .6, playbackRate: 1.25 };
  const player = {
    ad,
    classList: { contains(name) { return player.ad && name === 'ad-showing'; } },
    querySelector() { return video; },
    querySelectorAll() { return buttons; }
  };
  return { player, video };
}
function button({ visible = true, disabled = false, ariaDisabled = null } = {}) {
  return { disabled, clicks: 0, getAttribute() { return ariaDisabled; }, getClientRects() { return visible ? [{}] : []; }, click() { this.clicks++; } };
}

test('ordinary videos are never sought or clicked', () => {
  const skip = button();
  const { player, video } = fixture({ duration: 120, source: 'content.mp4', currentTime: 20, buttons: [skip] });
  const skipper = new core.AdSkipper();
  assert.equal(skipper.update(player), null);
  assert.equal(video.currentTime, 20);
  assert.equal(skip.clicks, 0);
});

test('visible enabled skip controls take precedence and are rate limited', () => {
  let now = 0;
  const hidden = button({ visible: false });
  const disabled = button({ disabled: true });
  const ariaDisabled = button({ ariaDisabled: 'true' });
  const skip = button();
  const { player, video } = fixture({ ad: true, buttons: [hidden, disabled, ariaDisabled, skip] });
  const skipper = new core.AdSkipper({ now: () => now });
  assert.equal(skipper.update(player), 'click');
  assert.equal(skip.clicks, 1);
  assert.equal(hidden.clicks + disabled.clicks + ariaDisabled.clicks, 0);
  assert.equal(video.currentTime, 0);
  assert.equal(skipper.update(player), null);
  now = 1000;
  assert.equal(skipper.update(player), 'click');
});

test('finite marked ad media can be skipped without altering playback preferences', () => {
  const { player, video } = fixture({ ad: true });
  const skipper = new core.AdSkipper();
  assert.equal(skipper.update(player), 'seek');
  assert.equal(video.currentTime, video.duration);
  assert.equal(video.muted, false);
  assert.equal(video.volume, .6);
  assert.equal(video.playbackRate, 1.25);
  assert.equal(video.paused, false);
  assert.equal(skipper.update(player), null);
});

test('paused, live, metadata-less, and long media are not sought', () => {
  for (const options of [{ paused: true }, { duration: Infinity }, { readyState: 0 }, { duration: NaN }, { duration: 0 }, { duration: 301 }, { source: '' }]) {
    const { player, video } = fixture({ ad: true, ...options });
    assert.equal(new core.AdSkipper().update(player), null);
    assert.equal(video.currentTime, 0);
  }
});

test('paused ads are not advanced by clicking their skip button', () => {
  const skip = button();
  const { player } = fixture({ ad: true, paused: true, buttons: [skip] });
  assert.equal(new core.AdSkipper().update(player), null);
  assert.equal(skip.clicks, 0);
});

test('mid-roll ad classes cannot seek the known content source', () => {
  let now = 0;
  const { player, video } = fixture({ source: 'content.mp4', duration: 180, currentTime: 70 });
  const skipper = new core.AdSkipper({ now: () => now });
  skipper.update(player);
  player.ad = true;
  assert.equal(skipper.update(player), null);
  assert.equal(video.currentTime, 70);
  video.currentSrc = 'ad.mp4'; video.duration = 15; video.currentTime = 0;
  assert.equal(skipper.update(player), 'seek');
  now = 2000;
  video.currentSrc = 'content.mp4'; video.duration = 180; video.currentTime = 70;
  assert.equal(skipper.update(player), null);
  assert.equal(video.currentTime, 70);
});

test('failed seeks do not throw or prevent the next attempt', () => {
  const { player, video } = fixture({ ad: true });
  Object.defineProperty(video, 'currentTime', { get: () => 0, set: () => { throw new Error('not seekable'); }, configurable: true });
  assert.equal(new core.AdSkipper().update(player), null);
});
