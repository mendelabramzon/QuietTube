(() => {
  "use strict";
  const api = globalThis.browser;
  const core = globalThis.QuietTubeCore;
  let queue = Promise.resolve();
  function serialize(task) {
    const pending = queue.then(task);
    queue = pending.catch(() => {});
    return pending;
  }
  async function readSettings() {
    const stored = await api.storage.local.get("settings");
    return core.normalizeSettings(stored.settings);
  }
  async function syncRules(settings) {
    const enabled = settings.enabled && settings.blockAdRequests;
    const current = await api.declarativeNetRequest.getEnabledRulesets();
    if (current.includes("youtube_ads") === enabled) return;
    // Omit the unused operation and avoid redundant updates. Safari can reject
    // a disable operation for a ruleset that is already inactive.
    await api.declarativeNetRequest.updateEnabledRulesets(enabled
      ? { enableRulesetIds: ["youtube_ads"] }
      : { disableRulesetIds: ["youtube_ads"] });
  }
  async function saveSettings(patch) {
    if (!patch || typeof patch !== "object" || Array.isArray(patch) || Object.entries(patch).some(([key, value]) => !Object.hasOwn(core.DEFAULT_SETTINGS, key) || typeof value !== "boolean")) {
      throw new Error("Invalid settings.");
    }
    const previous = await readSettings();
    const next = core.normalizeSettings({ ...previous, ...patch });
    await syncRules(next);
    try { await api.storage.local.set({ settings: next }); }
    catch (error) { await syncRules(previous); throw error; }
    return next;
  }
  function initialize() {
    return serialize(async () => syncRules(await readSettings())).catch(error => console.error("QuietTube rule initialization failed:", error));
  }
  api.runtime.onInstalled.addListener(initialize);
  api.runtime.onStartup.addListener(initialize);
  api.runtime.onMessage.addListener(message => {
    if (message?.type === "settings.get") return serialize(readSettings).then(settings => ({ ok: true, settings }));
    if (message?.type === "settings.set") {
      return serialize(() => saveSettings(message.patch)).then(
        settings => ({ ok: true, settings }),
        error => ({ ok: false, error: error.message || "Settings could not be saved." })
      );
    }
    return undefined;
  });
  initialize();
})();
