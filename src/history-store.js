(function () {
  "use strict";

  const STORAGE_KEY = "filterHistory";
  const MAX_ENTRIES = 500;
  const MAX_BATCH_ITEMS = 100;
  const MAX_TITLE_LENGTH = 240;
  const MAX_COUNT = 1_000_000_000_000;
  const MAX_TOTAL = Number.MAX_SAFE_INTEGER;
  // Every hide reason from MinimumViewsCore.getFilterReason, in display order.
  const REASONS = Object.freeze(["low-views", "low-like-ratio", "unknown-views"]);
  const YOUTUBE_REASONS = Object.freeze(["low-views", "unknown-views"]);
  const REASON_SET = new Set(REASONS);
  // X high-engagement exceptions that can keep a card, and the hide reasons they override.
  const KEPT_REASONS = Object.freeze(["high-like-and-bookmark-ratio", "high-like-ratio", "high-bookmark-ratio"]);
  const KEPT_REASON_SET = new Set(KEPT_REASONS);
  const HIGHLIGHT_REASON = "high-bookmark-ratio";
  const BYPASSED_REASON_SET = new Set(["low-views", "low-like-ratio"]);
  const X_HOSTS = new Set(["x.com", "www.x.com", "twitter.com", "www.twitter.com"]);
  const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com"]);
  // The final assertion requires the actual end, including after line breaks.
  const CANONICAL_X_URL = /^https:\/\/x\.com\/[a-z0-9_]{1,15}\/status\/[0-9]{1,30}(?![\s\S])/;
  const CANONICAL_YOUTUBE_URL = /^https:\/\/www\.youtube\.com\/(?:watch\?v=|shorts\/)[A-Za-z0-9_-]{1,64}(?![\s\S])/;

  /** Return {reason: 0} for every listed reason. */
  function emptyReasonCounts(reasons = REASONS) {
    return Object.fromEntries(reasons.map((reason) => [reason, 0]));
  }

  /**
   * Return a fresh, JSON-safe history object.
   *
   * counts maps site -> hide reason -> hide events since the last reset, e.g.
   * {x: {"low-views": 3, "low-like-ratio": 1, "unknown-views": 0}, youtube: {...}}.
   * xKeptCounts maps an X high-engagement exception -> events where it kept a
   * card that would otherwise be hidden, e.g. {"high-like-ratio": 2, ...}.
   * entries (hidden), keptEntries (kept), and highlightedEntries are separate
   * lists, most recent first. xHighlightedCount is an independent event total.
   */
  function emptyHistory() {
    return {
      version: 4,
      counts: {x: emptyReasonCounts(), youtube: emptyReasonCounts()},
      xKeptCounts: emptyReasonCounts(KEPT_REASONS),
      xHighlightedCount: 0,
      entries: [],
      keptEntries: [],
      highlightedEntries: [],
    };
  }

  /** Sum reason counts, e.g. one site's hide total or the X kept total. */
  function siteTotal(reasonCounts) {
    return Object.values(reasonCounts).reduce((total, count) => total + count, 0);
  }

  /** Canonicalize an X post or YouTube video URL without fetching it. */
  function canonicalItemUrl(value, site) {
    if (typeof value !== "string" || value.length > 2048) return null;
    // Persisted entries already use these exact forms. Avoid rebuilding up to
    // 1,000 URL objects whenever a new batch validates the bounded history.
    if ((site === "x" && CANONICAL_X_URL.test(value)) || (site === "youtube" && CANONICAL_YOUTUBE_URL.test(value))) return value;
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

  /**
   * Validate one event or stored entry; null means reject it.
   *
   * outcome is "hidden" (hide reason), "kept" (X exception plus bypassedReason),
   * or "highlighted" (visible X post with high bookmarks/views).
   * Messages carry the same outcome field; stored entries omit it because
   * their list identifies it. The returned object never contains outcome.
   */
  function normalizeEvent(value, site, outcome) {
    if (!value || typeof value !== "object" || Array.isArray(value) || value.site !== site) return null;
    if (Object.prototype.hasOwnProperty.call(value, "outcome") && value.outcome !== outcome) return null;
    if (outcome === "hidden" && (!REASON_SET.has(value.reason) || (site === "youtube" && value.reason === "low-like-ratio"))) return null;
    if (outcome === "kept" && (site !== "x" || !KEPT_REASON_SET.has(value.reason) || !BYPASSED_REASON_SET.has(value.bypassedReason))) return null;
    if (outcome === "highlighted" && (site !== "x" || value.reason !== HIGHLIGHT_REASON)) return null;
    if (outcome !== "hidden" && outcome !== "kept" && outcome !== "highlighted") return null;
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
    // Ratios need known positive views and the numerator that established the
    // decision. Thresholds are deliberately not rechecked against later settings.
    if (outcome === "hidden") {
      if (value.reason === "unknown-views" ? views !== null : views === null) return null;
      if (value.reason === "low-like-ratio" && (views === 0 || likes === null)) return null;
    } else if (outcome === "kept") {
      if (views === null || views === 0) return null;
      const needsLikes = value.reason === "high-like-ratio" || value.reason === "high-like-and-bookmark-ratio";
      const needsBookmarks = value.reason === "high-bookmark-ratio" || value.reason === "high-like-and-bookmark-ratio";
      if ((needsLikes && likes === null) || (needsBookmarks && bookmarks === null)) return null;
      if (value.bypassedReason === "low-like-ratio" && likes === null) return null;
    } else if (views === null || views === 0 || bookmarks === null) {
      return null;
    }
    const event = {site, url, title, reason: value.reason, views, likes, bookmarks};
    return outcome === "kept" ? {...event, bypassedReason: value.bypassedReason} : event;
  }

  /** Validate one stored entry list, deduplicated by URL and bounded to MAX_ENTRIES. */
  function normalizeEntries(value, outcome) {
    const entries = [];
    if (!Array.isArray(value)) return entries;
    const seen = new Set();
    for (const entry of value.slice(0, MAX_ENTRIES)) {
      if (entry?.site !== "x" && entry?.site !== "youtube") continue;
      const normalized = normalizeEvent(entry, entry.site, outcome);
      if (!normalized?.url || seen.has(normalized.url)) continue;
      seen.add(normalized.url);
      entries.push({
        ...normalized,
        lastFilteredAt: Number.isSafeInteger(entry.lastFilteredAt) && entry.lastFilteredAt >= 0 ? entry.lastFilteredAt : 0,
        events: Number.isSafeInteger(entry.events) && entry.events > 0 ? entry.events : 1,
      });
    }
    return entries;
  }

  /** Copy valid bounded counts for the listed reasons into target. */
  function copyCounts(target, source, reasons) {
    for (const reason of reasons) {
      const count = source?.[reason];
      if (Number.isSafeInteger(count) && count >= 0 && count <= MAX_TOTAL) target[reason] = count;
    }
  }

  /** Discard corrupt stored fields and bound retained entries before updating. */
  function normalizeHistory(value) {
    const history = emptyHistory();
    if (!value || typeof value !== "object" || Array.isArray(value)) return history;
    copyCounts(history.counts.x, value.counts?.x, REASONS);
    copyCounts(history.counts.youtube, value.counts?.youtube, YOUTUBE_REASONS);
    copyCounts(history.xKeptCounts, value.xKeptCounts, KEPT_REASONS);
    if (Number.isSafeInteger(value.xHighlightedCount) && value.xHighlightedCount >= 0 && value.xHighlightedCount <= MAX_TOTAL) {
      history.xHighlightedCount = value.xHighlightedCount;
    }
    history.entries = normalizeEntries(value.entries, "hidden");
    history.keptEntries = normalizeEntries(value.keptEntries, "kept");
    history.highlightedEntries = normalizeEntries(value.highlightedEntries, "highlighted");
    return history;
  }

  /**
   * Add validated hidden, kept, and highlighted transitions to history.
   *
   * Parameters
   * ----------
   * stored : object
   *     Previous history in extension local storage (see emptyHistory), with
   *     at most 500 recent URL entries per outcome (most recent first).
   * items : object[]
   *     Up to 100 content-script events from one verified site. Each event has
   *     site, outcome ("hidden", "kept", or "highlighted"), URL or null, bounded
   *     title, reason, bypassedReason for kept events, and optional numeric
   *     views/likes/bookmarks. Null URLs count without an entry. A
   *     linked event with enrich: true identifies an earlier linkless event;
   *     it adds an entry occurrence without incrementing any reason count.
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
      const event = normalizeEvent(item, site, item?.outcome);
      if (!event) continue;
      const kept = item.outcome === "kept";
      const highlighted = item.outcome === "highlighted";
      if (item.enrich !== true) {
        if (highlighted) history.xHighlightedCount = Math.min(MAX_TOTAL, history.xHighlightedCount + 1);
        else {
          const counts = kept ? history.xKeptCounts : history.counts[site];
          counts[event.reason] = Math.min(MAX_TOTAL, counts[event.reason] + 1);
        }
      }
      recorded++;
      if (!event.url) continue;
      const list = highlighted ? history.highlightedEntries : kept ? history.keptEntries : history.entries;
      const previousIndex = list.findIndex((entry) => entry.url === event.url);
      const previous = previousIndex < 0 ? null : list.splice(previousIndex, 1)[0];
      list.unshift({
        ...event,
        lastFilteredAt: now,
        events: Math.min(MAX_TOTAL, (previous?.events || 0) + 1),
      });
      if (list.length > MAX_ENTRIES) list.length = MAX_ENTRIES;
    }
    return {history, recorded};
  }

  const api = {STORAGE_KEY, MAX_ENTRIES, MAX_BATCH_ITEMS, REASONS, KEPT_REASONS, emptyHistory, siteTotal, canonicalItemUrl, normalizeEvent, normalizeHistory, addEvents};
  globalThis.MinimumViewsHistory = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
