(function () {
  "use strict";

  const extension = globalThis.browser || globalThis.chrome;
  const {siteTotal} = globalThis.MinimumViewsHistory;
  const {REASON_LABELS, SITE_NAMES, buildReasonBreakdown, buildKeptBreakdown} = globalThis.MinimumViewsReasonBreakdown;
  const STORAGE_KEY = "filterHistory";
  const GET_MESSAGE = "minimum-views-filter:get-history";
  const CLEAR_MESSAGE = "minimum-views-filter:clear-history";
  const entries = document.getElementById("entries");
  const status = document.getElementById("status");
  const recentShown = document.getElementById("recent-shown");
  const clearButton = document.getElementById("clear-history");
  const siteCounts = {x: document.getElementById("x-count"), youtube: document.getElementById("youtube-count")};
  const siteReasons = {x: document.getElementById("x-reasons"), youtube: document.getElementById("youtube-reasons")};
  const keptCount = document.getElementById("x-kept-count");
  const keptReasons = document.getElementById("x-kept-reasons");
  const outcomeFilter = document.getElementById("outcome-filter");
  const siteFilter = document.getElementById("site-filter");
  const reasonFilter = document.getElementById("reason-filter");
  const entryCounts = {hidden: document.getElementById("hidden-entry-count"), kept: document.getElementById("kept-entry-count")};
  // Current chip selections. outcome picks the hidden or kept list; "all"
  // disables the site or reason filter.
  const activeFilters = {outcome: "hidden", site: "all", reason: "all"};
  let latestHistory = null;

  function formatCount(value) {
    return value === null ? "unknown" : Number(value).toLocaleString();
  }

  function ratioPercent(numerator, views) {
    // Percent = 100 * engagement count / view count, using the stored snapshot.
    const percentage = 100 * numerator / views;
    return percentage > 0 && percentage < 0.0001 ? "<0.0001%" :
      percentage.toLocaleString(undefined, {maximumFractionDigits: 4}) + "%";
  }

  /** Return a <span class="metric"> reading "label value" with the value in bold. */
  function metric(label, value) {
    const chip = document.createElement("span");
    chip.className = "metric";
    const strong = document.createElement("b");
    strong.textContent = value;
    chip.append(label + " ", strong);
    return chip;
  }

  function buildEntry(item) {
    const row = document.createElement("li");
    row.dataset.reason = item.reason;
    row.dataset.site = item.site;
    const link = document.createElement("a");
    link.className = "entry-title";
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = item.title || (item.site === "x" ? "X post" : "YouTube video");

    const meta = document.createElement("p");
    meta.className = "entry-meta";
    const reason = document.createElement("span");
    reason.className = "entry-reason";
    reason.textContent = REASON_LABELS[item.reason];
    const date = new Date(item.lastFilteredAt);
    const metaParts = [SITE_NAMES[item.site]];
    // Kept entries name the hide reason their high engagement overrode.
    if (item.bypassedReason) metaParts.push("kept despite " + REASON_LABELS[item.bypassedReason].toLowerCase());
    if (item.events > 1) metaParts.push((item.bypassedReason ? "kept " : "hidden ") + item.events.toLocaleString() + " times");
    if (item.lastFilteredAt > 0 && !Number.isNaN(date.getTime())) metaParts.push(date.toLocaleString());
    meta.append(reason, " · " + metaParts.join(" · "));

    const metrics = document.createElement("p");
    metrics.className = "entry-metrics";
    metrics.append(metric("Views", formatCount(item.views)));
    if (item.site === "x") {
      metrics.append(metric("Likes", formatCount(item.likes)), metric("Bookmarks", formatCount(item.bookmarks)));
      if (item.views > 0 && item.likes !== null) metrics.append(metric("Likes/views", ratioPercent(item.likes, item.views)));
      if (item.views > 0 && item.bookmarks !== null) metrics.append(metric("Bookmarks/views", ratioPercent(item.bookmarks, item.views)));
    }
    row.append(link, meta, metrics);
    return row;
  }

  /** Show the site and reason chips that apply to the selected outcome. */
  function showOutcomeChips() {
    const kept = activeFilters.outcome === "kept";
    // Only X has high-engagement exceptions, so kept items need no site filter.
    siteFilter.hidden = kept;
    for (const chip of reasonFilter.querySelectorAll("button.chip[data-outcome]")) chip.hidden = chip.dataset.outcome !== activeFilters.outcome;
    for (const chip of outcomeFilter.querySelectorAll("button.chip")) chip.setAttribute("aria-pressed", String(chip.dataset.value === activeFilters.outcome));
  }

  /** Rebuild the list from the latest history using the active chip filters. */
  function renderEntries() {
    const kept = activeFilters.outcome === "kept";
    const all = kept ? latestHistory.keptEntries : latestHistory.entries;
    const visible = all.filter((item) =>
      (kept || activeFilters.site === "all" || item.site === activeFilters.site)
      && (activeFilters.reason === "all" || item.reason === activeFilters.reason));
    entries.replaceChildren(...visible.map(buildEntry));
    recentShown.textContent = all.length ? (visible.length === all.length
      ? all.length.toLocaleString() + " items"
      : visible.length.toLocaleString() + " of " + all.length.toLocaleString() + " items") : "";
    const anyEvents = kept ? siteTotal(latestHistory.xKeptCounts) > 0
      : siteTotal(latestHistory.counts.x) + siteTotal(latestHistory.counts.youtube) > 0;
    status.textContent = visible.length ? "" :
      all.length ? "No recent items match these filters." :
      anyEvents ? (kept ? "Kept posts were recorded, but no item links were available." : "Hide events were recorded, but no item links were available.")
      : (kept ? "No X posts kept by high engagement yet." : "No hide events recorded yet.");
  }

  /** Build the page from validated background data without interpreting HTML. */
  function render(history) {
    latestHistory = history;
    for (const site of ["x", "youtube"]) {
      siteCounts[site].textContent = siteTotal(history.counts[site]).toLocaleString();
      siteReasons[site].replaceChildren(buildReasonBreakdown(site, history.counts[site]));
    }
    keptCount.textContent = siteTotal(history.xKeptCounts).toLocaleString();
    keptReasons.replaceChildren(buildKeptBreakdown(history.xKeptCounts));
    entryCounts.hidden.textContent = history.entries.length.toLocaleString();
    entryCounts.kept.textContent = history.keptEntries.length.toLocaleString();
    clearButton.disabled = siteTotal(history.counts.x) === 0 && siteTotal(history.counts.youtube) === 0 && siteTotal(history.xKeptCounts) === 0
      && history.entries.length === 0 && history.keptEntries.length === 0;
    renderEntries();
  }

  /** Make one chip group behave as a single-choice filter. */
  function bindChipGroup(group, key) {
    group.addEventListener("click", (event) => {
      const chip = event.target.closest("button.chip");
      if (!chip) return;
      activeFilters[key] = chip.dataset.value;
      for (const other of group.querySelectorAll("button.chip")) other.setAttribute("aria-pressed", String(other === chip));
      if (latestHistory) renderEntries();
    });
  }

  async function loadHistory() {
    try {
      const response = await extension.runtime.sendMessage({type: GET_MESSAGE});
      if (!response?.ok) throw new Error("history unavailable");
      render(response.history);
    } catch {
      status.textContent = "Could not load history. Try reopening this page.";
      clearButton.disabled = true;
    }
  }

  clearButton.addEventListener("click", async () => {
    clearButton.disabled = true;
    try {
      const response = await extension.runtime.sendMessage({type: CLEAR_MESSAGE});
      if (!response?.ok) throw new Error("reset failed");
      render(response.history);
      status.textContent = "History reset.";
    } catch {
      status.textContent = "Could not reset history. Please try again.";
      clearButton.disabled = false;
    }
  });

  outcomeFilter.addEventListener("click", (event) => {
    const chip = event.target.closest("button.chip");
    if (!chip || chip.dataset.value === activeFilters.outcome) return;
    // Reasons differ between outcomes, so switching lists clears the reason filter.
    activeFilters.outcome = chip.dataset.value;
    activeFilters.reason = "all";
    for (const other of reasonFilter.querySelectorAll("button.chip")) other.setAttribute("aria-pressed", String(other.dataset.value === "all"));
    showOutcomeChips();
    if (latestHistory) renderEntries();
  });
  bindChipGroup(siteFilter, "site");
  bindChipGroup(reasonFilter, "reason");
  extension.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && Object.hasOwn(changes, STORAGE_KEY)) void loadHistory();
  });
  void loadHistory();
})();
