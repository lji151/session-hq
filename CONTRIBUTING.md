# Contributing

Thanks for looking. This is a small plugin with a deliberately small surface, so the most useful
contributions are usually sharpening what is here rather than adding to it.

## Setup

You need Claude Code and Node ≥ 18. There is nothing to install — the plugin has no dependencies
and no build step, which is a constraint worth preserving.

```bash
git clone https://github.com/your-github-username/session-hq
cd session-hq
node --test                      # 40+ tests, no network, no fixtures on disk
node scripts/hq.mjs doctor       # against your own HQ, if you have one
```

To try your working copy in a real session:

```bash
claude plugin marketplace add ./          # from the repo root
claude plugin install session-hq@session-hq
# restart Claude Code — hooks load at session start
claude plugin list
```

To undo that:

```bash
claude plugin uninstall session-hq
claude plugin marketplace remove session-hq
```

## Before you open a PR

```bash
node --test
claude plugin validate . --strict
claude plugin validate .claude-plugin/plugin.json --strict
node scripts/leak-check.mjs --denylist /path/to/your-denylist.txt
```

All four must pass. The last one needs a denylist file of your own — see below.

## Never commit personal data

This repository is public and is meant to stay generic. No real names, hostnames, absolute paths
containing a username, project or brand names, chat ids, tokens, emails, or text copied out of
someone's actual notes. Examples and case studies are fictional, and third-party services are
described generically ("a video platform", "a subscription service") rather than named.

`scripts/leak-check.mjs` enforces this. It scans every git-tracked file against a denylist of
terms and regexes and exits 1 on any hit:

```bash
node scripts/leak-check.mjs --denylist ../.leak-denylist.txt
```

**The denylist lives outside the repository, and must stay there.** It contains exactly the
strings that must never appear inside the repo, so committing it would defeat the point. Keep
your own, one term or regex per line; blank lines and `#` comments are ignored, and an entry that
is not valid regex syntax is matched literally.

If you have no local denylist, at minimum grep your diff for your own username and home directory
before pushing.

## Code

- **Node built-ins only.** No dependencies, no native modules, no build step. If something seems
  to need a library, it probably needs less code instead.
- **ESM**, `.mjs`, and every path handled through `node:path`. Windows is a first-class target —
  do not concatenate paths with `/`, and do not assume a POSIX home directory.
- **Hooks must never crash a session.** Every hook path catches its own errors and exits 0. A
  plugin that can break someone's session on a malformed config file is worse than no plugin.
- **Hooks must stay silent when they have nothing to say.** No config, no domain, no work done —
  print nothing. Noise is what gets a plugin uninstalled.
- **Comments explain why, not what.** If a line needs a comment saying what it does, rename
  something instead.

## Tests

`node:test`, no framework, no fixtures committed to disk. Tests create a temp HQ, drive
`scripts/hq.mjs` as a subprocess with realistic hook payloads on stdin, and clean up after
themselves.

New behaviour needs a test. Behaviour around cadence and enforcement needs two: one proving it
fires when it should, one proving it stays quiet when it should not. The second is the one that
protects users from an annoying plugin.

## Docs

Prose in this repo aims to be specific rather than enthusiastic. Concretely:

- Say what something costs, not only what it gives.
- Do not claim a feature the code does not have, and do not overstate how this relates to Claude
  Code's native features. Being modest and accurate there is a design goal.
- `README.ko.md` should stay in step with `README.md`. If you change one and cannot do the other,
  say so in the PR and it can be handled separately.

## Scope

Things that fit: better staleness handling, a status-file linter, more recipes, ergonomics for
teams sharing an HQ in git, translations.

Things that do not: anything involving multiple accounts or usage limits, API proxying, a daemon
or background service, a dependency, or automatic generation of status content. The last one is
worth restating — a status file is only worth reading because a human or a session that actually
did the work wrote it. Generated entries would make the whole thing untrustworthy.

If you are unsure whether an idea fits, open an issue before writing the code.
