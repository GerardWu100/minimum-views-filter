(function () {
  "use strict";

  const extension = globalThis.browser || globalThis.chrome;
  const STORAGE_KEY = "filterHistory";
  const GET_MESSAGE = "minimum-views-filter:get-history";
  const CLEAR_MESSAGE = "minimum-views-filter:clear-history";
  const reasonLabels = {
    "low-views": "Below view minimum",
    "low-like-ratio": "Below likes-to-views ratio",
    "unknown-views": "View count unknown",
  };
  const entries = document.getElementById("entries");
  const status = document.getElementById("status");
  const clearButton = document.getElementById("clear-history");
  const xCount = document.getElementById("x-count");
  const youtubeCount = document.getElementById("youtube-count");

  function metric(value, label) {
    return label + ": " + (value === null ? "unknown" : Number(value).toLocaleString());
  }

  function ratioPercent(numerator, views, label) {
    // Percent = 100 * engagement count / view count, using the stored snapshot.
    const percentage = 100 * numerator / views;
    const formatted = percentage > 0 && percentage < 0.0001 ? "<0.0001" :
      percentage.toLocaleString(undefined, {maximumFractionDigits: 4});
    return label + ": " + formatted + "%";
  }

  /** Build the page from validated background data without interpreting HTML. */
  function render(history) {
    xCount.textContent = history.counts.x.toLocaleString();
    youtubeCount.textContent = history.counts.youtube.toLocaleString();
    entries.replaceChildren();
    for (const item of history.entries) {
      const row = document.createElement("li");
      const link = document.createElement("a");
      link.href = item.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = item.title || (item.site === "x" ? "X post" : "YouTube video");
      const details = document.createElement("p");
      const date = new Date(item.lastFilteredAt);
      const parts = [item.site === "x" ? "X" : "YouTube", reasonLabels[item.reason], metric(item.views, "Views")];
      if (item.site === "x") {
        parts.push(metric(item.likes, "Likes"), metric(item.bookmarks, "Bookmarks"));
        if (item.views > 0 && item.likes !== null) parts.push(ratioPercent(item.likes, item.views, "Likes/views"));
        if (item.views > 0 && item.bookmarks !== null) parts.push(ratioPercent(item.bookmarks, item.views, "Bookmarks/views"));
      }
      parts.push("Hide events: " + item.events.toLocaleString());
      if (!Number.isNaN(date.getTime())) parts.push(date.toLocaleString());
      details.textContent = parts.join(" · ");
      row.append(link, details);
      entries.append(row);
    }
    clearButton.disabled = history.counts.x === 0 && history.counts.youtube === 0 && history.entries.length === 0;
    status.textContent = history.entries.length ? "" :
      (clearButton.disabled ? "No hide events recorded yet." : "Hide events were recorded, but no item links were available.");
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

  extension.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && Object.hasOwn(changes, STORAGE_KEY)) void loadHistory();
  });
  void loadHistory();
})();
