"""Generate the blog post's charts for Minimum Views Filter.

Run from any directory:

    uv run --with matplotlib --with numpy python blog/generate_charts.py

Outputs (PNG, written to ``blog/images/``):

- ``banner.png``: cover image. The extension's funnel icon, its name, and a
  three-post feed where the low-view post is hidden.
- ``decision-map.png``: the X keep/hide regions in the
  (views, likes/views) plane at the extension's default settings, assuming the
  saves/views and replies/views keep rules also pass.
- ``ratio-noise.png``: how much a likes/views ratio can move at a given view
  count. Two curves: the jump caused by one extra like (100 / v percentage
  points) and the binomial standard deviation of the ratio at a true like rate
  of 2% (100 * sqrt(p * (1 - p) / v) percentage points).
- ``history-batching.png``: local-storage writes before and after statistics
  batching, read from ``docs/audit-history-performance-results.json``.

Default thresholds mirror ``src/settings.js`` (DEFAULTS); the decision logic
mirrors ``getFilterDecision`` in ``src/filter-core.js``.
"""

from __future__ import annotations

import json
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.patches import FancyBboxPatch, Patch

BLOG_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BLOG_DIR.parent
IMAGES_DIR = BLOG_DIR / "images"
HISTORY_RESULTS_PATH = PROJECT_DIR / "docs" / "audit-history-performance-results.json"

# Defaults from src/settings.js (views are counts, percentages are percent units).
X_MINIMUM_VIEWS = 1000
X_ENGAGEMENT_MINIMUM_VIEWS = 100
X_MINIMUM_LIKE_PERCENT = 0.5
X_KEEP_LIKE_PERCENT = 2.0

# Illustrative true like rate for the noise chart, equal to the keep threshold.
ILLUSTRATIVE_LIKE_RATE = X_KEEP_LIKE_PERCENT / 100

# Light-mode reference palette (dataviz skill, references/palette.md).
SURFACE = "#fcfcfb"
TEXT_PRIMARY = "#0b0b0b"
TEXT_SECONDARY = "#52514e"
GRID = "#e4e3df"
SERIES_BLUE = "#2a78d6"
SERIES_ORANGE = "#eb6834"
REGION_HIDDEN_VIEWS = "#d9d8d3"
REGION_HIDDEN_LIKES = "#f3c6b3"
REGION_KEPT = "#b9d3f2"
REGION_RESCUED = "#2a78d6"

FIGURE_DPI = 200

# Banner (cover image). The icon copies the extension's own icon in
# ``dist/*/icons/filter-*.png``: a blue square with three white bars.
BANNER_BACKGROUND = "#1f1e1d"
BANNER_ICON_BLUE = "#1f6fd1"
BANNER_CARD = "#34332f"
BANNER_CARD_HIDDEN = "#1f1e1d"
BANNER_TEXT = "#ffffff"
BANNER_TEXT_HIDDEN = "#6b6a66"
BANNER_HIDDEN_TAG = "#eb6834"
# (view count shown on the card, kept on screen?) for the three example posts.
BANNER_FEED = (("48K views", True), ("23 views", False), ("3.1K views", True))


def style_axes(axes: plt.Axes) -> None:
    """Apply recessive grid and axis styling."""
    axes.set_facecolor(SURFACE)
    axes.grid(True, which="major", color=GRID, linewidth=0.8)
    axes.set_axisbelow(True)
    for side in ("top", "right"):
        axes.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        axes.spines[side].set_color(TEXT_SECONDARY)
    axes.tick_params(colors=TEXT_SECONDARY)
    axes.xaxis.label.set_color(TEXT_PRIMARY)
    axes.yaxis.label.set_color(TEXT_PRIMARY)
    axes.title.set_color(TEXT_PRIMARY)


def decision_region(views: np.ndarray, like_percent: np.ndarray) -> np.ndarray:
    """Classify X posts with the default rules, assuming saves and replies pass.

    Parameters
    ----------
    views : np.ndarray
        Displayed view counts, shape (n_likes, n_views) from a meshgrid.
    like_percent : np.ndarray
        Likes divided by views, in percent, same shape as ``views``.

    Returns
    -------
    np.ndarray
        Integer codes, same shape: 0 hidden for low views, 1 hidden for a low
        likes/views ratio, 2 kept by the view minimum, 3 kept by the
        high-engagement exception although below the view minimum.
    """
    low_like = like_percent < X_MINIMUM_LIKE_PERCENT
    below_minimum = views < X_MINIMUM_VIEWS
    rescued = (views >= X_ENGAGEMENT_MINIMUM_VIEWS) & (like_percent >= X_KEEP_LIKE_PERCENT)
    region = np.where(low_like, 1, np.where(below_minimum, 0, 2))
    # The exception only matters where a hiding rule would otherwise apply.
    return np.where(rescued & (region != 2), 3, region)


