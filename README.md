# MMM-KitchenNews

News reader for the kitchen monitor that also works in other places.

Shows articles on a single line:

```
LOGO 4/12 Here is the title (3 hours): Here is the summary of the article …
```

The logo sits inline right in front of each title, followed by a position
indicator (`4/12` = the 4th of 12 articles), then the title, age and summary.
The first article scrolls in from the right, and the whole row scrolls
continuously to the left; when an article has fully passed, the next one
follows. Articles are mixed across sources and ordered newest first.

Feeds are RSS or Atom. They are fetched and parsed server-side (in
`node_helper.js`) using the same stack the stock `newsfeed` module uses
(`feedme` + `iconv-lite` + `html-to-text`), so there is **nothing to
`npm install`** on a normal MagicMirror install.

## Installation

Drop the `MMM-KitchenNews` folder into `modules/`. That's all.

## Configuration

Add a block to `config/config.js`:

Only `sources` is required; every other option has a sensible default, so keep
in `config` only the ones you want to override:

```js
{
    module: "MMM-KitchenNews",
    position: "bottom_bar",
    config: {
        sources: [
            { name: "Adressa", url: "https://www.adressa.no/rss",        maxCount: 8 },
            { name: "NRK",     url: "https://www.nrk.no/toppsaker.rss",  maxCount: 5 },
            { name: "VG",      url: "https://www.vg.no/rss/feed/",       maxCount: 5 }
        ]
        // e.g. add  speed: 20,  gapBetweenArticles: 120,  clearBeforeNext: true
    }
}
```

### Per-source options

| Option        | Default        | Description |
|---------------|----------------|-------------|
| `url`         | — (required)   | RSS or Atom feed URL. |
| `name`        | feed host      | Shown as the logo text fallback. |
| `logo`        | site favicon   | Logo URL, or a path relative to the module folder (e.g. `logos/nrk.png`). If omitted and `logoFallback` is on, the source's favicon is used. |
| `encoding`    | `"UTF-8"`      | Character encoding of the feed. |
| `maxAgeHours` | global value   | Drop articles older than this. |
| `maxCount`    | global value   | Keep at most this many articles from this source. |
| `skipIfNoSummary` | global value | If `true`, only show this source's articles that have a summary. |
| `categories`      | global value   | If non-empty, only show this source's articles tagged with one of these categories (exact match). A list here replaces the global one for this source. |
| `excludeCategories` | global value | If non-empty, hide this source's articles tagged with any of these (exact match). Wins over `categories`. A list here replaces the global one for this source. |

### Global options

