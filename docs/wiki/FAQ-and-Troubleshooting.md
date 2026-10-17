# FAQ and Troubleshooting

**I changed the minimum but nothing changed.**
After updating the extension files, reload the extension (`chrome://extensions` →
**Reload**) *and* the X/YouTube tab. Check that you are on X Home, and that the
author is not whitelisted.

**Why is there a vertical line between two unrelated X posts?**
A low-view reply between them was hidden. Update to 1.14.1 or later; see
[[X Threads and Thread Lines]].

**A post with few views is still visible.**
Likely reasons: its view count is not on the card yet (unknown counts stay
visible by default); it passed the X keep rule; the author is whitelisted; or you
are not on an allowed page.

**Does hiding stop X or YouTube from learning about me?**
No. The extension only changes what you see. The site may still log that it
served the card, and it learns from your other activity.

**Does it work with my other extensions?**
It only adds and removes its own `data-minimum-views-*` attributes. It was
checked alongside Control Panel for Twitter, uBlock Origin, SponsorBlock,
DeArrow and others, but full compatibility with every setting or user script is
not guaranteed.

**Firefox says "Permission needed".**
`about:addons` → **Minimum Views Filter** → **Permissions and data** → allow
X/Twitter and YouTube, then reload the feed.

**Something else looks wrong.**
[Open an issue](https://github.com/GerardWu100/minimum-views-filter/issues) with
a screenshot, the page URL type (X Home, YouTube Home, …), and the extension
version.
