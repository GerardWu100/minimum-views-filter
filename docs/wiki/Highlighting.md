# Highlighting

The extension can draw a **thin amber edge** on the left of X Home posts that get
unusually many saves for their views. It adds no background tint, badge, or
animation, and works in X's light, Dim, and Lights out themes.

A post is highlighted when every enabled condition is **strictly above** its
threshold:

| Condition | Default | Switch |
|---|---|---|
| bookmarks ÷ views | > 1% | **Detect high bookmarks/views** |
| likes ÷ views | > 2% | **Also require high likes/views** |
| replies ÷ views | > 0.1% | **Also require high replies/views** |

Example with 1,000 views: 11 saves, 21 likes and 2 replies → highlighted.
With 1 reply (exactly 0.1%) → not highlighted, because the rule is "strictly above".

**Show highlight in feed** hides the edge while Statistics keeps recording these
posts. Highlighting never rescues a hidden post; the filtering rules decide that.
