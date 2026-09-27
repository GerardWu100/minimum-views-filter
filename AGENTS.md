# Minimum Views Filter

## User's goal and requirements

Build a browser extension for Chrome, Brave, and Firefox that hides X posts and
YouTube videos with fewer than 1,000 views from the user's feeds. The user wants
to avoid low-view recommendations without clicking “Not interested” or training
the platform through negative-feedback actions.

- Filter locally in the page. Never click, like, dismiss, mute, block, unsubscribe,
  submit feedback, or call platform APIs on the user's behalf.
- The default minimum is 1,000 views: hide 0–999; keep 1,000 and above.
- Do not permanently blacklist IDs. An item must become eligible again when the
  site displays a view count at or above the threshold, including on a later visit.
- Expose a configurable minimum and separate X/YouTube switches.
- Missing counts are unknown, not zero. Keep them visible by default; an explicit
  setting can hide unknown-count video/post cards.
- Read existing DOM text and accessibility labels even when CSS hides them.
  Prefer exact accessibility counts to rounded visible counts.
- Handle new cards, changed counts, recycled DOM nodes, and navigation without
  requiring full-page reloads. Never fetch counts or run background collection.
- Coexist with the user's extensions. Add/remove only this extension's own
  hiding attribute; preserve existing classes, inline styles, hidden attributes,
  player controls, network behavior, titles, thumbnails, and other filters.
- Do not promise complete compatibility with arbitrary user scripts or styles.
  If every copy of a count is removed, use the unknown-count policy.
- This changes presentation; it cannot guarantee that the platform did not log
  an impression or use other activity to personalize recommendations.
- Do not hide an opened X conversation or the active YouTube player. Current
  scope is X Home/Lists and YouTube desktop video cards, including recommendations.
- Do not install into the user's browser or change existing extension settings
  as part of development unless the user requests that action.

## Existing extensions that matter for compatibility

User supplied these versions on 2026-09-27: Control Panel for Twitter 4.24.3,
Improve YouTube 4.2081, DeArrow 2.3.10, Enhancer for YouTube 3.0.19, PocketTube
18.9.0, Return YouTube Dislike 4.0.5, SponsorBlock 6.1.6, Stylus 2.4.14, uBlock
Origin 1.75.0, and Violentmonkey 2.49.0. Playback/keyboard extensions also
include Global Speed 3.4.122, h264ify 2.0.1, Disable YouTube Number Keyboard
Shortcuts 1.0, Picture-in-Picture 1.14, and Volume Master 2.4.0.

Do not modify, disable, or reset those extensions to make this one work. Read
`GUIDE_ROOT.md` for verified compatibility observations and remaining limits.

## Project workflow

- Repository: `GerardWu100/minimum-views-filter`, private unless explicitly changed.
- Keep runtime code dependency-free. Development/build packages stay in npm devDependencies.
- Use `npm ci`, `npm test`, `npm run build`, and `npm run lint:firefox`.
- Add behavior tests for meaningful filtering changes. Cover 999/1,000 boundaries,
  hidden/removed counts, new and recycled cards, count increases, and preservation
  of other extensions' DOM changes.
- Update the README and guide when behavior, installation, or limits change.
- Do not commit dependencies, credentials, browser profiles, personal feed content,
  logs, or generated distribution files.
- Verify, review the staged diff, commit with plain `git commit`, and push.
