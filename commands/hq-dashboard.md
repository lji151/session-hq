---
description: Open the HQ dashboard — one page with what you missed, refreshed on demand
argument-hint: "[--watch] [--stale-hours N]"
allowed-tools: ["Bash", "Read"]
---

# The HQ dashboard

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hq.mjs" dashboard $ARGUMENTS
```

That writes and opens one page — no server, no scripts, just HTML. It stays fresh by running the
command again, or by adding `--watch` to keep it regenerating on its own.

Do not stop at opening it. Also pull the same picture as text, so it lands in this conversation:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hq.mjs" dashboard --terminal $ARGUMENTS
```

Reply with the four lists, in this order, because that is the question the user actually has —
**what have I missed** — not "what does the table say":

- **Stale** — oldest first. Say what it means: unverified, not necessarily wrong.
- **Blocked** — what is waiting, and on whom. Separate what the user can act on now from what
  is waiting on someone else.
- **Awaiting review** — dispatched work a department finished, that nobody has checked yet.
- **Untouched** — a domain with no workstreams is either finished or forgotten, and the
  difference matters.

Keep it short: the lists themselves, plus one or two sentences of judgement — which domain needs
attention today, which looks bad but isn't. Do not read the table back row by row.
