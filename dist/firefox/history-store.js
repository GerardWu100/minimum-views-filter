(function () {
  "use strict";

  const STORAGE_KEY = "filterHistory";
  const MAX_ENTRIES = 500;
  const MAX_BATCH_ITEMS = 100;
  const MAX_TITLE_LENGTH = 240;
  const MAX_COUNT = 1_000_000_000_000;
  const MAX_TOTAL = Number.MAX_SAFE_INTEGER;
  const REASONS = new Set(["low-views", "low-like-ratio", "unknown-views"]);
  const X_HOSTS = new Set(["x.com", "www.x.com", "twitter.com", "www.twitter.com"]);
  const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com"]);

  /** Return a fresh, JSON-safe history object; entries are most recent first. */
  function emptyHistory() {
    return {version: 1, counts: {x: 0, youtube: 0}, entries: []};
  }

  /** Canonicalize an X post or YouTube video URL without fetching it. */
  function canonicalItemUrl(value, site) {
    if (typeof value !== "string" || value.length > 2048) return null;
    let url;
    try { url = new URL(value); } catch { return null; }
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    if (site === "x" && X_HOSTS.has(url.hostname)) {
      const match = url.pathname.match(/^\/(?:([A-Za-z0-9_]{1,15})|i)\/status\/([0-9]{1,30})\/?$/);
      if (!match) return null;
      return `https://x.com/${match[1] ? match[1].toLowerCase() : "i"}/status/${match[2]}`;
    }
    if (site === "youtube" && YOUTUBE_HOSTS.has(url.hostname)) {
      const video = url.pathname.match(/^\/shorts\/([A-Za-z0-9_-]{1,64})\/?$/);
      if (video) return `https://www.youtube.com/shorts/${video[1]}`;
      if (url.pathname !== "/watch") return null;
      const ids = url.searchParams.getAll("v");
      if (ids.length !== 1 || !/^[A-Za-z0-9_-]{1,64}$/.test(ids[0])) return null;
      return `https://www.youtube.com/watch?v=${ids[0]}`;
    }
    return null;
  }

  function countOrNull(value) {
    return value === null || value === undefined ? null
      : Number.isSafeInteger(value) && value >= 0 && value <= MAX_COUNT ? value : undefined;
  }

  /** Validate one content-script event; null means reject it. */
  function normalizeEvent(value, site) {
    if (!value || typeof value !== "object" || Array.isArray(value) || value.site !== site || !REASONS.has(value.reason)) return null;
    if (Object.prototype.hasOwnProperty.call(value, "enrich") && typeof value.enrich !== "boolean") return null;
    if (value.url !== null && typeof value.url !== "string") return null;
    const url = value.url === null ? null : canonicalItemUrl(value.url, site);
    if (value.url !== null && !url) return null;
    if (value.enrich === true && !url) return null;
    if (typeof value.title !== "string" || value.title.length > MAX_TITLE_LENGTH) return null;
    const title = value.title.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
    const views = countOrNull(value.views);
    const likes = countOrNull(value.likes);
    const bookmarks = countOrNull(value.bookmarks);
    if ([views, likes, bookmarks].includes(undefined)) return null;
    return {site, url, title, reason: value.reason, views, likes, bookmarks};
  }

  /** Discard corrupt stored fields and bound retained entries before updating. */
  function normalizeHistory(value) {
    const history = emptyHistory();
    if (!value || typeof value !== "object" || Array.isArray(value)) return history;
    for (const site of ["x", "youtube"]) {
      const count = value.counts?.[site];
      if (Number.isSafeInteger(count) && count >= 0 && count <= MAX_TOTAL) history.counts[site] = count;
    }
    if (!Array.isArray(value.entries)) return history;
    const seen = new Set();
    for (const entry of value.entries.slice(0, MAX_ENTRIES)) {
      if (entry?.site !== "x" && entry?.site !== "youtube") continue;
      const normalized = normalizeEvent(entry, entry.site);
      if (!normalized?.url || seen.has(normalized.url)) continue;
      seen.add(normalized.url);
      history.entries.push({
        ...normalized,
        lastFilteredAt: Number.isSafeInteger(entry.lastFilteredAt) && entry.lastFilteredAt >= 0 ? entry.lastFilteredAt : 0,
        events: Number.isSafeInteger(entry.events) && entry.events > 0 ? entry.events : 1,
      });
    }
    return history;
  }

  /**
   * Add validated hide transitions to history.
   *
   * Parameters
   * ----------
   * stored : object
   *     Previous history in extension local storage, with counts by site and
   *     at most 500 recent URL entries (most recent first).
   * items : object[]
   *     Up to 100 content-script events from one verified site. Each event has
   *     site, canonical item URL or null, bounded title, reason, and optional
   *     numeric views/likes/bookmarks. Null URLs count without an entry. A
   *     linked event with enrich: true identifies an earlier linkless event;
   *     it adds an entry occurrence without incrementing the site total.
   * site : "x" | "youtube"
   *     Site established from the trusted message sender URL.
   * now : number
   *     Milliseconds since the Unix epoch, provided by the caller.
   *
   * Returns
   * -------
   * object | null
   *     {history, recorded}, or null for an invalid batch. "recorded" counts
   *     accepted items, including enrichments. Invalid items are skipped.
   */
  function addEvents(stored, items, site, now) {
    if (!Array.isArray(items) || items.length < 1 || items.length > MAX_BATCH_ITEMS || (site !== "x" && site !== "youtube")) return null;
    const history = normalizeHistory(stored);
    let recorded = 0;
    for (const item of items) {
      const event = normalizeEvent(item, site);
      if (!event) continue;
      if (item.enrich !== true) history.counts[site] = Math.min(MAX_TOTAL, history.counts[site] + 1);
      recorded++;
      if (!event.url) continue;
      const previousIndex = history.entries.findIndex((entry) => entry.url === event.url);
      const previous = previousIndex < 0 ? null : history.entries.splice(previousIndex, 1)[0];
      history.entries.unshift({
        ...event,
        lastFilteredAt: now,
        events: Math.min(MAX_TOTAL, (previous?.events || 0) + 1),
      });
      if (history.entries.length > MAX_ENTRIES) history.entries.length = MAX_ENTRIES;
    }
    return {history, recorded};
  }

  const api = {STORAGE_KEY, MAX_ENTRIES, MAX_BATCH_ITEMS, emptyHistory, canonicalItemUrl, normalizeEvent, normalizeHistory, addEvents};
  globalThis.MinimumViewsHistory = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
