(function () {
  "use strict";

  const extension = globalThis.browser || globalThis.chrome;
  const {normalizeSettings, MAXIMUM_VIEWS} = globalThis.MinimumViewsSettings;
  const form = document.getElementById("settings-form");
  const controls = document.getElementById("controls");
  const minimumViews = document.getElementById("minimum-views");
  const xEnabled = document.getElementById("x-enabled");
  const youtubeEnabled = document.getElementById("youtube-enabled");
  const hideUnknown = document.getElementById("hide-unknown");
  const status = document.getElementById("status");

  extension.storage.local.get(null).then((stored) => {
    const settings = normalizeSettings(stored);
    minimumViews.value = settings.minimumViews;
    xEnabled.checked = settings.xEnabled;
    youtubeEnabled.checked = settings.youtubeEnabled;
    hideUnknown.checked = settings.hideUnknown;
    controls.disabled = false;
  }).catch(() => {
    status.textContent = "Could not load settings. Reopen the extension.";
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = Number(minimumViews.value);
    if (minimumViews.value.trim() === "" || !Number.isSafeInteger(value) || value < 0 || value > MAXIMUM_VIEWS) {
      status.textContent = "Enter a whole number from 0 to 1,000,000,000,000.";
      minimumViews.focus();
      return;
    }
    controls.disabled = true;
    try {
      await extension.storage.local.set({
        minimumViews: value,
        xEnabled: xEnabled.checked,
        youtubeEnabled: youtubeEnabled.checked,
        hideUnknown: hideUnknown.checked,
      });
      status.textContent = "Saved. Open feeds update automatically.";
    } catch {
      status.textContent = "Could not save. Please try again.";
    } finally {
      controls.disabled = false;
    }
  });
})();
