---
description: Report a dispatched task finished, with the result in one line
argument-hint: "<dispatch-id> <what happened>"
allowed-tools: ["Bash", "Read", "Edit"]
---

# Report a dispatch finished

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hq.mjs" done <id> --note "<one line: what happened>"
```

The note is the whole point. It is what the orchestrator reviews, so it must say the **outcome**,
not the activity: "re-rendered all three cuts, logo correct in each" rather than "worked on the
intro". If the task could not be done, say `done` with a note explaining why — an honest dead end
is a result, and leaving the dispatch open pretends it is still in progress.

Then update your domain's status file as usual with `/hq-update`. The dispatch note is a receipt;
the status file is where the reasoning lives.
