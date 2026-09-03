# Make the dashboard yours

**If you only do one thing: `hq.mjs dashboard --theme paper`.**

The page is generated, so anything you change has to survive being regenerated — which is why
none of this is "edit `dashboard.html`". There are three tiers, and most people never leave the
first one.

| Tier | You write | You get |
|---|---|---|
| 1 — a preset | one word | a different look |
| 2 — knobs | a few config keys | your colour, your font, your sections, your language |
| 3 — files | `dashboard.css`, `dashboard.template.html` | anything |

Everything below applies to the HTML page. `--terminal` and `--md` honour `sections`, `labels`,
`title` and `showHqRoot` — the four things that are not about colour — and ignore the rest.

---

## Tier 1 — pick a preset

```bash
node scripts/hq.mjs dashboard --theme paper
```

Four ship, and each is a small set of CSS variables — background, surface, text, muted, accent,
one colour per badge (stale, blocked, review, untouched), border, font, base size, radius:

| `--theme` | What it is |
|---|---|
| `auto` *(default)* | The original look: warm off-white, monospace, follows `prefers-color-scheme` for light or dark. |
| `paper` | Warm light, serif headings. Commits to light; ignores the OS setting. |
| `terminal` | Dark, monospace, green and amber. |
| `slate` | Cool dark, sans-serif. |

To keep a choice, put it in the config rather than typing the flag every time:

```json
"dashboard": { "theme": "slate" }
```

`--theme` on the command line beats the config, for that one run. A name that is not one of the
four prints a line on stderr and falls back to `auto` — a typo should not cost you the page.

Under Claude Code, `/hq-theme` lists the four and sets the config for you, and
`/hq-dashboard paper` renders once with a theme without changing anything.

---

## Tier 2 — knobs

Everything here lives in the `dashboard` block of `hq.config.json`. Every key is optional, and
`null` means *unset*, which is not the same as a value.

```json
"dashboard": {
  "theme": "auto",
  "title": null,
  "accent": null,
  "font": null,
  "density": "comfortable",
  "sections": ["stale", "blocked", "review", "untouched", "domains", "inbox", "decisions"],
  "labels": null,
  "showHqRoot": true,
  "decisions": 3
}
```

| Key | Type · default | Effect |
|---|---|---|
| `theme` | `auto` \| `paper` \| `terminal` \| `slate` · `"auto"` | The preset. |
| `title` | string or `null` · `null` | The `<title>` and the page's `<h1>`. `null` uses the label set's own title (`session-hq dashboard`). |
| `accent` | hex string or `null` · `null` | Overrides the theme's accent — the domain names, the heading markers. Anything that is not a hex colour (`#abc`, `#8a4b00`, `#8a4b00ff`) is ignored, because it would be pasted into a stylesheet. |
| `font` | `mono` \| `sans` \| `serif` \| any CSS font stack or `null` · `null` | Overrides body and heading fonts. A stack is taken as written, minus `;{}<>@`, which are the characters that would end the declaration. |
| `density` | `comfortable` \| `compact` · `"comfortable"` | Padding, line height and row height. `compact` fits roughly a third more on a screen. |
| `sections` | array · all seven | Which sections appear, and in what order. Omit a name to hide it. Known names: `stale`, `blocked`, `review`, `untouched`, `domains`, `inbox`, `decisions`. |
| `labels` | `en` \| `ko` \| object or `null` · `null` | The words. `null` follows the top-level `language` key. See below. |
| `showHqRoot` | boolean · `true` | Whether the HQ's absolute path appears in the header. Turn it off before a screenshot. |
| `decisions` | integer ≥ 0 · `3` | How many of the latest decisions to list. `0` hides them without hiding the section. |

`--theme`, `--density` and `--labels` also exist as flags, each overriding its config key for one
run. There is deliberately no flag for the rest: a colour you have to retype is not a preference.

### Sections

```json
"dashboard": { "sections": ["blocked", "review", "domains"] }
```

The order is the page's order, top to bottom, and it is the same order `--md` and `--terminal`
use. Two small behaviours worth knowing:

- When `decisions` comes directly after `inbox` — the default — the two share one heading,
  *Inbox and decisions*, exactly as the page has always looked. Separate them, and each gets its
  own.
- With a custom template (Tier 3), the *positions* are your template's; `sections` then decides
  only which slots have anything in them.

### Labels

`"labels": "ko"` ships a complete Korean set: section headings, table headers, relative times,
the empty-state sentences, the inbox count and the footer. `"en"` is the other complete set.

If `dashboard.labels` is unset, the top-level `language` key decides — so `"language": "ko"` on
its own gives you a Korean page, and setting `dashboard.labels` explicitly always wins over it.

An object overrides single words, on top of whichever set the rest of that chain selected:

```json
"dashboard": { "labels": { "stale": "Gone quiet", "blocked": "Stuck" } }
```

Add `"base": "ko"` inside the object to override words in the Korean set instead of the English
one. The keys, all optional:

