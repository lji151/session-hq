---
description: Check the HQ config, folders, and hook registration, and report what is broken
allowed-tools: ["Bash", "Read"]
---

# Diagnose the HQ setup

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hq.mjs" doctor
```

Then interpret the output for the user rather than pasting it back:

- **FAIL** lines are things that stop the plugin working. Offer to fix each one; most are a
  missing folder, an unreadable config, or an invalid enum value in `hq.config.json`.
- **warn** lines are usually fine. Two are worth naming out loud:
  - a **STALE** status file — the domain has not been updated inside `inject.staleAfterHours`;
  - `plugin.loaded: CLAUDE_PLUGIN_ROOT not set` — expected when you run doctor by hand, since
    that variable only exists inside a hook.

To confirm the plugin itself is installed and its hooks are registered, `claude plugin list` and
the `/hooks` command are authoritative — doctor can only see the files, not the running session.
