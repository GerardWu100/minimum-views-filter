(function () {
  "use strict";

  // Short display label for each hide reason in MinimumViewsHistory.REASONS.
  const REASON_LABELS = {
    "low-views": "Low views",
    "low-like-ratio": "Low likes/views",
    "unknown-views": "Unknown views",
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

  /**
   * Build a stacked bar and labeled count list for one site's hide reasons.
   *
   * Parameters
   * ----------
   * site : "x" | "youtube"
   *     Selects which reasons are always listed.
   * reasonCounts : object
   *     Maps reason -> non-negative integer hide events, as in history.counts[site].
   *
   * Returns
   * -------
   * HTMLElement
   *     A detached <div class="reason-breakdown"> built only through textContent.
   *     Segment widths are shares of the site total; every segment has a visible
   *     label and count in the list, so identity never depends on color alone.
   */
  function buildReasonBreakdown(site, reasonCounts) {
    const {REASONS, siteTotal} = globalThis.MinimumViewsHistory;
    const total = siteTotal(reasonCounts);
    const reasons = REASONS.filter((reason) => SITE_REASONS[site].includes(reason) || reasonCounts[reason] > 0);
    const wrapper = document.createElement("div");
    wrapper.className = "reason-breakdown";

    const bar = document.createElement("div");
    bar.className = "stack-bar";
    bar.setAttribute("role", "img");
    bar.setAttribute("aria-label", total
      ? SITE_NAMES[site] + " hide reasons: " + reasons.map((reason) => REASON_LABELS[reason] + " " + reasonCounts[reason].toLocaleString()).join(", ")
      : "No " + SITE_NAMES[site] + " hide events");
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
      const name = document.createElement("span");
      name.className = "reason-name";
      name.textContent = REASON_LABELS[reason];
      const count = document.createElement("span");
      count.className = "reason-count";
      count.textContent = reasonCounts[reason].toLocaleString();
      const share = document.createElement("span");
      share.className = "reason-share";
      share.textContent = formatShare(reasonCounts[reason], total);
      row.append(swatch, name, count, share);
      list.append(row);
    }
    wrapper.append(bar, list);
    return wrapper;
  }

  globalThis.MinimumViewsReasonBreakdown = {REASON_LABELS, SITE_NAMES, buildReasonBreakdown};
})();