| Group | Keys |
|---|---|
| Page | `title`, `lang` |
| Section headings | `stale`, `blocked`, `review`, `untouched`, `domains`, `inbox`, `decisions`, `inboxAndDecisions` |
| Table headers | `colDomain`, `colUpdated`, `colWork`, `colWorkstreams`, `colBlocked`, `colNext`, `colAsked` |
| Row values | `staleTag`, `noFile`, `noWorkstreams`, `noStatusFile`, `never`, `justNow`, `hoursAgo`, `daysAgo` |
| Empty states | `emptyStale`, `emptyBlocked`, `emptyReview`, `emptyUntouched`, `emptyDecisions`, `none`, `noneShort`, `noneRecorded` |
| Header and footer | `domainCount`, `domainsCount`, `staleAfter`, `generated`, `ideaWaiting`, `ideasWaiting`, `footerWatch`, `footerManual` |

`{n}`, `{h}`, `{s}` and `{when}` are the placeholders a label may carry — a count, the staleness
threshold in hours, the watch interval in seconds, and the generated time. `colWorkstreams` is
the long form, used only by `--md`, where the column is wide enough for it.

Every label is escaped before it reaches the page except `footerWatch` and `footerManual`, which
may contain markup because the shipped ones do (`<code>hq dashboard</code>`).

---

## Tier 3 — your own CSS, your own template

Two optional files in the HQ root. Neither is created for you; both are picked up the moment
they exist, and deleting one puts that half back the way it was.

Start from the real thing rather than a blank file:

```bash
node scripts/hq.mjs dashboard --eject
```

That writes `<hqRoot>/dashboard.template.html` and `<hqRoot>/dashboard.css` — the actual template
and the actual stylesheet for the theme you have configured (add `--theme terminal` to eject a
different one). It never overwrites: a file that already exists is reported as `kept`, and
delete it yourself if you want a fresh copy.

### `<hqRoot>/dashboard.css`

Inlined after the theme's variables, in the same `<style>` element, so it wins wherever the two
disagree. Usually you want a few lines, not a stylesheet:

```css
:root { --accent: #6d28d9; --radius: 10px; }
h2 { text-transform: none; letter-spacing: 0; }
```

The variables to override are the ones the ejected file shows at the top: `--bg`, `--surface`,
`--fg`, `--mut`, `--line`, `--accent`, `--stale`, `--stale-bg`, `--blocked`, `--blocked-bg`,
`--review`, `--review-bg`, `--untouched`, `--untouched-bg`, `--font`, `--font-head`, `--size`,
`--radius`, plus the density set `--pad-y`, `--pad-x`, `--row-y`, `--li-y`, `--lh`, `--gap`.
Nothing in the rules below them names a colour or a font directly, so overriding a variable is
enough to restyle everything that uses it.

### `<hqRoot>/dashboard.template.html`

A plain HTML file used instead of the built-in one. Slots are `{{name}}`; a name that is not a
slot renders as nothing, and no slot's content is rescanned, so text on the page can contain
braces safely.

| Slot | Contains |
|---|---|
| `{{lang}}` | The label set's language code, for `<html lang="…">`. |
| `{{title}}` | The page title, as text. |
| `{{meta}}` | The `--watch` auto-refresh tag, and nothing at all otherwise. **Optional** — see below. |
| `{{css}}` | The theme's stylesheet followed by your `dashboard.css`. Put it inside a `<style>` element. |
| `{{header}}` | The `<h1>` and the meta line (HQ root, domain count, staleness threshold, generated time). |
| `{{stale}}` `{{blocked}}` `{{review}}` `{{untouched}}` `{{domains}}` `{{inbox}}` `{{decisions}}` | One `<section class="sec sec-…">` each, heading included. Empty when `sections` omits that name. |
| `{{footer}}` | The generated/refresh sentence, as HTML, with no wrapper element. |

`{{meta}}` is where the `--watch` refresh tag goes. Leave it out and the tag is injected into
`<head>` for you (or after `<html>`, or after the doctype, whichever the file has first) — so
`--watch` keeps working on a template written without it in mind. A minimum viable template:

```html
<!doctype html>
<html lang="{{lang}}">
<head><meta charset="utf-8"><title>{{title}}</title>{{meta}}<style>{{css}}</style></head>
<body><main>{{header}}{{blocked}}{{review}}<footer>{{footer}}</footer></main></body>
</html>
```

Under `--watch`, both files are re-read on every pass, so editing your CSS with the page open
shows up on the next refresh.

---

## What stays true at every tier

- **One file, no server, no port.** The page is written to disk and opened; that is the whole
  mechanism.
- **No JavaScript on the page, and no network requests.** The built-in template and every theme
  are self-contained. If you eject and add a `<script>` or a webfont URL of your own, that is
  your page and your call — but the shipped one has neither, and the test suite checks it.
- **Nothing is written outside the HQ root**, except the path you pass to `--html`.
