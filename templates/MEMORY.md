# Memory index

The single entry point. Sessions read this file, then read **only** the domain index that
matches the work at hand. Never read every index; that is what the layering is for.

## Always-apply rules

Rules that hold regardless of what the session is doing. Keep this list short — everything here
is paid for on every single session.

- [Example standing rule](feedback-example-rule.md) — one line saying what the rule is and why it exists

## Domain indexes

Read the one that matches the task. If none matches, do the work without an index and ask the
user whether a new domain is warranted before creating one.

- [Example domain](index-example.md) — one line describing what work falls under this domain

## Shared tools and infrastructure

Facts that more than one domain needs.

- [Example reference](reference-example.md) — one line saying what this is for
