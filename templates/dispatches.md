# Dispatches

Work handed from one seat to a department, and the result handed back. Append-only, one line each.

```
- [ ] d-a1b2c3 · 2026-02-04 · hq → video · re-render the intro with the fixed logo
- [x] d-a1b2c3 · 2026-02-04 · hq → video · re-render the intro ↳ done 2026-02-05: shipped · acked 2026-02-06
```

- `[ ]` open — the department has not reported yet. It is injected into that domain's next session.
- `[x] ↳ done` — the department reported a result. It is now in the orchestrator's review queue.
- `· acked` — reviewed and closed.

Use `hq.mjs dispatch --to <domain> "<task>"`, then `done <id> --note "<result>"`, then `ack <id>`.
Editing by hand is fine; the format above is all the parser needs.

Started {{DATE}}.

