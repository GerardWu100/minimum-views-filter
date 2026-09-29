(function () {
  "use strict";

  const extension = globalThis.browser || globalThis.chrome;
  for (const [buttonId, page] of [["open-settings", "options.html"], ["open-statistics", "history.html"]]) {
    document.getElementById(buttonId).addEventListener("click", async () => {
      try {
        await extension.tabs.create({url: extension.runtime.getURL(page)});
      } catch {
        document.getElementById("status").textContent = "Could not open the page. Please try again.";
      }
    });
  }
})();
