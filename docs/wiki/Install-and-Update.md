# Install and Update

Get the newest files from the
[latest release](https://github.com/GerardWu100/minimum-views-filter/releases/latest).

| Browser | File | Keep it zipped? |
|---|---|---|
| Chrome, Brave | `minimum-views-filter-chrome-brave-<version>.zip` | No: extract it |
| Firefox | `minimum-views-filter-firefox-<version>.xpi` (signed by Mozilla) | Yes: install the file as is |

## Chrome or Brave

1. Extract the ZIP into a folder you will keep (the browser loads files from it
   every time).
2. Open `chrome://extensions` (Chrome) or `brave://extensions` (Brave).
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the folder that contains `manifest.json`.
5. Reload any open X or YouTube tabs.

**Update:** replace the folder's files with the new ZIP's contents, click
**Reload** on the extension card, then reload X and YouTube tabs. Reloading only
the website is not enough: the browser can keep the old page script until the
extension itself reloads.

Tip: if you cloned the repository, you can load `dist/chrome-brave/` directly.
Then `git pull` updates the files, and you only do the two reloads.

## Firefox

1. Download the `.xpi` file. Do not extract it.
2. Open `about:addons`.
3. Click the gear icon, then **Install Add-on From File**, and pick the file.
4. Click **Add**, then reload open X or YouTube tabs.

This install survives restarts. **Update:** install the newer `.xpi` the same way.
Firefox keeps your settings because the extension ID does not change.

If Firefox shows **Permission needed**: open `about:addons` → **Minimum Views
Filter** → **Permissions and data**, and allow X/Twitter and YouTube.

## After install

Click the toolbar icon → **Settings** to change minimums or switch rules off.
Every rule has its own switch, and switching a rule off keeps its value for later.
