# Compatibility and reference research

Checked 2026-09-27. Relevant installed versions are recorded in `AGENTS.md`.
No existing extensions were disabled, reconfigured, or inspected for secrets.

## Verified observations

With the user's existing extensions active, X Home still exposed the analytics
anchor's exact `aria-label` count, its compact text, and a footer group label.
Control Panel for Twitter hiding the visible counter therefore did not erase
all count sources in this observed setup. The adapter prioritizes the exact
analytics count and falls back to its own post's footer metadata.

YouTube Home used `ytd-rich-item-renderer` containing `yt-lockup-view-model`.
View spans used `.ytContentMetadataViewModelMetadataText`, with a bare number
or abbreviation in text and an explicit views label in `aria-label`. The
adapter reads these labels even when CSS conceals their elements. Channel
names and video titles are not count sources.

Tests establish that turning this filter off does not overwrite a foreign
inline display rule, hidden attribute, or classes. No playback, keyboard,
audio, video codec, network, title, or thumbnail hooks are installed.

## Limits of coexistence

JavaScript isolation does not isolate DOM edits: extensions share the page
structure. A custom stylesheet can override this extension's CSS; another
extension can remove metadata or create an unrecognized card layout. The
unknown-count policy leaves such cards visible by default. Settings inside
Stylus, uBlock Origin, and Violentmonkey were not enumerated or changed.

DeArrow title/thumbnail changes do not determine the filtering count.
SponsorBlock-style player changes are outside this extension's code path.
PocketTube filters/deck layouts have more potential overlap: normal recognized
cards can be read, but custom layouts are not claimed as covered. These are
design-based expectations plus the observed live DOM, not a certification of
every extension/version combination.

## User-supplied alternatives

The official [YouTube Hider repository](https://github.com/MatteoLucerni/youtube-hider-extension)
was reviewed, including its README, `content/parsers.js`, and
`content/filters.js` on the `develop` branch. It provides a more extensive
YouTube-only product with minimum/maximum view thresholds, hide/dim modes,
per-page controls, and additional filters. Useful design checks were reading
metadata separately from titles, supporting changing card formats, and hiding
the outer card wrapper to avoid empty grid cells. This project's independently
written implementation already follows those principles. No source was copied.

[YT Filter's Firefox listing](https://addons.mozilla.org/en-US/firefox/addon/yt-filter/)
describes local minimum/maximum view filtering for the homepage. It is an
existing YouTube-only alternative, not evidence of this extension's runtime
compatibility. Claims about avoiding recommendation changes should be read as
avoiding explicit platform-feedback actions, not as preventing all impressions.

The supplied Winnow store URL could not be retrieved by the research tool due
to its consent redirect. Its stated dimming/minimum-view behavior was not
independently verified, and is not relied on for implementation.

Further primary references:

- [Chrome content scripts and shared DOM](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Control Panel for Twitter](https://github.com/insin/control-panel-for-twitter)
- [DeArrow](https://github.com/ajayyy/DeArrow)
- [SponsorBlock](https://github.com/ajayyy/SponsorBlock)
- [PocketTube](https://pockettube.io/)
