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
  const status = document.getElementById("status");
  const transferText = document.getElementById("transfer-text");
  const hideUnknown = document.getElementById("hide-unknown");
  const statisticsEnabled = document.getElementById("statistics-enabled");
  const siteFields = ["x", "youtube"].map((site) => ({
    site,
    name: site === "x" ? "X" : "YouTube",
    enabled: document.getElementById(site + "-enabled"),
    minimumEnabled: document.getElementById(site + "-minimum-views-enabled"),
    minimum: document.getElementById(site + "-minimum-views"),
    whitelistEnabled: document.getElementById(site + "-whitelist-enabled"),
    whitelist: document.getElementById(site + "-whitelist"),
    whitelistSize: document.getElementById(site + "-whitelist-size"),
  }));
  const ratioFields = [
    {key: "xLowLikeRatioEnabled", input: document.getElementById("x-low-like-ratio-enabled")},
    {key: "xMinimumLikePercent", input: document.getElementById("x-minimum-like-percent")},
    {key: "xHighLikeRatioEnabled", input: document.getElementById("x-high-like-ratio-enabled")},
    {key: "xKeepLikePercent", input: document.getElementById("x-keep-like-percent")},
    {key: "xHighBookmarkRatioEnabled", input: document.getElementById("x-high-bookmark-ratio-enabled")},
    {key: "xKeepBookmarkPercent", input: document.getElementById("x-keep-bookmark-percent")},
    {key: "xBookmarkHighlightEnabled", input: document.getElementById("x-bookmark-highlight-enabled")},
    {key: "xHighlightBookmarkPercent", input: document.getElementById("x-highlight-bookmark-percent")},
    {key: "xBookmarkHighlightShown", input: document.getElementById("x-bookmark-highlight-shown")},
    {key: "xHighlightLikeRequired", input: document.getElementById("x-highlight-like-required")},
    {key: "xHighlightLikePercent", input: document.getElementById("x-highlight-like-percent")},
    {key: "xHighReplyRatioEnabled", input: document.getElementById("x-high-reply-ratio-enabled")},
    {key: "xKeepReplyPercent", input: document.getElementById("x-keep-reply-percent")},
    {key: "xHighlightReplyRequired", input: document.getElementById("x-highlight-reply-required")},
    {key: "xHighlightReplyPercent", input: document.getElementById("x-highlight-reply-percent")},
  ];
  const highlightDetection = document.getElementById("x-bookmark-highlight-enabled");
  const highlightShown = document.getElementById("x-bookmark-highlight-shown");
  // Highlight conditions whose switch and threshold depend on detection.
  const highlightConditions = [
    ["x-highlight-like-required", "x-highlight-like-percent", "xHighlightLikePercent"],
    ["x-highlight-reply-required", "x-highlight-reply-percent", "xHighlightReplyPercent"],
  ];
  const ratioThresholds = [
    ["x-low-like-ratio-enabled", "x-minimum-like-percent", "xMinimumLikePercent"],
    ["x-high-like-ratio-enabled", "x-keep-like-percent", "xKeepLikePercent"],
    ["x-high-bookmark-ratio-enabled", "x-keep-bookmark-percent", "xKeepBookmarkPercent"],
    ["x-high-reply-ratio-enabled", "x-keep-reply-percent", "xKeepReplyPercent"],
    ["x-bookmark-highlight-enabled", "x-highlight-bookmark-percent", "xHighlightBookmarkPercent"],
  ];
  const DEFAULT_SETTINGS = normalizeSettings();
  const SWITCH_ANIMATION_DELAY_MS = 100;
  let lastSavedSettings = DEFAULT_SETTINGS;

  function validMinimum(input) {
    const value = Number(input.value);
    return input.value.trim() !== "" && Number.isSafeInteger(value) && value >= 0 && value <= MAXIMUM_VIEWS;
  }

  function validPercent(input) {
    const value = Number(input.value);
    return input.value.trim() !== "" && Number.isFinite(value) && value >= 0 && value <= 100;
  }

  /** Show the number of valid, distinct whitelist entries. */
  function showWhitelistSize({site, whitelist, whitelistSize}) {
    const size = parseWhitelistInput(whitelist.value, site).identifiers.length;
    whitelistSize.textContent = size ? size.toLocaleString() : "";
  }

  /** Reflect which settings currently affect filtering without erasing their values. */
  function updateControlAvailability() {
    for (const fields of siteFields) {
      const active = fields.enabled.checked;
      fields.minimumEnabled.disabled = !active;
      fields.minimum.disabled = !active || !fields.minimumEnabled.checked;
      fields.whitelistEnabled.disabled = !active;
      fields.whitelist.disabled = !active || !fields.whitelistEnabled.checked;
      // An inactive rule retains its last valid value, so it can be saved or turned on later.
      if (fields.minimum.disabled && !validMinimum(fields.minimum)) {
        fields.minimum.value = lastSavedSettings[fields.site + "MinimumViews"];
      }
      if (fields.whitelist.disabled && parseWhitelistInput(fields.whitelist.value, fields.site).invalidEntries.length) {
        fields.whitelist.value = lastSavedSettings[fields.site + "Whitelist"].map((identifier) => fields.site === "x" ? "@" + identifier : identifier).join("\n");
        showWhitelistSize(fields);
      }
    }
    const xActive = siteFields[0].enabled.checked;
    for (const [switchId, thresholdId, settingKey] of ratioThresholds) {
      const toggle = document.getElementById(switchId);
      toggle.disabled = !xActive;
      const threshold = document.getElementById(thresholdId);
      threshold.disabled = !xActive || !toggle.checked;
      if (threshold.disabled && !validPercent(threshold)) threshold.value = lastSavedSettings[settingKey];
    }
    // Showing the edge and the likes condition depend on detection;
    // recording depends on statistics.
    highlightShown.disabled = !xActive || !highlightDetection.checked;
    for (const [switchId, thresholdId, settingKey] of highlightConditions) {
      const toggle = document.getElementById(switchId);
      const threshold = document.getElementById(thresholdId);
      toggle.disabled = !xActive || !highlightDetection.checked;
      threshold.disabled = toggle.disabled || !toggle.checked;
      if (threshold.disabled && !validPercent(threshold)) threshold.value = lastSavedSettings[settingKey];
    }
  }

  function showSettings(settings) {
    for (const fields of siteFields) {
      const {site, minimum, whitelist, enabled, minimumEnabled, whitelistEnabled} = fields;
      minimum.value = settings[site + "MinimumViews"];
      whitelist.value = settings[site + "Whitelist"].map((identifier) => site === "x" ? "@" + identifier : identifier).join("\n");
      enabled.checked = settings[site + "Enabled"];
      minimumEnabled.checked = settings[site + "MinimumViewsEnabled"];
      whitelistEnabled.checked = settings[site + "WhitelistEnabled"];
      showWhitelistSize(fields);
    }
    hideUnknown.checked = settings.hideUnknown;
    statisticsEnabled.checked = settings.statisticsEnabled;
    for (const {key, input} of ratioFields) {
      if (typeof DEFAULT_SETTINGS[key] === "boolean") input.checked = settings[key];
      else input.value = settings[key];
    }
    updateControlAvailability();
  }

  function reportWhitelistProblem(whitelist, message) {
    status.textContent = message;
    whitelist.closest("details").open = true;
    whitelist.focus();
  }

  /** Validate saved values even for rules that are currently switched off. */
  function readForm() {
    const settings = {hideUnknown: hideUnknown.checked, statisticsEnabled: statisticsEnabled.checked};
    for (const {site, name, minimum, whitelist, enabled, minimumEnabled, whitelistEnabled} of siteFields) {
      const value = Number(minimum.value);
      if (!validMinimum(minimum)) {
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
      settings[site + "MinimumViewsEnabled"] = minimumEnabled.checked;
      settings[site + "Whitelist"] = parsed.identifiers;
      settings[site + "WhitelistEnabled"] = whitelistEnabled.checked;
      settings[site + "Enabled"] = enabled.checked;
      if (oversizedSyncKeys({[site + "Whitelist"]: parsed.identifiers}).length) {
        reportWhitelistProblem(whitelist, name + " whitelist is too long to sync. Remove some entries.");
        return null;
      }
    }
    for (const {key, input} of ratioFields) {
      if (typeof DEFAULT_SETTINGS[key] === "boolean") {
        settings[key] = input.checked;
        continue;
      }
      const percent = Number(input.value);
      if (!validPercent(input)) {
        status.textContent = "Enter a percentage from 0 to 100.";
        input.closest("details").open = true;
        input.focus();
        return null;
      }
      settings[key] = percent;
    }
    return settings;
  }

  storage.get(null).then((stored) => {
    lastSavedSettings = normalizeSettings(stored);
    showSettings(lastSavedSettings);
    controls.disabled = false;
    setTimeout(() => document.body.toggleAttribute("data-settings-shown", true), SWITCH_ANIMATION_DELAY_MS);
  }).catch(() => {
    status.textContent = "Could not load settings. Reopen the extension.";
  });

  form.addEventListener("change", updateControlAvailability);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const settings = readForm();
    if (!settings) return;
    controls.disabled = true;
    try {
      await storage.set(settings);
      lastSavedSettings = settings;
      status.textContent = "Saved. Open feeds update automatically.";
    } catch {
      status.textContent = "Could not save. Please try again.";
    } finally {
      controls.disabled = false;
      updateControlAvailability();
    }
  });

  document.getElementById("copy-settings").addEventListener("click", async () => {
    const settings = readForm();
    if (!settings) return;
    transferText.value = formatSettingsTransfer(settings);
    transferText.select();
    try {
      await navigator.clipboard.writeText(transferText.value);
      status.textContent = "Copied. Paste it into Settings in the other browser.";
    } catch {
      status.textContent = "Selected. Copy the text, then paste it into Settings in the other browser.";
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

  for (const fields of siteFields) fields.whitelist.addEventListener("input", () => showWhitelistSize(fields));
})();
