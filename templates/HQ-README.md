# HQ

The shared headquarters for every agent session that works on these projects.
One folder, plain markdown, no database. Any session can read it; any session can append to it.

Created {{DATE}} at `{{HQ_ROOT}}`.

## Files

| File | Domain |
|---|---|
{{DOMAIN_TABLE}}
| `ideas-inbox.md` | anything the user throws out that is not work yet |
| `decisions.md` | decisions the user actually made, one line each |
| `hq.config.json` | cadence and layout config — see `docs/config.md` |
| `.state/` | per-session bookkeeping written by the hooks; not for humans |

## The protocol

1. **At session start**, read your domain's `status-<domain>.md`. Your adapter injects it for you
   (Claude Code hooks, `hq.mjs wrap`, or your agent's instruction file).
   If it is marked stale, verify anything you are about to depend on.
2. **At session end**, update that same file: what changed, what is next, what is blocked,
   and **what you ruled out**. Edit the relevant section; do not rewrite the file.
3. **When the user floats an idea**, append one line to `ideas-inbox.md`. Ideas are not work yet.
4. **When the user decides something**, append one line to `decisions.md`. A decision is a
   commitment, not a preference.
5. **Never delete another session's entry.** Supersede it with a dated line instead.

## Entry format

```
### <project or workstream>
- Status: <one line — where it actually stands>
- Next: <the specific next action, not "continue">
- Blocked on: <what is waiting, and on whom. "Nothing" is a valid answer>
- Ruled out: <what was tried and did not work, so nobody retries it>
- Updated: YYYY-MM-DD (<which session>)
```
