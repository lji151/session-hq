# Case studies

Three composite stories, written from patterns that recur when several sessions work for one
person over months. Names, projects, and services are fictional; the failure modes are not.

Dates are relative — "day 1" is whenever this started for you.

---

## 1. The subscription deadline

**Day 1.** A user signs up for a paid subscription service to try it for a month. Somewhere in a
long session about something else entirely, they say: *"remind me to cancel this before it renews
— I do not want to be charged for a second month."*

The session says "will do" and carries on. Nothing is written down anywhere.

**Day 3.** Different session, different project. It knows nothing about a subscription.

**Day 12.** Another session. Same.

**Day 34.** The card is charged.

### What went wrong

The instruction landed in exactly one place: a transcript that was never read again. Every part
of the setup that could have caught it was absent — not broken, absent. No session after day 1 had
any way to know the commitment existed.

There is also a subtler failure. Even if the day-1 session had set a reminder, a reminder is a
single point of failure: a machine that was asleep, a notification dismissed while distracted, a
scheduled task that silently stopped after an OS update. One alarm for a hard money deadline is
not a system.

### What the setup should have been

Two layers, because they fail differently.

**Layer 1 — the deadline, as a scheduled reminder.** Not one reminder: several, spread across
days, escalating, delivered somewhere the user actually looks — a chat notifier rather than a
desktop toast. See [recipes/deadline-reminder.md](../recipes/deadline-reminder.md) and
[recipes/notifier-telegram.md](../recipes/notifier-telegram.md). Two details from that recipe are
what make it work: a **completion flag file**, so that once the user has cancelled the whole
series goes quiet in one move, and a **catch-up run**, so that a reminder scheduled while the
machine was off still fires the next time it wakes.

**Layer 2 — the rule, in the memory index.** The reminder is a point event. The rule is standing:

```markdown
---
name: feedback-confirm-before-paid-signup
description: Never start a paid trial or subscription without explicit approval; every trial gets a cancel deadline recorded the same day
type: feedback
---

The user's instruction (day 1): they do not want to be charged for a second month of anything
they signed up for to evaluate.

**Why:** A trial started in one session is invisible to every other session, so nothing catches
the renewal. This cost a real charge once.

**How to apply:**
- Never start a paid signup or trial without asking first, even a free one that converts.
- The same session that starts a trial records the cancel date, one day early, as reminders.
- Add a line to the HQ decision log: what was signed up for, what it costs, when it renews.
- No exceptions for "it is only a few dollars".
```

Because it lives in the always-apply layer of `MEMORY.md`, *every* future session reads it — the
one three weeks later that has never heard of this subscription included.

### Lesson

**Put the rule where every future session reads it, not where this session will remember it.**

A reminder covers one date. A rule in the memory index covers every future occurrence of the same
kind of mistake, including the ones you have not made yet. Reminders are for deadlines; the memory
index is for the class of deadline.

---

## 2. Three platforms, one question

**Setup.** The user publishes the same short-form videos to three platforms. They move to another
country, keep publishing on the same schedule, and views on platform A drop to essentially zero.
Platforms B and C are unaffected.

**Session 1 (day 1).** Spends about an hour on it. Checks whether the videos uploaded correctly —
they did. Checks whether the account has a strike or notice — nothing. Compares the numbers on the
other two platforms and finds them healthy, which is genuinely informative: it means the content
did not suddenly get worse, so whatever is happening is specific to platform A's distribution.

Then it reports: *"Platform A views have collapsed since the move. Uploads are fine and there is
no policy notice. It looks platform-side."*

The status file gets: **"Investigating platform A view drop."**

**Session 2 (day 3).** Reads that line. It says an investigation exists but not what it found, so
session 2 does the only responsible thing: it starts over. It checks uploads. It checks for a
policy notice. It compares against B and C. Another hour, and the same three findings.

**Session 3 (day 6).** Same again.

By day 6 the user has paid for three hours of identical work and still has one hypothesis.

### What went wrong

Session 1 did good work. It also produced *only negative results* — no upload problem, no policy
notice, other platforms fine — and negative results feel like nothing to report. So the status
line recorded the activity instead of the findings.

