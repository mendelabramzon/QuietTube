(() => {
  "use strict";
  const api = globalThis.browser;
  const form = document.getElementById("settings");
  const status = document.getElementById("status");
  const error = document.getElementById("error");
  const reload = document.getElementById("reload");
  let currentSettings;
  let tabId;
  let refreshTimer;
  let saving = false;
  let operationError = null;
  function showError(message) { error.textContent = message || ""; error.hidden = !message; }
  function renderSettings(value) {
    currentSettings = value;
    for (const [key, checked] of Object.entries(value)) form.elements.namedItem(key).checked = checked;
    form.elements.namedItem("enabled").disabled = saving;
    form.querySelector("fieldset").disabled = saving || !value.enabled;
  }
  async function refresh() {
    if (tabId === undefined) return;
    try {
      const page = await api.tabs.sendMessage(tabId, { type: "status.get" }, { frameId: 0 });
      reload.disabled = false;
      for (const [key, count] of Object.entries(page.stats)) document.getElementById(key).textContent = String(count);
      status.textContent = !page.settings.enabled ? "QuietTube is paused." : page.pageActive ? "Player filtering is active on this page." : page.settings.filterPlayerResponses ? "The player filter is not running on this page." : "Player filtering is off. Other selected filters are active.";
      showError(operationError || page.error);
    } catch {
      status.textContent = currentSettings?.enabled ? "Open YouTube and allow QuietTube access in Safari." : "QuietTube is paused.";
      reload.disabled = true;
      for (const key of ["responsesFiltered", "skipActions", "adCardsHidden"]) document.getElementById(key).textContent = "—";
    }
  }
  form.addEventListener("change", async event => {
    const input = event.target;
    if (input.type !== "checkbox" || saving) return;
    saving = true;
    const patch = { [input.name]: input.checked };
    renderSettings(currentSettings);
    operationError = null;
    showError(null);
    try {
      const result = await api.runtime.sendMessage({ type: "settings.set", patch });
      if (!result?.ok) throw new Error(result?.error || "Settings could not be saved.");
      currentSettings = result.settings;
      document.getElementById("hint").textContent = "Reload YouTube to apply player filtering to a fresh response.";
    } catch (cause) { operationError = cause.message; showError(operationError); }
    finally { saving = false; renderSettings(currentSettings); }
    await refresh();
  });
  reload.addEventListener("click", async () => {
    try { await api.tabs.reload(tabId); window.close(); }
    catch (cause) { showError(cause.message); }
  });
  async function initialize() {
    try {
      const result = await api.runtime.sendMessage({ type: "settings.get" });
      if (!result?.ok) throw new Error("Settings could not be loaded.");
      renderSettings(result.settings);
      const tabs = await api.tabs.query({ active: true, currentWindow: true });
      tabId = tabs[0]?.id;
      await refresh();
      refreshTimer = setInterval(refresh, 1000);
    } catch (cause) { status.textContent = "QuietTube could not start."; showError(cause.message); }
  }
  window.addEventListener("pagehide", () => clearInterval(refreshTimer));
  initialize();
})();
