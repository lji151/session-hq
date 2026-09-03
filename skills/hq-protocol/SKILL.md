---
name: hq-protocol
description: This skill should be used when a session needs to read or write the shared HQ status files, ideas inbox, or decision log — at session start, at session end, when handing off to another session, when a status file is stale, or when the user asks "what was the last session doing", "where did we leave off", "log this decision", or "update the status". Defines what belongs in a status entry, why negative results are mandatory, and how to handle staleness and conflicts.
version: 0.1.0
---

# The HQ protocol

## What the HQ is for

You are not the only session. Others ran yesterday, others are running now, and one will run
tomorrow with none of your context. The HQ folder is the only thing you and they share.

Live cross-session messaging answers "what is that session doing *right now*". The HQ answers
"what did the last five sessions already establish". Those are different questions, and the
second one is the expensive one to get wrong: a session that redoes finished work burns an hour
and produces nothing.

## The loop

**Read at start.** The plugin injects your domain's `status-<domain>.md` at session start. Read
it before you plan. If a section bears on what you are about to do, read the full file — the
injection is trimmed to `inject.maxLines`.

**Write at end.** Before the session stops, update the block for whatever you touched. The Stop
hook will remind you if you forget; it should never need to.

**Capture as you go.** An idea from the user goes to the inbox. A decision from the user goes to
the decision log. Neither goes in the status file.

## What a good status entry looks like

```
### Payment retry queue
- Status: retries land, but the dead-letter path drops the original error. Reproduced locally.
- Next: add the error field to DeadLetter.record() in queue/retry.ts:88, then re-run the fixture
- Blocked on: nothing
- Ruled out: not a serialisation bug — the field is present at enqueue and absent after the
  worker's structuredClone. Confirmed with a logged diff on both sides.
- Updated: 2026-01-31 (apps)
```

Every field earns its place:

- **Status** is where things stand, not what you did. "Investigated the retry queue" is a
  timesheet. "Retries land, but the dead-letter path drops the original error" is a status.
- **Next** must be actionable by someone who was not here. A file, a line, a command, a person.
  "Continue" and "keep going" are not next actions.
- **Blocked on** names what is waiting and on whom. "Nothing" is a good answer; write it rather
  than omitting the field, so the next session knows you checked.
- **Ruled out** — see below.
- **Updated** carries the date and which domain session wrote it.

## Negative results are the point

The single highest-value line in an HQ file is the one that says *this does not work, here is the
evidence*. It is also the one every session is tempted to omit, because a dead end feels like a
day with nothing to show.

It is not. Consider the arithmetic: three sessions, each independently spending forty minutes
discovering the same platform-side limitation, is two hours lost to a line that would have taken
thirty seconds to write.

Rules:

- If you eliminated a hypothesis, record it **with the evidence** — the error message, the
  measurement, the API response, the refusal. "Tried X, did not work" is nearly useless; the next
  session cannot tell whether you tried it correctly.
- If you verified something is *fine*, record that too. "Checked the other two environments,
  both healthy" stops the next session re-checking them.
- If you could not verify something, say so plainly. Never let silence imply coverage.

## Staleness

A status file older than `inject.staleAfterHours` is injected with a stale banner. Stale does not
mean wrong — it means unverified.

- Do not refuse to work off a stale file. Do not trust it blindly either.
- Verify only the parts you are about to depend on, and record the outcome of the check.
- If the file turns out to be badly wrong, correct it and note in the block that it was corrected
  and how it drifted. Drift has causes; naming them is how it stops.

## Conflicts and etiquette

- **Never delete another session's entry.** If it is wrong, supersede it with a dated line saying
  what changed. The log's value is that it is honest about the order things happened in.
- **Edit your block, not the file.** Rewriting the whole file makes concurrent sessions collide
  and destroys history.
- **Do not pad.** "No change, still blocked on the same approval" is a complete and useful entry.
  An invented update is worse than no update, because it will be believed.
- **Archive, do not hoard.** When a workstream is genuinely finished, collapse it to one line or
  move it out. A status file nobody wants to read is a status file nobody reads.

## Commands

| Command | Use |
|---|---|
| `/hq-status [domain]` | print the domain's status, or list domains |
| `/hq-update [domain]` | write this session's outcome back |
| `/hq-inbox <idea>` | append one line to the ideas inbox |
| `/hq-decide <decision>` | append one line to the decision log |
| `/hq-doctor` | check config, folders, and hook wiring |

## What does not belong in the HQ

- Secrets, tokens, credentials, or anything you would not paste in a shared document.
- Transcripts. The HQ is a state file, not an archive; see `recipes/conversation-archiver.md`
  if you want the full history somewhere.
- Long-form design docs. Link to them; do not inline them.
