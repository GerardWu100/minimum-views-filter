(function () {
  "use strict";

  const extension = globalThis.browser || globalThis.chrome;
  const {
    normalizeSettings, parseWhitelistInput, oversizedSyncKeys,
    formatSettingsTransfer, parseSettingsTransfer, MAXIMUM_VIEWS, STORAGE_AREA,
  } = globalThis.MinimumViewsSettings;
  const storage = extension.storage[STORAGE_AREA];
  const form = document.getElementById("settings-form");
  const controls = document.getElementById("controls");
  const siteFields = ["x", "youtube"].map((site) => ({
    site,
    name: site === "x" ? "X" : "YouTube",
    minimum: document.getElementById(site + "-minimum-views"),
    whitelist: document.getElementById(site + "-whitelist"),
    enabled: document.getElementById(site + "-enabled"),
  }));
  const hideUnknown = document.getElementById("hide-unknown");
  const ratioFields = [
    {key: "xLowLikeRatioEnabled", input: document.getElementById("x-low-like-ratio-enabled")},
    {key: "xMinimumLikePercent", input: document.getElementById("x-minimum-like-percent")},
    {key: "xHighLikeRatioEnabled", input: document.getElementById("x-high-like-ratio-enabled")},
    {key: "xKeepLikePercent", input: document.getElementById("x-keep-like-percent")},
    {key: "xHighBookmarkRatioEnabled", input: document.getElementById("x-high-bookmark-ratio-enabled")},
    {key: "xKeepBookmarkPercent", input: document.getElementById("x-keep-bookmark-percent")},
  ];
  const transferText = document.getElementById("transfer-text");
  const status = document.getElementById("status");

  function showSettings(settings) {
    for (const {site, minimum, whitelist, enabled} of siteFields) {
      minimum.value = settings[site + "MinimumViews"];
      whitelist.value = settings[site + "Whitelist"].map((identifier) => site === "x" ? "@" + identifier : identifier).join("\n");
      enabled.checked = settings[site + "Enabled"];
    }
    hideUnknown.checked = settings.hideUnknown;
    for (const {key, input} of ratioFields) {
      if (key.endsWith("Enabled")) input.checked = settings[key];
      else input.value = settings[key];
    }
  }

  function reportWhitelistProblem(whitelist, message) {
    status.textContent = message;
    whitelist.closest("details").open = true;
    whitelist.focus();
  }

  /** Validate every control; report the first problem and return null, else settings. */
  function readForm() {
    const settings = {hideUnknown: hideUnknown.checked};
    for (const {site, name, minimum, whitelist, enabled} of siteFields) {
      const value = Number(minimum.value);
      if (minimum.value.trim() === "" || !Number.isSafeInteger(value) || value < 0 || value > MAXIMUM_VIEWS) {
        status.textContent = name + ": enter a whole number from 0 to 1,000,000,000,000.";
        minimum.focus();
        return null;
      }
      const parsed = parseWhitelistInput(whitelist.value, site);
      if (parsed.invalidEntries.length) {
        reportWhitelistProblem(whitelist, name + ": use " + (site === "x" ? "@handles or X profile URLs" : "@handles or YouTube channel URLs") + ", one per line or separated by commas.");
        return null;
      }
      settings[site + "MinimumViews"] = value;
      settings[site + "Whitelist"] = parsed.identifiers;
      settings[site + "Enabled"] = enabled.checked;
      if (oversizedSyncKeys({[site + "Whitelist"]: parsed.identifiers}).length) {
        reportWhitelistProblem(whitelist, name + " whitelist is too long to sync. Remove some entries.");
        return null;
      }
    }
    for (const {key, input} of ratioFields) {
      if (key.endsWith("Enabled")) {
        settings[key] = input.checked;
        continue;
      }
      const percent = Number(input.value);
      if (input.value.trim() === "" || !Number.isFinite(percent) || percent < 0 || percent > 100) {
        status.textContent = "Enter a percentage from 0 to 100.";
        input.focus();
        return null;
      }
      settings[key] = percent;
    }
    return settings;
  }

  storage.get(null).then((stored) => {
    showSettings(normalizeSettings(stored));
    controls.disabled = false;
  }).catch(() => {
    status.textContent = "Could not load settings. Reopen the extension.";
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const settings = readForm();
    if (!settings) return;
    controls.disabled = true;
    try {
      await storage.set(settings);
      status.textContent = "Saved. Open feeds update automatically.";
    } catch {
      status.textContent = "Could not save. Please try again.";
    } finally {
      controls.disabled = false;
    }
  });

  document.getElementById("copy-settings").addEventListener("click", async () => {
    const settings = readForm();
    if (!settings) return;
    transferText.value = formatSettingsTransfer(settings);
    transferText.select();
    try {
      await navigator.clipboard.writeText(transferText.value);
      status.textContent = "Copied. Paste it into the popup in the other browser.";
    } catch {
      status.textContent = "Selected. Copy the text, then paste it in the other browser.";
    }
  });

  document.getElementById("load-settings").addEventListener("click", () => {
    const settings = parseSettingsTransfer(transferText.value);
    if (!settings) {
      status.textContent = "Paste the complete text copied from this extension.";
      transferText.focus();
      return;
    }
    showSettings(settings);
    status.textContent = "Loaded. Click Save to apply.";
  });

  document.getElementById("filtered-items").addEventListener("click", async () => {
    try {
      await extension.tabs.create({url: extension.runtime.getURL("history.html")});
    } catch {
      status.textContent = "Could not open filtered items. Please try again.";
    }
  });
})();
