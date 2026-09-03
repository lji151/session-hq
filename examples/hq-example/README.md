# HQ (example)

A worked example of a populated HQ. Everything in this folder is fictional — invented projects,
invented people, invented numbers. It exists so you can see what a *good* set of entries looks
like before you write your own.

Note that `hq.config.json` here has no `hqRoot`, so the folder containing it is the HQ root. Copy
this directory somewhere, point `HQ_ROOT` at it, and the plugin will work against it.

## Files

| File | Domain |
|---|---|
| `status-video.md` | short-form video production |
| `status-apps.md` | the small apps and services |
| `status-business.md` | the physical-goods side business |
| `ideas-inbox.md` | ideas, not commitments |
| `decisions.md` | decisions, one line each |

## The protocol

1. **At session start**, read your domain's `status-<domain>.md`. The plugin injects it for you.
2. **At session end**, update the block you touched: what changed, what is next, what is blocked,
   and **what you ruled out**.
3. **Ideas** go to `ideas-inbox.md`. **Decisions** go to `decisions.md`. Neither goes in a status file.
4. **Never delete another session's entry.** Supersede it with a dated line.

## Entry format

```
### <project or workstream>
- Status: <one line — where it actually stands>
- Next: <the specific next action, not "continue">
- Blocked on: <what is waiting, and on whom. "Nothing" is a valid answer>
- Ruled out: <what was tried and did not work, so nobody retries it>
- Updated: YYYY-MM-DD (<which session>)
```

## What to notice in the examples

- Every **Ruled out** line carries evidence — a number, an error, a comparison. "Tried it, did not
  work" would not survive a sceptical reader, and a sceptical reader will just redo the work.
- **Next** always names a file, a command, or a person. Never "continue".
- Some blocks are honestly boring: no change, still blocked. That is a complete entry.
- Entries do not brag. A status file that reads like a progress report is a status file that has
  started lying.
