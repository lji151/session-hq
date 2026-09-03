---
name: orchestrator-routing
description: This skill should be used when a session is coordinating subagents rather than doing the work itself — when deciding which model tier a task belongs to, when writing a brief for a delegated task, when several independent tasks could run in parallel, or when reviewing a subagent's output before showing it to the user. Defines the coordinator/coder/researcher tiers, the brief template, and the review-before-showing checklist.
version: 0.1.0
---

# Orchestrator routing

## The shape

One session coordinates; other agents do the work.

```
coordinator  — reads intent, writes briefs, reviews output, talks to the user
   |
   +-- coder       — implementation, debugging, multi-step analysis, verification runs
   +-- researcher  — search, file sweeps, reading long output, screenshots, summarising
```

The coordinator's job is three things and only three: **understand what the user actually
wants**, **write briefs precise enough that a fresh agent can act on them**, and **review what
comes back before the user sees it**. Everything that involves hands — editing files, running
builds, driving a browser, generating assets — is delegated.

## Choosing a tier

| Question | If yes | Tier |
|---|---|---|
| Will this write or change code? | yes | coder |
| Does it need several steps of reasoning that build on each other? | yes | coder |
| Is it verification that must catch subtle breakage? | yes | coder |
| Is it search, reading, comparing, summarising, or a screenshot check? | yes | researcher |

**Always name the model explicitly when spawning.** An unspecified model inherits the
coordinator's, which quietly defeats the entire arrangement — you get the most expensive tier
doing a file sweep, and you find out when the budget or the rate limit says so.

Two rules that only look like details:

- **The coordinator does not do the work "just this once."** The one-line check that turns into
  an investigation is the standard failure. The moment a task grows a second step, delegate it.
- **Parallel where independent.** Tasks that do not depend on each other's output should be
  launched together, not in sequence. Tasks that share a scarce resource — a GPU, a device, a
  rate-limited account, a single browser profile — must not.

## The brief

A subagent starts with none of your conversation. Anything you do not write down does not exist
for it. `templates/subagent-brief.md` has the full form; the load-bearing parts:

- **Goal** — what "done" looks like as an outcome, not a list of steps. Steps constrain a capable
  agent into doing it your way, badly.
- **Context it cannot discover** — the two or three lines from the HQ status file that bear on
  this task, and especially **what has already been ruled out**. Skip this and you will pay for
  the same dead end twice.
- **Scope, in and out.** The "out" line is what prevents a two-file fix becoming a refactor.
- **Deliverable** — exactly what to return, and roughly how long.
- **Verification the agent must do before reporting** — the command to run, and what counts as
  passing. Without this, "done" means "I believe it works."
- **Report format** — including a required section for **what was not verified**. Agents omit
  this unless asked, and its absence is what makes a report look more complete than it is.

Guardrails belong in the brief, not in your head: approval gates, "do not deploy", "do not delete
anything published", resource exclusions. The agent cannot infer a rule it was never told.

## Long-running work needs a watchdog

A delegated batch job can stall silently. Attach something that watches for progress and alerts
you after a fixed period of no change, so a stalled agent is caught by you rather than by the
user asking why nothing has happened.

## Review before showing

Delegation without review is not delegation — it is just moving the work and adding a layer of
plausible-sounding prose. Before any subagent output reaches the user, check:

1. **Does the result answer the brief?** Not a related question. The actual one.
2. **Do the specifics exist?** Spot-check the paths, line numbers, commands, and figures. A
   confident report with a wrong path is the most common failure mode and the easiest to catch.
3. **Was it verified, or asserted?** Look for the evidence the brief required. "Tests pass" with
   no output is an assertion.
4. **What is missing?** Compare against the scope you wrote, not against the report's own summary
   of itself.
5. **Is the confidence honest?** Watch for hedges doing the work of results — "should work",
   "appears to", "likely fine". Push back or re-delegate.
6. **Then synthesise.** Give the user your reviewed conclusion, not a stack of agent transcripts.
   If two agents disagree, resolve it or say plainly that it is unresolved.

Catching one wrong path costs a minute. Not catching it costs the user's trust in every report
that follows.

## Record who did what

When the session updates its HQ status file, note which tier did which piece of work. Six weeks
later, when a result turns out to be wrong, the useful question is not "what happened" but "what
produced this, and under what brief" — and that is only answerable if someone wrote it down.
