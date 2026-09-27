(function () {
  "use strict";

  const DEFAULTS = Object.freeze({
    minimumViews: 1000,
    xEnabled: true,
    youtubeEnabled: true,
    hideUnknown: false,
  });
  const MAXIMUM_VIEWS = 1_000_000_000_000;

  /** Validate local settings; malformed or missing fields use safe defaults. */
  function normalizeSettings(value = {}) {
    const settings = {...DEFAULTS};
    if (Number.isSafeInteger(value.minimumViews) && value.minimumViews >= 0 && value.minimumViews <= MAXIMUM_VIEWS) {
      settings.minimumViews = value.minimumViews;
    }
    for (const key of ["xEnabled", "youtubeEnabled", "hideUnknown"]) {
      if (typeof value[key] === "boolean") settings[key] = value[key];
    }
    return settings;
  }

  const api = {DEFAULTS, MAXIMUM_VIEWS, normalizeSettings};
  globalThis.MinimumViewsSettings = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
