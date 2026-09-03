---
description: Append an idea to the shared ideas inbox
argument-hint: "<the idea, in one line>"
allowed-tools: ["Bash"]
---

# Capture an idea

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hq.mjs" inbox "$ARGUMENTS"
```

If `$ARGUMENTS` is empty, ask the user for the idea in one line first.

Before running, compress what the user said into a single line that will still make sense in six
months to someone who was not in this conversation. Keep their framing; drop the throat-clearing.

Then confirm in one line what you recorded. Do **not** start working on the idea, do not estimate
it, and do not add it to any plan — an inbox entry is explicitly *not* a commitment. If the user
wants it started, they will say so.
