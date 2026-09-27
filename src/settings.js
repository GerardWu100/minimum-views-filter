(function () {
  "use strict";

  const DEFAULTS = Object.freeze({
    xMinimumViews: 1000,
    youtubeMinimumViews: 1000,
    xWhitelist: Object.freeze([]),
    youtubeWhitelist: Object.freeze([]),
    xEnabled: true,
    youtubeEnabled: true,
    hideUnknown: false,
  });
  const MAXIMUM_VIEWS = 1_000_000_000_000;
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

  /** Validate local settings; malformed or missing fields use safe defaults. */
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
    for (const key of ["xEnabled", "youtubeEnabled", "hideUnknown"]) {
      if (typeof value[key] === "boolean") settings[key] = value[key];
    }
    return settings;
  }

  const api = {DEFAULTS, MAXIMUM_VIEWS, normalizeAccountIdentifier, parseWhitelistInput, normalizeSettings};
  globalThis.MinimumViewsSettings = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
