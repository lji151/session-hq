---
description: Review a finished dispatch and close it
argument-hint: "<dispatch-id>"
allowed-tools: ["Bash", "Read"]
---

# Review and close a dispatch

For the orchestrator session. `/hq-dashboard` lists what is waiting under **Awaiting review**, or:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hq.mjs" dispatches --awaiting-review
```

**Review before acking.** Read the department's note and check the specifics it claims — the file
it says it changed, the number it reports, the output it says it saw. Acking without checking is
how an unverified claim becomes an accepted fact.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hq.mjs" ack <id>
```

If the result is wrong or incomplete, do **not** ack it. Dispatch a follow-up naming what is
missing, and tell the user what you found.
