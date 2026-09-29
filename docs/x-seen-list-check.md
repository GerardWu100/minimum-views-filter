# X seen-list investigation

On 2026-09-29, a passive check of the user's existing Brave X Home session found
one post that was briefly visible, then hidden by Minimum Views Filter, in X's
outgoing `HomeTimeline` request field `variables.seenTweetIds`.
This establishes a client-side seen-list leak in that sample. It does not prove
that a public view counter incremented, or that X will never recommend it again.

## Observations

The local source was v1.11.0 (`403510f`), which batches mutations for 80 ms.
The installed extension's version was not independently read. Its active marker
and hidden cards were verified on the live page. Other extensions and settings
were left in place.

| Measure | Observed |
| --- | ---: |
| Observation duration | About 246 seconds |
| Distinct own-post IDs observed | 68 |
| Posts observed hidden at some point | 39 |
| Posts observed intersecting the viewport | 26 |
| Successful HomeTimeline pagination requests | 2 (HTTP 200) |
| Unique IDs in the two `seenTweetIds` lists | 20 |
| Seen IDs matching observed viewport posts | 20 |
| Hidden posts included in those lists | 1 |
| Captured `client_event` or `jot` requests | 0 |

The first request contained nine seen entries (five distinct IDs), none matching
hidden posts. The second contained 28 entries (15 distinct IDs), including the
one post later hidden. That post intersected the viewport seven milliseconds
after first observation, was still intersecting at an animation-frame callback
at ten milliseconds, and was hidden at 45 milliseconds. It was not found as a
quoted ID within an observed visible post. No later unhidden intersection was
observed for it. The other 38 hidden posts were absent from both seen lists.

An animation-frame callback observes layout before paint; it does not prove
which pixels reached the display. These are instrumented observations, not
unmodified-browser timing or a population estimate. Posts already loaded when
observation started have unknown earlier exposure histories.

## Method and interpretation

After explicit user approval, a new Brave tab opened X Home with the existing
session. The Chrome DevTools Protocol captured outgoing requests and response
statuses without changing their contents. A temporary, bounded DOM observer
recorded each article's own timestamp permalink, extension hiding state, viewport
intersection, and animation-frame intersection. Different linked post IDs within
visible articles were checked as possible quote confounders.

The feed was scrolled with ordinary page-scroll actions. Only exact members of
`variables.seenTweetIds` were classified as seen-list evidence. An ID appearing
elsewhere in a request is not, by itself, an impression. A valid negative result
also needs visible-post controls and readable relevant traffic. None of this
establishes how X uses the list server-side or whether another endpoint records
impressions. X's [view-count help](https://help.x.com/en/using-x/view-counts) does
not specify the DOM visibility and timing rules for these requests.

Document-start instrumentation was unavailable through the supported browser
tool, so observation began after page load. The observer was stopped and removed,
network observation was disabled, and the test tab was closed. No raw requests,
credentials, post IDs, authors, or feed text are saved in this repository.

## Change and remaining verification

Version 1.11.1 evaluates affected X cards immediately at each mutation delivery,
reusing the normal filtering, whitelist, highlight, and history decisions. It
cancels an obsolete pending scan, including pending settings/full passes.
YouTube remains throttled. No request is intercepted, blocked, or rewritten.

Synthetic regression tests verify decisions before the next timer, including
card insertion, replacement, metadata hydration, and pending settings changes.
The [benchmark](performance.md) quantifies the additional work when X delivers
updates separately. Builds and Firefox lint pass, but the updated package has
not been installed or rechecked on a live feed.

The next useful check is to reload the extension when the user requests it,
reload X Home, and repeat the passive comparison with visible controls and
successful pagination requests. Initial settings retrieval, unknown counts,
route changes while observation is disconnected, and X code running before the
extension can still leave exposure windows. Even a clean repeat would establish
only that no hidden ID entered the captured lists in that sample.
