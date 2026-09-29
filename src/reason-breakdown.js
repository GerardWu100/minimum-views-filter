(function () {
  "use strict";

  // Short display label for each hide reason (MinimumViewsHistory.REASONS) and
  // each X high-engagement exception (MinimumViewsHistory.KEPT_REASONS).
  const REASON_LABELS = {
    "low-views": "Low views",
    "low-like-ratio": "Low likes/views",
    "unknown-views": "Unknown views",
    "high-like-and-bookmark-ratio": "High likes & bookmarks/views",
    "high-like-ratio": "High likes/views",
    "high-bookmark-ratio": "High bookmarks/views",
  };
  // Reasons each site can produce. Another reason appears only if it has a count.
  const SITE_REASONS = {
    x: ["low-views", "low-like-ratio", "unknown-views"],
    youtube: ["low-views", "unknown-views"],
  };
  const SITE_NAMES = {x: "X", youtube: "YouTube"};
  // Shares below this percentage show as "<1%" so a nonzero reason never reads 0%.
  const MINIMUM_ROUNDED_PERCENT = 1;

  /** Format count/total as a whole percentage; empty totals give an empty string. */
  function formatShare(count, total) {
    if (!total) return "";
    // Share percent = 100 * reason count / site total.
    const percent = 100 * count / total;
    if (count > 0 && percent < MINIMUM_ROUNDED_PERCENT) return "<1%";
    return Math.round(percent) + "%";
  }

  /** Build one site's hide-reason breakdown; see buildBreakdown. */
  function buildReasonBreakdown(site, reasonCounts) {
    const reasons = globalThis.MinimumViewsHistory.REASONS
      .filter((reason) => SITE_REASONS[site].includes(reason) || reasonCounts[reason] > 0);
    return buildBreakdown(reasons, reasonCounts, SITE_NAMES[site] + " hide reasons", "No " + SITE_NAMES[site] + " hide events");
  }

  /** Build the X kept-by-engagement breakdown from history.xKeptCounts. */
  function buildKeptBreakdown(keptCounts) {
    return buildBreakdown(globalThis.MinimumViewsHistory.KEPT_REASONS, keptCounts,
      "X posts kept by high engagement", "No X posts kept by high engagement");
  }

  /**
   * Build a stacked bar and labeled count list.
   *
   * Parameters
   * ----------
   * reasons : string[]
   *     Reasons to list, in display order; each has a REASON_LABELS entry.
   * reasonCounts : object
   *     Maps reason -> non-negative integer events.
   * name, emptyName : string
   *     Accessible bar name with and without events.
   *
   * Returns
   * -------
   * HTMLElement
   *     A detached <div class="reason-breakdown"> built only through textContent.
   *     Segment widths are shares of the total; every segment has a visible
   *     label and count in the list, so identity never depends on color alone.
   */
  function buildBreakdown(reasons, reasonCounts, name, emptyName) {
    const total = globalThis.MinimumViewsHistory.siteTotal(reasonCounts);
    const wrapper = document.createElement("div");
    wrapper.className = "reason-breakdown";

    const bar = document.createElement("div");
    bar.className = "stack-bar";
    bar.setAttribute("role", "img");
    bar.setAttribute("aria-label", total
      ? name + ": " + reasons.map((reason) => REASON_LABELS[reason] + " " + reasonCounts[reason].toLocaleString()).join(", ")
      : emptyName);
    if (!total) bar.toggleAttribute("data-empty", true);
    for (const reason of reasons) {
      if (!reasonCounts[reason]) continue;
      const segment = document.createElement("span");
      segment.className = "stack-segment";
      segment.dataset.reason = reason;
      segment.style.flexGrow = String(reasonCounts[reason]);
      segment.title = REASON_LABELS[reason] + ": " + reasonCounts[reason].toLocaleString() + " (" + formatShare(reasonCounts[reason], total) + ")";
      bar.append(segment);
    }

    const list = document.createElement("ul");
    list.className = "reason-list";
    for (const reason of reasons) {
      const row = document.createElement("li");
      row.dataset.reason = reason;
      if (!reasonCounts[reason]) row.toggleAttribute("data-zero", true);
      const swatch = document.createElement("span");
      swatch.className = "reason-swatch";
      swatch.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.className = "reason-name";
      label.textContent = REASON_LABELS[reason];
      const count = document.createElement("span");
      count.className = "reason-count";
      count.textContent = reasonCounts[reason].toLocaleString();
      const share = document.createElement("span");
      share.className = "reason-share";
      share.textContent = formatShare(reasonCounts[reason], total);
      row.append(swatch, label, count, share);
      list.append(row);
    }
    wrapper.append(bar, list);
    return wrapper;
  }

  globalThis.MinimumViewsReasonBreakdown = {REASON_LABELS, SITE_NAMES, buildReasonBreakdown, buildKeptBreakdown};
})();
