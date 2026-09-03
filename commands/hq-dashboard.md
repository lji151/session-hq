---
description: Show every HQ domain on one screen — stale, blocked, and untouched work
argument-hint: "[--stale-hours N] [--md] [--html <file>]"
allowed-tools: ["Bash", "Read"]
---

# The HQ dashboard

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/hq.mjs" dashboard $ARGUMENTS
```

Then answer the question the user actually has, which is almost never "what does the table say".
It is **what have I missed**. Lead with that:

- **Untouched** domains first. A domain with no workstreams is either finished or forgotten, and
  the difference matters.
- **Stale** next, oldest first — and say what it means: unverified, not necessarily wrong.
- **Blocked** last, separating what is waiting on the user from what is waiting on someone else.
  The first kind is the only kind they can act on right now.

Do not read the table back row by row. Two or three sentences of judgement is the whole value:
which domain needs attention, which is fine despite looking bad, and what you would do first.

Flags worth knowing: `--stale-hours N` to override the config threshold for one look, `--md` for a
copy-pasteable summary, and `--html <file>` to write a self-contained page — no scripts, no network
— that the user can keep open on a second monitor. Offer the HTML form if they mention wanting to
keep an eye on things.
