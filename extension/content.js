(() => {
  "use strict";
  const api = globalThis.browser;
  const core = globalThis.QuietTubeCore;
  let settings = { ...core.DEFAULT_SETTINGS, enabled: false };
  let suspended = false;
  let navigating = false;
  let timer = null;
  let pendingScan = null;
  let pageReady = false;
  let pageActive = false;
  let pageError = null;
  let storageError = null;
  let settingsRevision = 0;
  const stats = { responsesFiltered: 0, skipActions: 0, adCardsHidden: 0 };
  const seenCards = new WeakSet();
  const skipper = new core.AdSkipper({ isVisible: node => {
    const style = getComputedStyle(node);
    return node.getClientRects().length > 0 && style.visibility !== "hidden" && style.display !== "none";
  }});

  function configurePage() {
    document.dispatchEvent(new CustomEvent("quiettube:configure", {
      detail: JSON.stringify({ enabled: settings.enabled && !suspended, filterPlayerResponses: settings.filterPlayerResponses })
    }));
  }
  function syncCosmetics() {
    document.documentElement?.setAttribute("data-quiettube-hide-ads", String(settings.enabled && settings.hideAdCards && !suspended));
  }
  function scan() {
    if (pendingScan !== null) clearTimeout(pendingScan);
    pendingScan = null;
    syncCosmetics();
    if (!settings.enabled || suspended) return;
    if (settings.hideAdCards) {
      for (const card of document.querySelectorAll(core.AD_CARD_SELECTOR)) {
        if (!seenCards.has(card)) { seenCards.add(card); stats.adCardsHidden++; }
      }
    }
    if (settings.skipAds && !navigating) {
      for (const player of document.querySelectorAll(".html5-video-player")) {
        if (skipper.update(player)) stats.skipActions++;
      }
    }
  }
  function scheduleScan() {
    if (pendingScan === null && !suspended && settings.enabled) pendingScan = setTimeout(scan, 100);
  }
  const observer = new MutationObserver(scheduleScan);
  function start() {
    observer.observe(document, { childList: true, subtree: true });
    if (timer === null) timer = setInterval(scan, 250);
    configurePage();
    scan();
  }
  function stop() {
    observer.disconnect();
    clearInterval(timer);
    clearTimeout(pendingScan);
    timer = null;
    pendingScan = null;
  }
  function apply(value) {
    settings = core.normalizeSettings(value);
    storageError = null;
    stop();
    if (settings.enabled && !suspended) start();
    else { configurePage(); syncCosmetics(); }
  }

  // Page-world events carry only disposable counters and flags. They never
  // trigger storage changes, privileged APIs, or network requests.
  document.addEventListener("quiettube:page-status", event => {
    try {
      const value = JSON.parse(event.detail);
      pageReady = value.ready === true;
      pageActive = value.active === true;
      if (Number.isSafeInteger(value.responsesFiltered) && value.responsesFiltered >= 0 && value.responsesFiltered <= 100000) {
        stats.responsesFiltered = value.responsesFiltered;
      }
      pageError = typeof value.error === "string" ? value.error.slice(0, 200) : null;
    } catch { /* Ignore malformed page events. */ }
  });
  document.addEventListener("yt-navigate-start", () => { navigating = true; skipper.beginNavigation(); });
  document.addEventListener("yt-navigate-finish", () => { navigating = false; scheduleScan(); });
  document.addEventListener("DOMContentLoaded", () => { syncCosmetics(); scheduleScan(); }, { once: true });
  window.addEventListener("pagehide", () => { suspended = true; stop(); configurePage(); });
  window.addEventListener("pageshow", event => { if (event.persisted) { suspended = false; apply(settings); } });
  api.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.settings) {
      settingsRevision++;
      apply(changes.settings.newValue);
    }
  });
  api.runtime.onMessage.addListener(message => {
    if (message?.type === "status.get") {
      return Promise.resolve({ settings, stats: { ...stats }, pageReady, pageActive, error: storageError || pageError });
    }
    return undefined;
  });
  const initialRevision = settingsRevision;
  api.storage.local.get("settings").then(value => {
    if (settingsRevision === initialRevision) apply(value.settings);
  }).catch(() => {
    if (settingsRevision === initialRevision) storageError = "Settings could not be loaded. Reload this page to try again.";
  });
})();
