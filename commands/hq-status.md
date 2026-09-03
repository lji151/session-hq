---
description: Print the HQ status file for a domain (or list the domains when none is given)
argument-hint: "[domain]"
allowed-tools: ["Bash", "Read"]
---

# Read the HQ status

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hq.mjs" inject --print --domain "$ARGUMENTS"
```

If `$ARGUMENTS` is empty, run it without `--domain` — that prints the domain list with the age
of each status file, and you should ask the user which one this session is about.

After reading:

- Say in one or two sentences what state the domain is actually in. Do not read the file back
  to the user; they can read.
- Call out anything marked **Blocked on** that is waiting on *them*.
- If the file was flagged stale, say so and name what you would verify first before relying on it.
- Do **not** start work off the back of a stale file without checking the parts you need.