That is the specific trap. "Investigating X" is a status that carries zero information: the reader
knows someone looked, and nothing about what they saw. Worse, it actively invites duplication,
because a reader who cannot tell what was checked has to assume nothing was.

### What the entry should have said

```
### Platform A view collapse
- Status: views ~0 since day 1 (user relocated day 0). Content is not the cause.
- Next: pull the per-source traffic breakdown from A's analytics. If the platform's own
  recommendation surface reads 0 while search and direct are normal, this is distribution,
  not content, and the next step is a support ticket rather than more editing.
- Blocked on: nothing
- Ruled out:
  - upload failure — all 6 uploads present, correct duration, correct visibility
  - policy action — no notice in the account, no restriction banner
  - content quality — platforms B and C over the same window are within their normal
    range, same files, same titles. Whatever changed is specific to A.
- Updated: day 1 (video)
```

Session 2 reads that and starts where session 1 stopped. Two hours saved, and the investigation
actually advances instead of resetting.

Note that the three **Ruled out** lines carry evidence — counts, what was checked, what was
compared. "Checked uploads, fine" would not survive scrutiny: the next session cannot tell whether
they were checked properly, and if in doubt it will check again.

### Lesson

**Status files must carry negative results, and negative results must carry their evidence.**

An hour that eliminates three hypotheses is a productive hour. It only stays productive if it is
written down. The instinct to report only successes is exactly backwards for a handoff file: the
successes are visible in the work itself, and the eliminations exist nowhere else.

---

## 3. Model tiering

**Setup.** The user asks for a feature spanning a small web app and its build pipeline: a
non-trivial change, plus research into how a third-party format is structured, plus a verification
pass.

**How it goes badly.** The coordinating session does all of it. It reads the format spec itself,
writes the code itself, runs the tests itself. It is slower than it needs to be and more expensive
than it needs to be, and about two-thirds of the way through it hits a usage limit — mid-task,
with the change half-applied and the verification not started. The user gets an unfinished feature
and a session that cannot continue.

**How it goes badly in the other direction.** The coordinator delegates properly: a researcher
agent reads the spec, a coder agent implements, a second coder verifies. Each reports success. The
coordinator forwards all three summaries to the user.

The user opens the file that the report says was changed. It was not. The coder had edited a
similarly named file in a sibling directory, reported "implemented and tests pass", and the
coordinator — which never checked a single path — passed that through verbatim.

That is worse than doing it all itself, because now the user cannot trust any report.

**How it goes well.** The coordinator does three things and only three: understand what the user
wants, write briefs, review what comes back.

The briefs carry what the agents cannot discover — including, from the HQ file, that a previous
session already established the third-party format silently truncates a field beyond a certain
length, so nobody re-derives it. Research and implementation run in parallel where they are
independent. Each brief demands a verification step and a report section listing **what was not
verified**.

When the reports arrive, the coordinator spot-checks: do the file paths exist, do the line numbers
point at what the report claims, was the test output actually included or merely asserted. It
catches one wrong path, sends it back, gets a corrected patch, and only then reports to the user —
as one reviewed conclusion, not three agent transcripts.

The status file records the shape of it:

```
### Format export feature
- Status: shipped. Coder agent implemented export/serialise.ts; researcher agent
  established the field-length constraint from the spec; second coder verified against
  the fixture set (14/14).
- Next: nothing — watch for a truncation report from real data over the next week
- Blocked on: nothing
- Ruled out: streaming the export — the format needs a length prefix computed over the
  whole payload, so it cannot be produced incrementally without a second pass
- Updated: day 9 (apps)
```

### Lesson

**The review step is what makes delegation worth doing. Delegation without review just moves the
work — and adds a layer of confident prose over it.**

Two corollaries worth stating plainly:

- **Always name the model tier explicitly.** An unspecified tier inherits the coordinator's, which
  quietly undoes the whole arrangement; you find out when the budget or the limit tells you.
- **Record which agent did what.** Six weeks later, when a result turns out to be wrong, the
  useful question is not "what happened" but "what produced this, under what brief" — and only a
  written line can answer it.
