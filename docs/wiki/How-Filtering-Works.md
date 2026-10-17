# How Filtering Works

## Where it filters

| Site | Filtered | Never filtered |
|---|---|---|
| X | Home (For You and Following) | Search, profiles, Lists, opened conversations, notifications, messages |
| YouTube | Home; recommendations beside or below the video you watch | Search, subscriptions, channels, history, playlists, the Shorts player, the video player itself |

When you leave an allowed page, the extension removes all of its marks.

## The rules, in order

The first rule that applies decides.

1. **Whitelisted creator** → show. (See [[Whitelists and Sync]].)
2. **X keep rule** → show, even below the view minimum. All enabled conditions
   must pass at the same time:
   - likes ÷ views ≥ 2%
   - bookmarks (saves) ÷ views ≥ 0.5%
   - replies (comments) ÷ views ≥ 0.1%
3. **X low-likes rule** → hide when likes ÷ views < 0.5%.
4. **View minimum** → hide when views < 1,000 (each site has its own number).
5. Otherwise → show.

Unknown counts are **not zero**. A card with no readable view count stays
visible, unless you turn on **Hide unknown view counts**.

## Worked examples (default settings, X)

| Views | Likes | Saves | Replies | Result | Why |
|---:|---:|---:|---:|---|---|
| 999 | 5 | 0 | 0 | Hidden | Below 1,000 views |
| 1,000 | 5 | 0 | 0 | Shown | 5 ÷ 1,000 = 0.5%: meets the low-likes floor |
| 10,000 | 49 | 0 | 2 | Hidden | 49 ÷ 10,000 = 0.49% < 0.5% |
| 500 | 10 | 3 | 1 | Shown | 2%, 0.6%, 0.2%: all keep conditions pass |
| 500 | 10 | 3 | 0 | Hidden | Replies 0% fails the keep rule; 500 < 1,000 |
| 500 | 10 | 2 | 1 | Hidden | Saves 2 ÷ 500 = 0.4% < 0.5% |

YouTube uses only the view minimum and the unknown-count switch.

## Nothing is blacklisted

The extension decides again every time the page shows new counts. A post hidden
at 800 views comes back when the page shows 1,500 views, on this visit or a later
one. The Statistics history is never used to hide anything.

## What it cannot do

Hiding happens in your browser after the site sends the card. X or YouTube may
still log that the card was served. The extension reduces brief flashes, but a
card can still appear for a moment at startup, after navigation, or when its
count loads late.
