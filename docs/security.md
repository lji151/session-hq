# Security notes

Short version: this is a set of local Node scripts that read and write markdown in a folder you
choose. It makes no network calls and stores no credentials. The parts worth thinking about are
what the hooks execute, what `wrap` runs, and who can write to the HQ folder.

## What executes, and when

**Hooks run `node` on files inside the plugin.** `hooks/hooks.json` declares four commands, and
every one is `node "${CLAUDE_PLUGIN_ROOT}/scripts/hq.mjs" <subcommand>`. Nothing is downloaded,
nothing is evaluated from the HQ folder, and no shell is involved. Read the file — it is 40 lines.

**`wrap` runs exactly the command you typed.** Everything after `--` is passed to `spawnSync` with
`shell: false`. The one exception is Windows: a `.cmd` or `.bat` shim cannot be spawned directly,
so on `ENOENT`/`EINVAL` on win32 only, it retries with `shell: true`. That path is in
[`scripts/lib/wrap.mjs`](../scripts/lib/wrap.mjs) and is worth knowing about if you ever pass an
untrusted string as the command — do not.

**`leak-check` shells out once**, to `git ls-files`, to enumerate tracked files. It falls back to a
filtered directory walk when that fails.

Verify the whole surface:

```bash
grep -rn "child_process\|spawnSync\|execFileSync\|execSync\|eval(\|new Function" scripts/
```

## The trust boundary is the HQ folder

Injected context is **file content that sessions wrote**. `hq.mjs inject` reads
`status-<domain>.md` and `dispatches.md` and puts them in front of a model. That is the point, and
it is also the boundary: text in those files becomes instructions-adjacent context for whatever
agent reads them next.

So:

- **Trust an HQ folder exactly as much as you trust everyone who can write to it.** For a solo HQ
  under `~/hq`, that is you. For a team HQ in a shared git repo, that is everyone with push access.
- **Review changes to a shared HQ the way you review code.** A pull request that edits
  `status-*.md` or `dispatches.md` is editing what your agents will read tomorrow.
- **Do not point `HQ_ROOT` at a directory other people can write to** unless you would also let
  them edit your prompts.
- The injected text is trimmed (`inject.maxLines`) but not sanitised. Sanitising it would mean
  guessing at the difference between a status note and an instruction, and guessing wrong quietly.

## Secrets

Nothing in this project reads credentials, and nothing should put them in an HQ. The status files
are meant to be shareable, greppable and, often, committed.

- The `hq-protocol` skill lists secrets under "what does not belong in the HQ".
- [`scripts/leak-check.mjs`](../scripts/leak-check.mjs) enforces a denylist of terms and
  credential-shaped regexes and exits non-zero on any hit. CI runs it against
  [`.github/leak-denylist.example.txt`](../.github/leak-denylist.example.txt), which holds only
  generic patterns; keep your real denylist outside the repository.
- The recipes that do involve a token ([notifier-telegram](../recipes/notifier-telegram.md)) take
  it from an environment variable, mask it in output, and say plainly never to commit or log it.

## Environment and filesystem

- Reads four environment variables, all its own: `HQ_ROOT`, `HQ_DOMAIN`, `HQ_MEMORY_DIR`,
  `CLAUDE_PLUGIN_ROOT`. (`grep -roE "env\.[A-Z_]+" scripts/`)
- Writes only inside the HQ root, plus whatever path you pass to `dashboard --html`.
  (`grep -rn "writeFileSync\|mkdirSync" scripts/`)
- Domain names reach the filesystem, so they are slugified to `[a-z0-9._-]` with leading dots and
  dashes stripped. `HQ_DOMAIN` cannot walk out of the HQ root. There is a test for this.
- `memory-lint` reads a directory you name and writes nothing.

## The demo image

[`docs/demo.svg`](demo.svg) is generated markup: SMIL `<animate>` elements only, no `<script>`, no
external fonts, no network references. Each of these returns 0:

```bash
grep -c "<script" docs/demo.svg
grep -cE "(href|src)=" docs/demo.svg
grep -oE "https?://[^\"' ]+" docs/demo.svg | grep -v "www.w3.org/2000/svg" | wc -l
```

## Reporting a vulnerability

Open a GitHub issue with the **security** label, or email the address in
[`.claude-plugin/plugin.json`](../.claude-plugin/plugin.json). If the issue would be harmful to
disclose before a fix, say so in the first line and leave out the details until we have a private
channel.

This is a 0.1 hobby project with one maintainer and no security SLA. It is also about 1,700 lines
of dependency-free Node that you can read in an afternoon, which is the honest mitigation.
