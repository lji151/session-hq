---
description: Hand a task to another domain's session, durably
argument-hint: "<domain> <task in one line>"
allowed-tools: ["Bash"]
---

# Dispatch work to a department

Parse `$ARGUMENTS` into a target domain and a task. If either is unclear, ask — a dispatch to the
wrong domain is worse than a question.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hq.mjs" dispatch --to <domain> "<task>"
```

Add `--priority high` only when the user signals urgency; if everything is high priority, nothing is.

**Always dispatch first.** The file is the record, and it works whether or not that domain's session
is running right now — which is the point, because it usually is not.

**Then, optionally, get their attention.** If this harness exposes cross-session messaging tools and
a live session for that domain is actually listed, send it a one-line message pointing at the
dispatch id. That is a courtesy, never the channel: message delivery and permissions are the
harness's business, and a message nobody received leaves no trace. The dispatch on disk does.

Report back to the user with the id and where it went, in one line. Do not start doing the task
yourself — you dispatched it because it belongs to another domain.
