---
description: Append a decision to the shared decision log
argument-hint: "<the decision, in one line>"
allowed-tools: ["Bash"]
---

# Record a decision

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hq.mjs" decide "$ARGUMENTS"
```

If `$ARGUMENTS` is empty, ask what was decided.

A decision log entry records a **commitment**, not a preference and not your recommendation.
Before writing:

- Confirm the user actually decided. "That sounds good" during exploration is not a decision.
  If you are unsure, ask: recording this as decided, yes or no?
- Write what was decided and, in one clause, the reason. The reason is what stops a future
  session relitigating it.
- If this reverses an earlier decision, say so in the line. Never edit or delete the old entry;
  the log's value is that it is honest about the order things happened in.

Then update the relevant `status-<domain>.md` block if the decision changes what happens next.
