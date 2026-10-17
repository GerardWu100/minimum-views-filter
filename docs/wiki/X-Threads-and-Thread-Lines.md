# X Threads and Thread Lines

On X Home, a reply sometimes appears right below the post it answers. X joins the
two with a **thin vertical line** from the first avatar down to the reply's
avatar, and leaves out the divider between them.

```
  (A)  Post A ............ 6.1K views
   |
   |   <- X's thread line: "B answers A"
   |
  (B)  Reply B ........... 300 views
```

## A shown reply keeps its parent

If reply B passes your rules and post A does not, the extension keeps A visible,
so B never appears without its context. This walks up longer threads too. It
never reveals a hidden reply below a shown post. Setting: **Show posts that a
shown reply answers** (on by default).

## Why you might see a line between two unrelated posts

Before version 1.14.1, this could happen:

```
  (A)  Post A  (shown)                (A)  Post A  (shown)
   |                                   |   <- line still drawn
   |                                   |
  (B)  Reply B (300 views) -- hidden  (C)  Unrelated post C
                                      looks like "C answers A"
  (C)  Unrelated post C
```

The extension hid reply B, but A's half of the thread line stayed. It then
pointed at the next post, C, which had nothing to do with A.

**Since 1.14.1** the extension also hides that dangling line whenever one post of
a joined pair is hidden and the other is shown (in both directions). It uses
`visibility: hidden`, so nothing moves. X still leaves out the divider under
post A, so the gap to the next post can look a little tighter than usual.

## Limits

The extension recognizes a joined pair only from X's thread-line layout. If X
changes that layout, the parent is filtered on its own, and a dangling line can
come back until the extension is updated. Please
[open an issue](https://github.com/GerardWu100/minimum-views-filter/issues) with
a screenshot if you see one.
