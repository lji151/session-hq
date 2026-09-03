---
description: Set up the shared HQ — ask three questions, then create it
argument-hint: "[--root <dir>] [--domains a,b,c] [--profile gentle|coaching|strict|orchestrator]"
allowed-tools: ["Bash", "Read"]
---

# Set up the HQ

## Steps

1. If `$ARGUMENTS` already answers all of `--root`, `--domains` and `--profile`, skip to step 2.
   Otherwise, ask the user these three questions **in one chat message**, offering the defaults
   shown so Enter (or a short reply like "yes" or "defaults") accepts all three at once:

   - Where should the HQ live? Default `~/hq`.
   - What are your domains — projects, clients, or life areas (renamable later)? Default
     `video, apps, business`.
   - How should sessions be reminded: **gentle** (one reminder at session end, default),
     **coaching** (a nudge every 40 tool calls), or **strict** (a session cannot end without
     updating)?

2. Run, filling in whatever the user answered (or the defaults, if they took them) as flags —
   never rely on the CLI's own interactive prompts here, since this conversation already asked:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/hq.mjs" init --root "<root>" --domains "<a,b,c>" --profile <gentle|coaching|strict|orchestrator>
   ```

   It never overwrites an existing file unless `--force` is passed; existing files are reported
   as `kept`. It also writes `dashboard.html` and prints its path.

3. Tell the user, briefly: **restart Claude Code** (hooks load at session start), then run
   `/hq-dashboard`. If they picked orchestrator, mention starting one session with `HQ_DOMAIN=hq`.
