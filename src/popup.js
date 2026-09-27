(function () {
  "use strict";

  const extension = globalThis.browser || globalThis.chrome;
  const {normalizeSettings, parseWhitelistInput, MAXIMUM_VIEWS} = globalThis.MinimumViewsSettings;
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
  const status = document.getElementById("status");

  extension.storage.local.get(null).then((stored) => {
    const settings = normalizeSettings(stored);
    for (const {site, minimum, whitelist, enabled} of siteFields) {
      minimum.value = settings[site + "MinimumViews"];
      whitelist.value = settings[site + "Whitelist"].map((identifier) => site === "x" ? "@" + identifier : identifier).join("\n");
      enabled.checked = settings[site + "Enabled"];
    }
    hideUnknown.checked = settings.hideUnknown;
    controls.disabled = false;
  }).catch(() => {
    status.textContent = "Could not load settings. Reopen the extension.";
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const settings = {hideUnknown: hideUnknown.checked};
    for (const {site, name, minimum, whitelist, enabled} of siteFields) {
      const value = Number(minimum.value);
      if (minimum.value.trim() === "" || !Number.isSafeInteger(value) || value < 0 || value > MAXIMUM_VIEWS) {
        status.textContent = name + ": enter a whole number from 0 to 1,000,000,000,000.";
        minimum.focus();
        return;
      }
      const parsed = parseWhitelistInput(whitelist.value, site);
      if (parsed.invalidEntries.length) {
        status.textContent = name + ": use " + (site === "x" ? "@handles or X profile URLs" : "@handles or YouTube channel URLs") + ", one per line or separated by commas.";
        whitelist.closest("details").open = true;
        whitelist.focus();
        return;
      }
      settings[site + "MinimumViews"] = value;
      settings[site + "Whitelist"] = parsed.identifiers;
      settings[site + "Enabled"] = enabled.checked;
    }
    controls.disabled = true;
    try {
      await extension.storage.local.set(settings);
      status.textContent = "Saved. Open feeds update automatically.";
    } catch {
      status.textContent = "Could not save. Please try again.";
    } finally {
      controls.disabled = false;
    }
  });
})();
