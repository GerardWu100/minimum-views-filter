(function () {
  "use strict";

  const extension = globalThis.browser || globalThis.chrome;
  const {
    normalizeSettings, parseWhitelistInput, oversizedSyncKeys,
    formatSettingsTransfer, parseSettingsTransfer, MAXIMUM_VIEWS, STORAGE_AREA, UPDATE_SETTINGS_MESSAGE,
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
  const xFields = [
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
    {key: "xThreadContextEnabled", input: document.getElementById("x-thread-context-enabled")},
  ];
  const highlightDetection = document.getElementById("x-bookmark-highlight-enabled");
  const highlightShown = document.getElementById("x-bookmark-highlight-shown");
  const threadContext = document.getElementById("x-thread-context-enabled");
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
  // Stored value each control last matched, key by key. A control that differs
  // from it holds an unsaved edit; only those edits are saved.
  let baseline = {...DEFAULT_SETTINGS};

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
        fields.minimum.value = baseline[fields.site + "MinimumViews"];
      }
      if (fields.whitelist.disabled && parseWhitelistInput(fields.whitelist.value, fields.site).invalidEntries.length) {
        fields.whitelist.value = formatWhitelist(fields.site, baseline[fields.site + "Whitelist"]);
        showWhitelistSize(fields);
      }
    }
    const xActive = siteFields[0].enabled.checked;
    for (const [switchId, thresholdId, settingKey] of ratioThresholds) {
      const toggle = document.getElementById(switchId);
      toggle.disabled = !xActive;
      const threshold = document.getElementById(thresholdId);
      threshold.disabled = !xActive || !toggle.checked;
      if (threshold.disabled && !validPercent(threshold)) threshold.value = baseline[settingKey];
    }
    threadContext.disabled = !xActive;
    // Showing the edge and the likes condition depend on detection;
    // recording depends on statistics.
    highlightShown.disabled = !xActive || !highlightDetection.checked;
    for (const [switchId, thresholdId, settingKey] of highlightConditions) {
      const toggle = document.getElementById(switchId);
      const threshold = document.getElementById(thresholdId);
      toggle.disabled = !xActive || !highlightDetection.checked;
      threshold.disabled = toggle.disabled || !toggle.checked;
      if (threshold.disabled && !validPercent(threshold)) threshold.value = baseline[settingKey];
    }
  }

  // Settings key -> {input, kind, fields}; kind is "boolean", "minimum",
  // "percent" or "whitelist", and fields is the site's group for whitelists.
  const controlsByKey = new Map([
    ["hideUnknown", {input: hideUnknown, kind: "boolean"}],
    ["statisticsEnabled", {input: statisticsEnabled, kind: "boolean"}],
    ...siteFields.flatMap((fields) => [
      [fields.site + "Enabled", {input: fields.enabled, kind: "boolean"}],
      [fields.site + "MinimumViewsEnabled", {input: fields.minimumEnabled, kind: "boolean"}],
      [fields.site + "MinimumViews", {input: fields.minimum, kind: "minimum"}],
      [fields.site + "WhitelistEnabled", {input: fields.whitelistEnabled, kind: "boolean"}],
      [fields.site + "Whitelist", {input: fields.whitelist, kind: "whitelist", fields}],
    ]),
    ...xFields.map(({key, input}) => [key, {input, kind: typeof DEFAULT_SETTINGS[key] === "boolean" ? "boolean" : "percent"}]),
  ]);

  function formatWhitelist(site, identifiers) {
    return identifiers.map((identifier) => site === "x" ? "@" + identifier : identifier).join("\n");
  }

  /** Read one control as a setting value, or null while its text is invalid. */
  function controlValue(key) {
    const {input, kind, fields} = controlsByKey.get(key);
    if (kind === "boolean") return input.checked;
    if (kind === "minimum") return validMinimum(input) ? Number(input.value) : null;
    if (kind === "percent") return validPercent(input) ? Number(input.value) : null;
    const parsed = parseWhitelistInput(input.value, fields.site);
    return parsed.invalidEntries.length ? null : parsed.identifiers;
  }

  /** Compare setting values; whitelist order carries no meaning. */
  function sameValue(first, second) {
    if (!Array.isArray(first) || !Array.isArray(second)) return first === second;
    const members = new Set(first);
    return members.size === new Set(second).size && second.every((identifier) => members.has(identifier));
  }

  function setControl(key, value) {
    const {input, kind, fields} = controlsByKey.get(key);
    if (kind === "boolean") input.checked = value;
    else if (kind === "whitelist") {
      input.value = formatWhitelist(fields.site, value);
      showWhitelistSize(fields);
    } else input.value = value;
  }

  function showSettings(settings) {
    for (const key of controlsByKey.keys()) setControl(key, settings[key]);
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
    for (const {key, input} of xFields) {
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

  /**
   * Follow a change another tab, the context menu, or browser sync stored.
   *
   * A control still showing its baseline takes the new value. A control the
   * user edited keeps the edit, which wins when saved; whitelist edits are
   * saved as additions and removals, so the other change's entries survive.
   */
  function applyStoredChanges(changes) {
    let keptEdits = false;
    for (const key of controlsByKey.keys()) {
      if (!Object.hasOwn(changes, key)) continue;
      const value = normalizeSettings({[key]: changes[key].newValue})[key];
      const current = controlValue(key);
      if (current !== null && sameValue(current, value)) {
        baseline[key] = value;
      } else if (current !== null && sameValue(current, baseline[key])) {
        setControl(key, value);
        baseline[key] = value;
      } else {
        keptEdits = true;
      }
    }
    updateControlAvailability();
    if (keptEdits) status.textContent = "Settings changed elsewhere. Your unsaved edits are kept; Save applies them.";
  }

  // Changes stored before the first read resolves; merged over its result.
  let changesDuringLoad = {};
  extension.storage.onChanged.addListener((changes, area) => {
    if (area !== STORAGE_AREA) return;
    if (changesDuringLoad) Object.assign(changesDuringLoad, changes);
    else applyStoredChanges(changes);
  });

  storage.get(null).then((stored) => {
    const pending = Object.fromEntries(Object.entries(changesDuringLoad).map(([key, {newValue}]) => [key, newValue]));
    changesDuringLoad = null;
    baseline = normalizeSettings({...stored, ...pending});
    showSettings(baseline);
    controls.disabled = false;
    setTimeout(() => document.body.toggleAttribute("data-settings-shown", true), SWITCH_ANIMATION_DELAY_MS);
  }).catch(() => {
    status.textContent = "Could not load settings. Reopen the extension.";
  });

  /** List the user's edits against the baseline, as the background writer's update. */
  function editsFrom(settings) {
    const values = {};
    const whitelists = {};
    for (const key of controlsByKey.keys()) {
      if (sameValue(settings[key], baseline[key])) continue;
      const {kind, fields} = controlsByKey.get(key);
      if (kind !== "whitelist") {
        values[key] = settings[key];
        continue;
      }
      const before = new Set(baseline[key]);
      const after = new Set(settings[key]);
      whitelists[fields.site] = {
        add: settings[key].filter((identifier) => !before.has(identifier)),
        remove: baseline[key].filter((identifier) => !after.has(identifier)),
      };
    }
    return {values, whitelists};
  }

  form.addEventListener("change", updateControlAvailability);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const settings = readForm();
    if (!settings) return;
    const {values, whitelists} = editsFrom(settings);
    if (!Object.keys(values).length && !Object.keys(whitelists).length) {
      status.textContent = "No changes to save.";
      return;
    }
    // Disabled controls cannot gain new edits while the write is in flight.
    controls.disabled = true;
    try {
      const response = await extension.runtime.sendMessage({type: UPDATE_SETTINGS_MESSAGE, values, whitelists});
      if (!response?.ok) throw new Error(response?.error || "failed");
      // Every edit was saved; show the stored result, including entries
      // another tab added meanwhile.
      baseline = normalizeSettings(await storage.get(null));
      showSettings(baseline);
      status.textContent = "Saved. Open feeds update automatically.";
    } catch (error) {
      status.textContent = error.message === "full"
        ? "A whitelist is too long to sync. Remove some entries."
        : "Could not save. Please try again.";
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
