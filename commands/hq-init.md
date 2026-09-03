---
description: Create the shared HQ folder — config, per-domain status files, ideas inbox, decision log
argument-hint: "[--root <dir>] [--domains a,b,c]"
allowed-tools: ["Bash", "Read", "Edit"]
---

# Set up the HQ

Create (or repair) the shared headquarters this machine's sessions will read and write.

## Steps

1. Decide the arguments before running anything.
   - `$ARGUMENTS` may already carry `--root` and/or `--domains`. Use them as given.
   - If no domains were supplied, **ask the user** which domains they want before running.
     A domain is a lane of work that a whole session tends to be about — not a single project.
     Three to seven is the useful range. Fewer, and the status files become junk drawers;
     more, and nobody keeps them current.
   - If no root was supplied, the default is `~/hq`. Confirm it if the user has an existing
     notes vault or shared drive that would be a better home.

2. Run:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/hq.mjs" init $ARGUMENTS
   ```

   It never overwrites an existing file unless `--force` is passed. Existing files are reported
   as `kept`.

3. Verify:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/hq.mjs" doctor
   ```

4. Tell the user the two things they must do for the plugin to actually engage:
   - **Restart Claude Code** — hooks load at session start, so the current session is still
     running without them.
   - **Give each session a domain**, by setting `HQ_DOMAIN` in the environment for that session,
     or by setting `defaultDomain` in `hq.config.json` for a machine that mostly does one thing.

5. Offer, but do not perform, the cadence choice: the default is a soft reminder on stop.
   Point them at `docs/config.md` if they want periodic nudges or hard enforcement.