def plot_decision_map() -> None:
    """Draw the cover: hide/keep regions over views and likes/views."""
    views_axis = np.logspace(1, 5, 900)
    like_axis = np.linspace(0, 5, 600)
    views_grid, like_grid = np.meshgrid(views_axis, like_axis)
    region = decision_region(views_grid, like_grid)

    colors = [REGION_HIDDEN_VIEWS, REGION_HIDDEN_LIKES, REGION_KEPT, REGION_RESCUED]
    cmap = plt.matplotlib.colors.ListedColormap(colors)

    figure, axes = plt.subplots(figsize=(12, 5.6), dpi=FIGURE_DPI, constrained_layout=True)
    figure.patch.set_facecolor(SURFACE)
    axes.pcolormesh(views_grid, like_grid, region, cmap=cmap, vmin=-0.5, vmax=3.5, shading="auto")
    axes.set_xscale("log")
    style_axes(axes)
    axes.grid(False)
    axes.set_xlabel("Displayed views (log scale)", fontsize=13)
    axes.set_ylabel("Likes / views (%)", fontsize=13)
    axes.set_title(
        "Which X posts stay on screen (default rules; saves and replies assumed to pass)",
        fontsize=15, loc="left",
    )
    for threshold, label in (
        (X_ENGAGEMENT_MINIMUM_VIEWS, "100 views:\nratios may rescue"),
        (X_MINIMUM_VIEWS, "1,000 views:\nview minimum"),
    ):
        axes.axvline(threshold, color=TEXT_PRIMARY, linewidth=1.2, linestyle="--")
        axes.text(threshold * 1.08, 4.75, label, fontsize=11, color=TEXT_PRIMARY, va="top")
    legend_handles = [
        Patch(color=REGION_HIDDEN_VIEWS, label="Hidden: below view minimum"),
        Patch(color=REGION_HIDDEN_LIKES, label="Hidden: likes/views below 0.5%"),
        Patch(color=REGION_KEPT, label="Shown: passes the view minimum"),
        Patch(color=REGION_RESCUED, label="Shown: high-engagement exception"),
    ]
    axes.legend(handles=legend_handles, loc="upper right", fontsize=11, framealpha=0.95)
    figure.savefig(IMAGES_DIR / "decision-map.png", facecolor=SURFACE)
    plt.close(figure)


def plot_ratio_noise() -> None:
    """Draw how far a likes/views ratio moves at each view count."""
    views = np.logspace(1, 5, 400)
    one_like_step = 100 / views
    binomial_sd = 100 * np.sqrt(ILLUSTRATIVE_LIKE_RATE * (1 - ILLUSTRATIVE_LIKE_RATE) / views)

    figure, axes = plt.subplots(figsize=(10, 6), dpi=FIGURE_DPI, constrained_layout=True)
    figure.patch.set_facecolor(SURFACE)
    axes.plot(views, one_like_step, color=SERIES_BLUE, linewidth=2, label="Jump from one extra like: 100 / v")
    axes.plot(views, binomial_sd, color=SERIES_ORANGE, linewidth=2,
              label="Binomial standard deviation at a true 2% rate")
    axes.axhline(X_KEEP_LIKE_PERCENT, color=TEXT_SECONDARY, linewidth=1.2, linestyle=":")
    axes.text(2e4, X_KEEP_LIKE_PERCENT * 1.12, "2% keep threshold", color=TEXT_SECONDARY, fontsize=11)
    axes.axvline(X_ENGAGEMENT_MINIMUM_VIEWS, color=TEXT_PRIMARY, linewidth=1.2, linestyle="--")
    axes.text(X_ENGAGEMENT_MINIMUM_VIEWS * 1.08, 2e-3, "100-view gate", color=TEXT_PRIMARY, fontsize=11)
    axes.set_xscale("log")
    axes.set_yscale("log")
    style_axes(axes)
    axes.set_xlabel("Views v (log scale)", fontsize=13)
    axes.set_ylabel("Movement of likes/views (percentage points, log scale)", fontsize=13)
    axes.set_title("Small samples make like ratios jumpy", fontsize=15, loc="left")
    axes.legend(loc="upper right", fontsize=11, framealpha=0.95)
    figure.savefig(IMAGES_DIR / "ratio-noise.png", facecolor=SURFACE)
    plt.close(figure)


