---
description: Pick a look for the HQ dashboard — four presets, one word each
argument-hint: "[auto|paper|terminal|slate]"
allowed-tools: ["Bash", "Read", "Edit"]
---

# Pick a look

There are four. If `$ARGUMENTS` already names one, skip straight to *Set it* below. Otherwise
show the user this list, in one message, and ask which they want — nothing else, no preamble:

- **auto** — the default. Warm off-white, monospace, and it follows your system's light/dark setting.
- **paper** — warm light, serif headings. Reads like a printed page.
- **terminal** — dark, monospace, green and amber. A console that happens to be a page.
- **slate** — cool dark, sans-serif. The one that looks least like a terminal.

Mention, in one line, that they can try one without committing to it:
`/hq-dashboard paper` renders once with that look and changes nothing.

## Set it

Find the config file (the `config` check names its path):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hq.mjs" doctor --json
```

Read that `hq.config.json` and set `dashboard.theme` to the chosen word, adding a `"dashboard"`
block if the file has none:

```json
"dashboard": { "theme": "paper" }
```

Edit only that key. The rest of the block — `accent`, `font`, `density`, `sections`, `labels` —
is documented in [docs/dashboard.md](../docs/dashboard.md) and is not yours to change here.

## Show it

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hq.mjs" dashboard
```

That regenerates the page with the new look and opens it. Confirm in one line which theme is now
set and where the page is, then stop. Do not read the dashboard's contents back — `/hq-dashboard`
is the command for that.
