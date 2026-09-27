"use strict";

// This test-only shim selects both adapters on localhost and supplies in-memory
// storage. Production scripts below it run unchanged; no extension is installed.
const fixtureCore = globalThis.MinimumViewsCore;
const fixtureListeners = new Set();
const fixtureSettings = {...globalThis.MinimumViewsSettings.DEFAULTS};
globalThis.browser = {storage: {
  local: {get: async () => fixtureSettings},
  onChanged: {
    addListener: callback => fixtureListeners.add(callback),
    removeListener: callback => fixtureListeners.delete(callback),
  },
}};
const fixtureSite = card => card.matches('article') ? "x" : "youtube";
globalThis.MinimumViewsCore = {
  ...fixtureCore,
  isSupportedPage: () => true,
  getCards: root => [...fixtureCore.getCards(root, "x"), ...fixtureCore.getCards(root, "youtube")],
  getViewCount: (card, _site, locale) => fixtureCore.getViewCount(card, fixtureSite(card), locale),
  getHideTarget: card => fixtureCore.getHideTarget(card, fixtureSite(card)),
};

document.getElementById("increase").addEventListener("click", () => {
  document.querySelector('#x-low [aria-label]').setAttribute("aria-label", "1500 views. View post analytics");
  document.querySelector('#yt-low [aria-label]').setAttribute("aria-label", "1500 views");
});
document.getElementById("insert").addEventListener("click", () => {
  if (document.getElementById("yt-new")) return;
  const card = document.createElement("ytd-rich-item-renderer");
  card.id = "yt-new";
  card.innerHTML = '<a id="video-title" href="/watch?v=synthetic4">New 25-view video</a><span class="ytContentMetadataViewModelMetadataText" aria-label="25 views">25</span>';
  document.getElementById("youtube-cards").append(card);
});
document.getElementById("disable").addEventListener("click", () => {
  for (const listener of fixtureListeners) listener({xEnabled: {newValue: false}, youtubeEnabled: {newValue: false}}, "local");
});
