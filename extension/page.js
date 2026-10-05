(() => {
  "use strict";
  const core = globalThis.QuietTubeCore;
  const CONFIG_EVENT = "quiettube:configure";
  const STATUS_EVENT = "quiettube:page-status";
  let enabled = false;
  let responsesFiltered = 0;
  let error = null;

  function report() {
    document.dispatchEvent(new CustomEvent(STATUS_EVENT, {
      detail: JSON.stringify({ ready: !error, active: enabled, responsesFiltered, error })
    }));
  }
  function record(removed) {
    if (removed) { responsesFiltered++; report(); }
  }
  function prune(value) {
    if (enabled) record(core.stripPlayerAds(value));
    return value;
  }

  // A browser that ignores `world: MAIN` must not report a working page hook.
  if (globalThis.browser?.runtime?.id) error = "The player filter requires page-world content script support.";

  document.addEventListener(CONFIG_EVENT, event => {
    try {
      const config = JSON.parse(event.detail);
      enabled = !error && config.enabled === true && config.filterPlayerResponses === true;
      if (enabled) prune(window.ytInitialPlayerResponse);
      report();
    } catch { /* The webpage can send these events; accept only booleans. */ }
  });
  if (error) { report(); return; }

  try {
    const descriptor = Object.getOwnPropertyDescriptor(window, "ytInitialPlayerResponse");
    if (!descriptor || (descriptor.configurable && !descriptor.get && descriptor.writable !== false)) {
      let initialResponse = descriptor?.value;
      Object.defineProperty(window, "ytInitialPlayerResponse", {
        configurable: true,
        enumerable: descriptor?.enumerable ?? true,
        get() { return prune(initialResponse); },
        set(value) { initialResponse = prune(value); }
      });
    }

    const nativeFetch = window.fetch;
    window.fetch = async function (...args) {
      const response = await Reflect.apply(nativeFetch, this, args);
      if (!enabled || !response.ok || !core.isPlayerRequest(args[0], location.href)) return response;
      try {
        const filtered = core.filterPlayerText(await response.clone().text());
        if (!enabled || !filtered.removed) return response;
        const headers = new Headers(response.headers);
        headers.delete("content-length");
        headers.delete("content-encoding");
        const replacement = new Response(filtered.text, { status: response.status, statusText: response.statusText, headers });
        for (const key of ["url", "redirected", "type"]) {
          Object.defineProperty(replacement, key, { value: response[key], configurable: true });
        }
        record(filtered.removed);
        return replacement;
      } catch { return response; }
    };

    const prototype = XMLHttpRequest.prototype;
    const nativeOpen = prototype.open;
    const requests = new WeakMap();
    prototype.open = function (...args) {
      requests.set(this, { player: core.isPlayerRequest(args[1], location.href), raw: undefined, filtered: undefined });
      return Reflect.apply(nativeOpen, this, args);
    };
    for (const key of ["responseText", "response"]) {
      const native = Object.getOwnPropertyDescriptor(prototype, key);
      if (!native?.get || !native.configurable) continue;
      Object.defineProperty(prototype, key, {
        ...native,
        get() {
          const value = Reflect.apply(native.get, this, []);
          const request = requests.get(this);
          if (!enabled || !request?.player || this.readyState !== 4 || this.status < 200 || this.status >= 300) return value;
          if (key === "response" && this.responseType === "json") return prune(value);
          if (typeof value !== "string") return value;
          if (request.raw !== value) {
            const result = core.filterPlayerText(value);
            request.raw = value;
            request.filtered = result.text;
            record(result.removed);
          }
          return request.filtered;
        }
      });
    }
  } catch {
    error = "A player response hook could not be installed. The skip fallback remains available.";
    enabled = false;
  }
  report();
})();