| Option               | Default   | Description |
|----------------------|-----------|-------------|
| `maxAgeHours`        | `24`      | Default max age, used when a source doesn't set its own. |
| `maxCount`           | `5`       | Default per-source count, used when a source doesn't set its own. |
| `maxTotalCount`      | `30`      | Overall cap across all sources. Oldest articles are discarded when exceeded. |
| `skipIfNoSummary`    | `false`   | If `true`, only show articles that have a summary. Overridable per source. |
| `categories`         | `[]`      | If non-empty, only show articles tagged with one of these feed categories. Matching is **exact**. Empty = no filtering. Overridable per source. |
| `excludeCategories`  | `[]`      | If non-empty, hide articles tagged with any of these categories (exact match). Wins over `categories`. Overridable per source. |
| `speed`              | `175`     | Scroll speed in **pixels per second** — constant, so instances in a narrow and a wide position move at the same visual speed. `0` = frozen (first article only). |
| `clearBeforeNext`    | `false`   | `false`: the next article trails the previous one with `gapBetweenArticles` of space. `true`: the next article isn't shown until the previous has fully scrolled off to the left. |
| `gapBetweenArticles` | `80`      | Pixels of empty space between consecutive articles (when `clearBeforeNext` is `false`). |
| `height`             | `56`      | Max height of the bar, in pixels. |
| `width`              | `0`       | Explicit bar width in pixels (`0` = fill the region). Full-width `bar` regions (`top_bar`, `bottom_bar`) fill on their own; **centered regions such as `top_center` have no width of their own, so set this** — otherwise the ticker collapses to zero width and nothing shows. |
| `titleSize`          | `40`      | Font size of the title. A number is treated as pixels; a string (e.g. `"1.4rem"`) is used as-is. The logo is rendered at this height. |
| `summarySize`        | `36`      | Font size of the age and summary. Same number/string rule. |
| `maxLogoWidth`       | `100`     | Max logo width, in pixels. Height follows `titleSize`. |
| `marginTop`          | `8`       | Space above the bar, in pixels. |
| `marginRight`        | `0`       | Space to the right of the bar, in pixels. |
| `marginBottom`       | `0`       | Space below the bar, in pixels. |
| `marginLeft`         | `0`       | Space to the left of the bar, in pixels. |
| `fetchInterval`      | `600000`  | How often feeds are re-fetched, in ms (10 minutes). |
| `logoFallback`       | `true`    | When a source has no `logo`, use its site favicon. |
| `showAge`            | `true`    | Show `(3 hours)` after the title. |
| `showProgressBar`    | `true`    | Show the progress bar. |
| `progressBarPosition`| `"bottom"`| `"top"` or `"bottom"` — above or below the text. |
| `progressBarMargin`  | `4`       | Pixels between the text and the progress bar. |
| `progressBarHeight`  | `3`       | Progress bar height in pixels (added on top of `height`, not included in it). |
| `progressBarColour`  | `"white"` | Colour of the moving block. |
| `progressBarOpacity` | `50`      | Opacity of the block, percent (0–100). |
| `progressBarWidth`   | `0`       | Block width in pixels; `0` = module width ÷ number of articles. |

## How the motion works

- The first article scrolls in from the right edge; the row then scrolls left
  continuously at `speed` pixels per second (`0` freezes it). Because the speed
  is a constant in pixels, the same `speed` looks identical whether the bar is
  narrow (e.g. `top_center`) or full width (e.g. `bottom_bar`). When the whole
  list has passed, it loops and the first article re-enters from the right.
- With `clearBeforeNext: false` the next article trails the previous one with a
  `gapBetweenArticles` gap (ticker style). With `true`, the next one only
  appears once the previous has fully scrolled off.
- Each article shows, in order: its logo, a `4/12` position indicator (the Nth
  of the total shown), then the title, age and summary. The logo scrolls along
  inline at the same height as the title text.
- The progress bar (if shown) spans the whole module width. The track is
  transparent; a visible block steps across it — like a scroll bar — to mark
  which article of N is currently at the front. With N articles the width is
  split into N steps and the block is 1/N wide, unless `progressBarWidth` sets a
  fixed width. The bar's height sits on top of `height` (with `progressBarMargin`
  between them); the outer margin stays outside everything.

### Filtering by category

Feeds tag each article with zero or more `<category>` labels, and every
publisher invents its own — there is no shared vocabulary. `categories` is a
whitelist (show only these), `excludeCategories` a blacklist (hide these), and
`excludeCategories` wins when an article matches both. Matching is **exact**, so
`"Sport"` does not catch `"Sportsnyheter"`. Set them globally and/or per source;
a list on a source replaces the global one for that source. Examples of
categories actually seen in the configured feeds: Adressa — `Trondheim`,
`Trøndelag`, `Fotball`, `Kultur`, `Politikk`, `Sport`; NRK — `Rogaland`,
`Fotball`, `Mesterligaen`, `Politi og kriminalitet`; VG — `Sport`, `Nyheter`,
`Forbruker`. Note that some articles carry no category at all (many NRK ones),
and a `categories` whitelist drops those.

### A note on `gapBetweenArticles`: pixels vs percent

It's in **pixels**. Pixels are predictable regardless of screen width, which
suits a fixed kitchen display. If you'd prefer it proportional to the bar width,
that's an easy change — say the word.

## Custom logos

The favicon fallback renders immediately but is tiny. For crisp logos, drop
image files into a `logos/` folder in this module and point each source at them:

```js
{ name: "NRK", url: "https://www.nrk.no/toppsaker.rss", logo: "logos/nrk.png", maxCount: 5 }
```
