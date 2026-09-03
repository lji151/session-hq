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

## The orchestrator session

The CEO seat can be a person reading `hq.mjs dashboard`, or it can be a session. An **orchestrator
session** is one session whose domain is `orchestrator.domain` (`hq` by default; `HQ_DOMAIN=all`
works too). Instead of one status file it is given the whole HQ — the dashboard in markdown, then
its own `status-hq.md`.

Its job is four things, and department work is not one of them:

1. **Read everything.** It starts each session with the dashboard: what is stale, what is blocked,
   what nobody has touched.
2. **Hand work to the domain that owns it.** The durable way is to write a `Next:` line into that
   domain's status file, so the request is waiting whenever that session next opens. If the harness
   exposes cross-session messaging and that domain's session is alive, a message is a fine way to
   get someone's attention *as well* — but it is never the record. Messages are ephemeral; the file
   is not.
3. **Record decisions** in `decisions.md` as they are made, not afterwards from memory.
4. **Review before reporting to the human.** Check the specifics — do the paths exist, do the
   numbers appear in the output, was it verified or asserted. A department report forwarded
   unchecked is worse than no report, because it will be believed.

**What it must not do** is department work. The moment the orchestrator starts editing a
department's code, it acquires that department's context, and the seat is gone — that is the
one-session model again, wearing a hat.

### Why this makes sessions disposable

The record lives in the HQ, not in any session's transcript. So a department session can be closed
the moment its work is written back, and nothing is lost: the orchestrator never read that session,
it read the file. Close them freely, reopen when there is something to do, and let compaction take
whatever it wants — the part that mattered is on disk.

### Reporting back

For an orchestrator session, a write to **either** `status-hq.md` **or** `decisions.md` counts as
reporting back, because on many days its entire output is a decision.

### Not the same thing as orchestrator-routing

Two different scopes, and it is worth keeping them apart:

- [`orchestrator-routing`](../orchestrator-routing/SKILL.md) is about **model tiers inside one
  session** — a coordinator writing briefs for coder and researcher subagents, and reviewing what
  comes back.
- This is about **sessions**, which are long-lived, own their own context, and are the thing the HQ
  files describe.

They compose: an orchestrator session delegating to a department session is this page; that
department session then delegating to subagents is the other one.

## Commands

| Command | Use |
|---|---|
| `/hq-status [domain]` | print the domain's status, or list domains |
| `/hq-update [domain]` | write this session's outcome back |
| `/hq-inbox <idea>` | append one line to the ideas inbox |
| `/hq-decide <decision>` | append one line to the decision log |
| `/hq-dashboard` | every domain on one screen: stale, blocked, untouched |
| `/hq-doctor` | check config, folders, and hook wiring |

## What does not belong in the HQ

- Secrets, tokens, credentials, or anything you would not paste in a shared document.
- Transcripts. The HQ is a state file, not an archive; see `recipes/conversation-archiver.md`
  if you want the full history somewhere.
- Long-form design docs. Link to them; do not inline them.
