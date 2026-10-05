(function (root) {
  "use strict";

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    filterPlayerResponses: true,
    skipAds: true,
    hideAdCards: true,
    blockAdRequests: true
  });
  const AD_CARD_SELECTOR = [
    "ytd-ad-slot-renderer",
    "ytd-display-ad-renderer",
    "ytd-promoted-sparkles-web-renderer",
    "ytd-promoted-video-renderer",
    "ytd-in-feed-ad-layout-renderer",
    "ytm-promoted-sparkles-web-renderer"
  ].join(",");
  const SKIP_SELECTOR = ".ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button";
  const AD_KEYS = ["adPlacements", "playerAds", "adSlots", "adBreakHeartbeatParams"];
  const PLAYER_HOSTS = new Set(["www.youtube.com", "youtube.com", "m.youtube.com", "www.youtube-nocookie.com"]);

  function normalizeSettings(value) {
    const result = { ...DEFAULT_SETTINGS };
    for (const key of Object.keys(result)) {
      if (typeof value?.[key] === "boolean") result[key] = value[key];
    }
    return result;
  }

  function isPlayerRequest(input, base) {
    try {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url, base);
      return url.protocol === "https:" && PLAYER_HOSTS.has(url.hostname) && /^\/youtubei\/v1\/player\/?$/.test(url.pathname);
    } catch {
      return false;
    }
  }

  // Restrict pruning to player-response roots and known wrappers. Keep media,
  // captions, recommendations, and unrelated JSON fields intact.
  function stripPlayerAds(value) {
    let removed = 0;
    const seen = new WeakSet();
    function visit(node) {
      if (!node || typeof node !== "object" || seen.has(node)) return;
      seen.add(node);
      if (Array.isArray(node)) {
        for (const item of node) visit(item);
        return;
      }
      for (const key of AD_KEYS) {
        if (Object.prototype.hasOwnProperty.call(node, key)) {
          try { if (delete node[key]) removed++; } catch { /* A frozen response stays usable. */ }
        }
      }
      visit(node.playerResponse);
      if (typeof node.player_response === "string") {
        try {
          const player = JSON.parse(node.player_response);
          const count = stripPlayerAds(player);
          if (count) {
            node.player_response = JSON.stringify(player);
            removed += count;
          }
        } catch { /* Unknown response formats pass through. */ }
      }
    }
    visit(value);
    return removed;
  }

  function filterPlayerText(text) {
    if (typeof text !== "string" || !AD_KEYS.some(key => text.includes('"' + key + '"'))) return { text, removed: 0 };
    const prefix = text.match(/^\s*\)\]\}'[^\n]*\n/)?.[0] || "";
    try {
      const value = JSON.parse(text.slice(prefix.length));
      const removed = stripPlayerAds(value);
      return { text: removed ? prefix + JSON.stringify(value) : text, removed };
    } catch {
      return { text, removed: 0 };
    }
  }

  class AdSkipper {
    constructor({ now = () => Date.now(), isVisible = node => node.getClientRects().length > 0 } = {}) {
      this.now = now;
      this.isVisible = isVisible;
      this.states = new WeakMap();
      this.navigation = 0;
    }

    reset() { this.states = new WeakMap(); }
    beginNavigation() { this.navigation++; }

    update(player) {
      const video = player.querySelector("video");
      const isAd = player.classList.contains("ad-showing") || player.classList.contains("ad-interrupting");
      let state = this.states.get(player);
      if (!state) {
        state = { contentSource: null, contentDuration: null, lastAction: -Infinity, adKey: null, navigation: this.navigation };
        this.states.set(player, state);
      }
      if (state.navigation !== this.navigation) {
        // Start a new ad cycle without forgetting the outgoing content source.
        // YouTube may change the player class before replacing that media.
        state.navigation = this.navigation;
        state.adKey = null;
        state.lastAction = -Infinity;
      }
      if (!isAd) {
        state.adKey = null;
        state.lastAction = -Infinity;
        if (video?.currentSrc) {
          state.contentSource = video.currentSrc;
          state.contentDuration = video.duration;
        }
        return null;
      }
      const now = this.now();
      if (now - state.lastAction < 1000) return null;
      if (video?.paused) return null;
      for (const button of player.querySelectorAll(SKIP_SELECTOR)) {
        if (!button.disabled && button.getAttribute("aria-disabled") !== "true" && this.isVisible(button)) {
          button.click();
          state.lastAction = now;
          return "click";
        }
      }
      // Never change mute, volume, playback speed, or the user's paused state.
      // Remember normal media so a mid-roll class arriving before its media
      // source cannot seek the content video to the end.
      if (!video || video.paused || video.readyState < 1 || !video.currentSrc) return null;
      if (video.currentSrc === state.contentSource && video.duration === state.contentDuration) return null;
      if (!Number.isFinite(video.duration) || video.duration <= 0 || video.duration > 300) return null;
      const key = video.currentSrc + "|" + video.duration;
      if (state.adKey === key || video.currentTime >= video.duration - 0.1) return null;
      try {
        video.currentTime = video.duration;
        state.adKey = key;
        state.lastAction = now;
        return "seek";
      } catch {
        return null;
      }
    }
  }

  const api = Object.freeze({ DEFAULT_SETTINGS, AD_CARD_SELECTOR, normalizeSettings, isPlayerRequest, stripPlayerAds, filterPlayerText, AdSkipper });
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.QuietTubeCore = api;
})(globalThis);
