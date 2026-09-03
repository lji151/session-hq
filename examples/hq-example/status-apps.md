<!-- hq:updated 2026-01-31T21:05:00Z -->
# apps — status

Sessions working on **apps** read this first and update it last.
Keep it short enough that reading it is never a chore. Archive dead sections; do not hoard.

### Tidepool (note-sync service) — payment retry queue

- Status: fixed. `DeadLetter.record()` now carries the original error through; the 14-case fixture
  set is green. Deployed to staging 2026-01-31, not yet to production.
- Next: promote to production after the Monday morning traffic peak, then watch the dead-letter
  dashboard for one day before closing this out.
- Blocked on: nothing
- Ruled out:
  - serialisation — the field is present at enqueue and absent after the worker's
    `structuredClone`. Confirmed with a logged diff on both sides; `Error` instances do not
    survive that call, which is the whole bug.
  - retry backoff — timings are identical before and after the failure, so the scheduler was
    never involved. Two sessions have now checked this; do not check it a third time.
- Updated: 2026-01-31 (apps)

### Tidepool — export format

- Status: shipped 2026-01-28. Researcher agent established the field-length constraint from the
  format spec; coder agent implemented `export/serialise.ts`; a second coder verified against the
  fixture set (14/14). One wrong file path in the first report was caught in review and corrected
  before it reached the user.
- Next: nothing. Watch for a truncation report from real data over the next week.
- Blocked on: nothing
- Ruled out: streaming the export — the format needs a length prefix computed over the whole
  payload, so it cannot be produced incrementally without a second pass over the data. Not worth
  it at current file sizes (largest observed export: 2.1 MB).
- Updated: 2026-01-28 (apps)

### Marlow (internal dashboard)

- Status: no change since 2026-01-09. Runs, nobody has complained, nobody has asked for anything.
- Next: nothing scheduled.
- Blocked on: nothing
- Ruled out: nothing
- Updated: 2026-01-22 (apps)

### Shoreline (mobile client) — store submission

- Status: build 42 uploaded and in review since 2026-01-27. Fourth day of review, which is longer
  than the previous three submissions took.
- Next: if there is no movement by 2026-02-03, contact review support. Do not resubmit — a
  resubmission resets the queue position.
- Blocked on: platform review, entirely outside our control.
- Ruled out: the metadata warning from build 41 as a cause. It was cleared before this upload and
  the submission was accepted without it.
- Updated: 2026-01-30 (apps)
