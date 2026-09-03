# Recipe: archive conversations to a markdown vault

The HQ holds **current state**, deliberately compressed. Sometimes you want the rest: what was
actually said three weeks ago, in full, searchable.

This recipe writes each session to a dated markdown file in a folder — a notes vault, a git repo,
anything that greps.

## HQ vs archive

| | HQ status file | Archive |
|---|---|---|
| Content | current state, compressed | full transcript |
| Written by | the session, deliberately | automatically |
| Read | every session, at start | rarely, on purpose |
| Size | kilobytes | megabytes and growing |
| Answers | "where do things stand" | "what exactly did we decide, and why" |

They are complements. The archive is not a substitute for writing status entries — nobody reads a
transcript to find out where a project stands, and an archive with no HQ just moves the problem
from "not written down" to "written down where nobody will look".

## The shape

**A Stop hook** appends the session to a dated file. The hook receives `transcript_path` in its
stdin JSON, which is the whole trick — you do not need to reconstruct anything.

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/../archive.mjs\"",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

```js
#!/usr/bin/env node
// archive.mjs — Stop hook. Appends this session's transcript to a dated vault file.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const VAULT = process.env.ARCHIVE_VAULT || path.join(os.homedir(), 'vault', 'sessions');

let hook = {};
try { hook = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { /* not a hook run */ }
if (!hook.transcript_path || !fs.existsSync(hook.transcript_path)) process.exit(0);

// Resume from where we stopped last time, so a session archived mid-run is not duplicated.
const stateFile = path.join(VAULT, '.archive-state.json');
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
const already = state[hook.session_id]?.lines ?? 0;

const lines = fs.readFileSync(hook.transcript_path, 'utf8').split(/\r?\n/).filter(Boolean);
const fresh = lines.slice(already);
if (fresh.length === 0) process.exit(0);

const day = new Date().toISOString().slice(0, 10);
const out = path.join(VAULT, `${day}.md`);
fs.mkdirSync(VAULT, { recursive: true });

const chunks = [];
if (!fs.existsSync(out)) chunks.push(`# Sessions — ${day}\n`);
if (already === 0) {
  chunks.push(`\n## Session ${hook.session_id}\n`);
  chunks.push(`- cwd: \`${hook.cwd ?? 'unknown'}\`\n- archived: ${new Date().toISOString()}\n`);
}

for (const line of fresh) {
  let ev;
  try { ev = JSON.parse(line); } catch { continue; }
  const role = ev.role ?? ev.type;
  const text = extractText(ev);
  if (!text) continue;
  chunks.push(`\n**${role}:**\n\n${text}\n`);
}

fs.appendFileSync(out, chunks.join(''), 'utf8');
state[hook.session_id] = { lines: lines.length, file: out };
fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));

/** Transcript shapes vary between versions. Be liberal, and never throw. */
function extractText(ev) {
  const c = ev.content ?? ev.message?.content;
  if (typeof c === 'string') return c.trim();
  if (Array.isArray(c)) {
    return c.filter((b) => b?.type === 'text').map((b) => b.text).join('\n').trim();
  }
  return '';
}
```

## Points that matter

**Resume, do not re-read.** The Stop hook can fire more than once in a session. Recording how many
transcript lines were already archived is what stops the file filling with duplicates.

**Never throw.** A crashing Stop hook is a bad session-ending experience for something that is
pure background bookkeeping. Wrap everything; exit 0 on anything unexpected.

**Do not assume the transcript schema.** It varies between Claude Code versions. Extract
defensively and skip what you do not recognise, rather than failing the whole archive because one
event shape changed.

**Filter before you write.** Tool inputs and outputs are most of the volume and rarely what you
want to reread. Text turns is usually enough; add tool calls only if you have a reason.

## Secrets

An archive is a durable, plain-text copy of everything a session saw. That is the point, and it is
also the risk.

- Keep the vault out of any repo you push. If it must be in git, use a private repo, and know that
  a secret committed once is committed forever.
- Redact before writing, not after. A pattern pass over the text for token-shaped strings costs
  nothing and catches the common case:

  ```js
  const REDACT = [
    /\b[0-9]{8,10}:[A-Za-z0-9_-]{30,}\b/g,   // bot-token shape
    /\b(sk|pk)-[A-Za-z0-9_-]{20,}\b/g,       // api-key shape
    /\bBearer\s+[A-Za-z0-9._-]{20,}/gi,
  ];
  const safe = REDACT.reduce((s, re) => s.replace(re, '[REDACTED]'), text);
  ```

- Redaction is a safety net, not a policy. Anything genuinely sensitive should not be pasted into
  a session in the first place.

## Retention

Archives grow without bound. Decide the policy up front, or the folder decides it for you by
becoming unusable:

- Roll into monthly folders; compress anything older than a quarter.
- Or keep a weekly digest and delete the raw files behind it — usually the honest choice, since
  what you actually want six months later is a summary, not sixty thousand words.

## Finding things

The archive earns its keep at the moment you need to answer "why did we decide that". Point a grep
at the vault. When you find the answer, put it where it should have been in the first place: a
line in `decisions.md`, or a fact file in the memory layer. The archive is where you recover
context you failed to capture — not where you should be storing it.
