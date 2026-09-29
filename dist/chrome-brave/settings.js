(function () {
  "use strict";

  const DEFAULTS = Object.freeze({
    xMinimumViews: 1000,
    youtubeMinimumViews: 1000,
    xMinimumViewsEnabled: true,
    youtubeMinimumViewsEnabled: true,
    xWhitelist: Object.freeze([]),
    youtubeWhitelist: Object.freeze([]),
    xWhitelistEnabled: true,
    youtubeWhitelistEnabled: true,
    xEnabled: true,
    youtubeEnabled: true,
    hideUnknown: false,
    statisticsEnabled: true,
    xLowLikeRatioEnabled: true,
    xMinimumLikePercent: 0.5,
    xHighLikeRatioEnabled: true,
    xKeepLikePercent: 2,
    xHighBookmarkRatioEnabled: true,
    xKeepBookmarkPercent: 0.5,
    xBookmarkHighlightEnabled: true,
    xHighlightBookmarkPercent: 1,
    xBookmarkHighlightShown: true,
    xHighlightLikeRequired: true,
    xHighlightLikePercent: 2,
  });
  const MAXIMUM_VIEWS = 1_000_000_000_000;
  const X_RATIO_SETTING_KEYS = Object.freeze([
    "xLowLikeRatioEnabled", "xMinimumLikePercent",
    "xHighLikeRatioEnabled", "xKeepLikePercent",
    "xHighBookmarkRatioEnabled", "xKeepBookmarkPercent",
    "xBookmarkHighlightEnabled", "xHighlightBookmarkPercent", "xBookmarkHighlightShown",
    "xHighlightLikeRequired", "xHighlightLikePercent",
  ]);
  const PERCENT_SETTING_KEYS = Object.freeze([
    "xMinimumLikePercent", "xKeepLikePercent", "xKeepBookmarkPercent", "xHighlightBookmarkPercent",
    "xHighlightLikePercent",
  ]);
  const X_RATIO_TOGGLE_KEYS = Object.freeze([
    "xLowLikeRatioEnabled", "xHighLikeRatioEnabled", "xHighBookmarkRatioEnabled", "xBookmarkHighlightEnabled", "xBookmarkHighlightShown",
    "xHighlightLikeRequired",
  ]);
  // Browser-account sync storage: Chrome/Firefox copy it between computers;
  // Brave keeps it on this computer only.
  const STORAGE_AREA = "sync";
  // chrome.storage.sync.QUOTA_BYTES_PER_ITEM (Firefox uses the same limit),
  // measured as UTF-8 bytes of the key plus the JSON-encoded value.
  const SYNC_ITEM_BYTE_LIMIT = 8192;
  // Content-script matches, context-menu pages, and host permissions.
  const SITE_PAGE_PATTERNS = Object.freeze([
    "https://x.com/*", "https://www.x.com/*",
    "https://twitter.com/*", "https://www.twitter.com/*",
    "https://youtube.com/*", "https://www.youtube.com/*",
  ]);
  const WHITELIST_CREATOR_MESSAGE = "minimum-views-filter:whitelist-creator";
  const TRANSFER_FORMAT = "minimum-views-filter-settings";
  const X_RESERVED_PATHS = new Set([
    "home", "explore", "search", "notifications", "messages", "settings",
    "i", "compose", "login", "logout", "signup", "tos", "privacy", "hashtag",
  ]);
  const PROFILE_HOSTS = {
    x: new Set(["x.com", "www.x.com", "mobile.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"]),
    youtube: new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]),
  };

  /**
   * Canonicalize a creator handle or profile URL without contacting the site.
   *
   * Parameters
   * ----------
   * value : string
   *     X handle (optional @), YouTube @handle or channel/ID, or profile URL.
   * site : "x" | "youtube"
   *     Platform whose identity rules and URL hosts must match.
   *
   * Returns
   * -------
   * string | null
   *     Lowercase X handle, NFC/lowercase YouTube @handle, case-preserved
   *     YouTube channel/ID, or null for unsupported or ambiguous input.
   *     Display names and links to posts/videos cannot establish an identity.
   */
  function normalizeAccountIdentifier(value, site) {
    if (typeof value !== "string" || !PROFILE_HOSTS[site]) return null;
    let identifier = value.trim().normalize("NFC");
    if (!identifier) return null;
    const looksLikeUrl = /^(?:https?:\/\/|(?:www\.|mobile\.|m\.)?(?:x\.com|twitter\.com|youtube\.com)\/)/i.test(identifier);
    if (looksLikeUrl) {
      try {
        const url = new URL(/^https?:\/\//i.test(identifier) ? identifier : "https://" + identifier);
        if (!PROFILE_HOSTS[site].has(url.hostname) || url.username || url.password || url.port) return null;
        const pathname = decodeURIComponent(url.pathname).normalize("NFC");
        const match = site === "x"
          ? pathname.match(/^\/([^/]+)\/?$/)
          : pathname.match(/^\/(@[^/]+|channel\/[A-Za-z0-9_-]+)(?:\/(?:featured|videos|shorts|streams|playlists|community|about|podcasts|releases|courses))?\/?$/);
        if (!match) return null;
        identifier = match[1];
      } catch {
        return null;
      }
    }
    if (site === "x") {
      identifier = identifier.replace(/^@/, "").toLowerCase();
      return /^[a-z0-9_]{1,15}$/.test(identifier) && !X_RESERVED_PATHS.has(identifier) ? identifier : null;
    }
    if (/^channel\/[A-Za-z0-9_-]+$/.test(identifier)) return identifier;
    if (/^@[\p{L}\p{M}\p{N}_.·-]+$/u.test(identifier)) return identifier.toLowerCase().normalize("NFC");
    return null;
  }

  /** Parse comma/newline-separated entries; return identities and invalid entries. */
  function parseWhitelistInput(text, site) {
    const entries = text.split(/[\r\n,]+/).map((entry) => entry.trim()).filter(Boolean);
    const identifiers = new Set();
    const invalidEntries = [];
    for (const entry of entries) {
      const identifier = normalizeAccountIdentifier(entry, site);
      if (identifier === null) invalidEntries.push(entry);
      else identifiers.add(identifier);
    }
    return {identifiers: [...identifiers], invalidEntries};
  }

  /** Validate stored settings; malformed or missing fields use safe defaults. */
  function normalizeSettings(value = {}) {
    const settings = {...DEFAULTS};
    for (const site of ["x", "youtube"]) {
      const minimumKey = site + "MinimumViews";
      if (Number.isSafeInteger(value[minimumKey]) && value[minimumKey] >= 0 && value[minimumKey] <= MAXIMUM_VIEWS) {
        settings[minimumKey] = value[minimumKey];
      }
      const whitelistKey = site + "Whitelist";
      settings[whitelistKey] = Array.isArray(value[whitelistKey])
        ? [...new Set(value[whitelistKey].map((entry) => normalizeAccountIdentifier(entry, site)).filter(Boolean))]
        : [];
    }
    for (const key of [
      "xEnabled", "youtubeEnabled", "xMinimumViewsEnabled", "youtubeMinimumViewsEnabled",
      "xWhitelistEnabled", "youtubeWhitelistEnabled", "hideUnknown", "statisticsEnabled",
      ...X_RATIO_TOGGLE_KEYS,
    ]) {
      if (typeof value[key] === "boolean") settings[key] = value[key];
    }
    for (const key of PERCENT_SETTING_KEYS) {
      if (typeof value[key] === "number" && Number.isFinite(value[key]) && value[key] >= 0 && value[key] <= 100) {
        settings[key] = value[key];
      }
    }
    return settings;
  }

  /** Return settings keys whose value would exceed the per-item sync quota. */
  function oversizedSyncKeys(settings) {
    const encoder = new TextEncoder();
    return Object.keys(settings).filter((key) => encoder.encode(key + JSON.stringify(settings[key])).length > SYNC_ITEM_BYTE_LIMIT);
  }

  /** Serialize settings as the text the popup copies between browsers. */
  function formatSettingsTransfer(settings) {
    return JSON.stringify({format: TRANSFER_FORMAT, ...normalizeSettings(settings)}, null, 2);
  }

  /**
   * Parse pasted transfer text without silently dropping invalid values.
   *
   * Parameters
   * ----------
   * text : string
   *     JSON produced by formatSettingsTransfer, possibly from another browser:
   *     A JSON object containing the format marker, site minimums and toggles,
   *     whitelists, unknown-count policy, and X ratio/highlight settings.
   *     Text from an earlier release may lack settings added since then.
   *
   * Returns
   * -------
   * object | null
   *     Normalized settings, or null when the format marker or every setting
   *     is missing, or any included setting is invalid. Absent settings take their defaults.
   *     Whitelist entries may use any accepted spelling.
   */
  function parseSettingsTransfer(text) {
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      return null;
    }
    if (!value || typeof value !== "object" || Array.isArray(value) || value.format !== TRANSFER_FORMAT) return null;
    // A marker without any setting is not a settings export from any release.
    if (!Object.keys(DEFAULTS).some((key) => Object.hasOwn(value, key))) return null;
    const settings = normalizeSettings(value);
    for (const key of Object.keys(DEFAULTS)) {
      // Another browser may run an earlier release that lacks newer settings.
      if (!Object.hasOwn(value, key)) continue;
      const raw = value[key];
      const valid = Array.isArray(settings[key])
        ? Array.isArray(raw) && raw.every((entry) => normalizeAccountIdentifier(entry, key.replace("Whitelist", "")) !== null)
        : raw === settings[key];
      if (!valid) return null;
    }
    return settings;
  }

  const api = {
    DEFAULTS, MAXIMUM_VIEWS, X_RATIO_SETTING_KEYS, PERCENT_SETTING_KEYS,
    STORAGE_AREA, SITE_PAGE_PATTERNS, WHITELIST_CREATOR_MESSAGE,
    normalizeAccountIdentifier, parseWhitelistInput, normalizeSettings,
    oversizedSyncKeys, formatSettingsTransfer, parseSettingsTransfer,
  };
  globalThis.MinimumViewsSettings = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
