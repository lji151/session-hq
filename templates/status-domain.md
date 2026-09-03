<!-- hq:updated {{STAMP}} -->
# {{DOMAIN}} — status

Sessions working on **{{DOMAIN}}** read this first and update it last.
Keep it short enough that reading it is never a chore. Archive dead sections; do not hoard.

### Example workstream — delete me
- Status: created {{DATE}} by `/hq-init`. Nothing has happened yet.
- Next: replace this block with a real workstream the first time you work on {{DOMAIN}}.
- Blocked on: nothing
- Ruled out: nothing yet
- Updated: {{DATE}} ({{DOMAIN}})

---

## Conventions for this file

- One `###` block per workstream. Alphabetical or by urgency, your choice, but pick one.
- **Ruled out** is not optional. A session that spent an hour proving a path is dead has
  produced a real result, and it is worth as much as a success.
- Update the `hq:updated` stamp at the top when you edit. Without it, staleness falls back
  to the file's modification time, which a checkout or a sync can falsify.