def plot_history_batching() -> None:
    """Draw local-storage writes before and after statistics batching."""
    results = json.loads(HISTORY_RESULTS_PATH.read_text(encoding="utf-8"))["results"]
    # Shorter labels for the four benchmark workloads, in file order.
    labels = {
        "one event in one message": "20 single-event messages",
        "four YouTube videos in four immediate messages": "20 bursts of 4 YouTube events",
        "32 events across tabs/sites/outcomes": "10 bursts of 32 events",
        "four full 100-item messages": "10 bursts of 4 x 100-item messages",
    }
    names = [labels[result["scenario"]["name"]] for result in results]
    before = [result["baseline"]["counts"]["localWrites"] for result in results]
    after = [result["current"]["counts"]["localWrites"] for result in results]

    positions = np.arange(len(names))
    bar_height = 0.36
    figure, axes = plt.subplots(figsize=(10, 5.4), dpi=FIGURE_DPI, constrained_layout=True)
    figure.patch.set_facecolor(SURFACE)
    axes.barh(positions - bar_height / 2 - 0.01, before, height=bar_height, color=SERIES_ORANGE, label="One write per message (v1.13.0)")
    axes.barh(positions + bar_height / 2 + 0.01, after, height=bar_height, color=SERIES_BLUE, label="Adjacent messages share a write (v1.13.1)")
    for index, (old, new) in enumerate(zip(before, after)):
        axes.text(old * 1.02, index - bar_height / 2, f"{old}", va="center", fontsize=11, color=TEXT_PRIMARY)
        axes.text(new * 1.02, index + bar_height / 2, f"{new}", va="center", fontsize=11, color=TEXT_PRIMARY)
    axes.set_yticks(positions, names, fontsize=11)
    axes.invert_yaxis()
    style_axes(axes)
    axes.grid(True, axis="x", color=GRID)
    axes.grid(False, axis="y")
    axes.set_xlim(0, max(before) * 1.12)
    axes.set_xlabel("Local-storage writes per workload", fontsize=13)
    axes.set_title("Batching statistics writes (identical final history)", fontsize=15, loc="left")
    axes.legend(loc="lower right", fontsize=11, framealpha=0.95)
    figure.savefig(IMAGES_DIR / "history-batching.png", facecolor=SURFACE)
    plt.close(figure)


def draw_banner() -> None:
    """Cover image: funnel icon, extension name, and a feed with one post hidden.

    Data units run x 0..16 and y 0..6, matching the 16x6-inch figure saved at
    100 dpi as a 1600x600 PNG.
    """
    figure, axes = plt.subplots(figsize=(16, 6))
    figure.subplots_adjust(0, 0, 1, 1)
    figure.patch.set_facecolor(BANNER_BACKGROUND)
    axes.set_xlim(0, 16)
    axes.set_ylim(0, 6)
    axes.axis("off")

    # Funnel icon: rounded blue square holding three white bars that get shorter.
    axes.add_patch(FancyBboxPatch((1.0, 1.35), 3.3, 3.3, boxstyle="round,pad=0,rounding_size=0.45",
                                  facecolor=BANNER_ICON_BLUE, edgecolor="none"))  # fmt: skip
    for half_width, centre_y in ((1.15, 3.75), (0.72, 3.0), (0.32, 2.25)):
        axes.add_patch(FancyBboxPatch((2.65 - half_width, centre_y - 0.2), 2 * half_width, 0.4,
                                      boxstyle="round,pad=0,rounding_size=0.06",
                                      facecolor="white", edgecolor="none"))  # fmt: skip

    axes.text(5.2, 4.15, "Minimum Views Filter", fontsize=44, fontweight="bold",
              color=BANNER_TEXT, va="center", family="DejaVu Sans")  # fmt: skip

    # Feed: three post cards; the low-view one is a dashed, faded outline tagged "Hidden".
    card_width, card_gap = 3.1, 0.35
    for index, (views_label, kept) in enumerate(BANNER_FEED):
        left = 5.25 + index * (card_width + card_gap)
        axes.add_patch(FancyBboxPatch((left, 1.25), card_width, 1.75,
                                      boxstyle="round,pad=0,rounding_size=0.2",
                                      facecolor=BANNER_CARD if kept else BANNER_CARD_HIDDEN,
                                      edgecolor="none" if kept else BANNER_TEXT_HIDDEN,
                                      linestyle="--", linewidth=2))  # fmt: skip
        text_colour = BANNER_TEXT if kept else BANNER_TEXT_HIDDEN
        # Two grey lines stand in for the post's text.
        for line_index, line_length in enumerate((2.4, 1.7)):
            axes.plot([left + 0.3, left + 0.3 + line_length], [2.6 - 0.3 * line_index] * 2,
                      color=text_colour, linewidth=6, alpha=0.35 if kept else 0.3,
                      solid_capstyle="round")  # fmt: skip
        axes.text(left + 0.3, 1.62, views_label, fontsize=19, fontweight="bold",
                  color=text_colour, va="center", family="DejaVu Sans")  # fmt: skip
        if not kept:
            axes.text(left + card_width - 0.3, 1.62, "Hidden", fontsize=17, fontweight="bold",
                      color=BANNER_HIDDEN_TAG, va="center", ha="right", family="DejaVu Sans")  # fmt: skip

    figure.savefig(IMAGES_DIR / "banner.png", dpi=100, facecolor=figure.get_facecolor())
    plt.close(figure)


def main() -> None:
    """Generate every chart used by the post."""
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    draw_banner()
    plot_decision_map()
    plot_ratio_noise()
    plot_history_batching()


if __name__ == "__main__":
    main()
