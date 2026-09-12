// Linting a layered-memory directory.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { isDir, expandHome } from './util.mjs';
import { driftFindings, stripCode } from './drift.mjs';

const MEMORY_TYPES = ['user', 'feedback', 'project', 'reference'];
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

// `[text](file.md)`. The target may hold no parentheses and no spaces, which is what keeps a
// nested pair — `[a](b.md) … (see [c](d.md))` — from swallowing the line up to the outer `)`.
const MD_LINK_RE = /\(\s*([^()\s]+\.md)(?:#[^()\s]*)?\s*\)/g;
const WIKI_LINK_RE = /\[\[([^[\]\n]+)\]\]/g;
const TYPE_PREFIX = `(?:${MEMORY_TYPES.join('|')})`;

function mdLinkTargets(text) {
  const out = new Set();
  for (const m of text.matchAll(MD_LINK_RE)) out.add(m[1]);
  return out;
}
function wikiLinkTargets(text) {
  const out = new Set();
  for (const m of text.matchAll(WIKI_LINK_RE)) out.add(m[1]);
  return out;
}
/** Every file name the text points at, by either syntax. Used by the orphan check. */
function linkedTargets(text) {
  const out = new Set();
  for (const t of mdLinkTargets(text)) out.add(t.split(/[\\/]/).pop());
  for (const t of wikiLinkTargets(text)) out.add(`${t}.md`);
  return out;
}

/** `[[0.3,7.4]]`, `[[see below]]` and `[[!!]]` are prose, not links. */
function looksLikeLinkName(name) {
  if (/[\s,]/.test(name)) return false;
  return /[A-Za-z가-힣]/.test(name);
}
/** A link that leaves the memory directory is somebody else's problem. */
function isLocalTarget(target) {
  return !/[\\/]/.test(target) && !/^[a-z][a-z0-9+.-]*:/i.test(target);
}

/** Value drift is opt-in: `{ drift: true }`, or `--drift` on the command line. */
export function lintMemoryDir(dir, options = {}) {
  const { drift = false, driftMinFiles = 2 } = options;
  const findings = [];
  if (!isDir(dir)) return [{ level: 'error', file: dir, message: 'memory directory not found' }];

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
  const INDEX = 'MEMORY.md';
  const hasIndex = files.includes(INDEX);
  if (!hasIndex) findings.push({ level: 'error', file: INDEX, message: 'top-level index missing — layered memory needs exactly one entry point' });

  const present = new Set(files);
  const read = new Map();
  for (const f of files) read.set(f, fs.readFileSync(path.join(dir, f), 'utf8'));

  const rootLinks = hasIndex ? linkedTargets(read.get(INDEX)) : new Set();
  const domainIndexes = files.filter((f) => /^index-.+\.md$/.test(f));

  const allLinks = new Set(rootLinks);
  for (const di of domainIndexes) {
    if (!rootLinks.has(di)) {
      findings.push({ level: 'warn', file: di, message: `domain index not linked from ${INDEX} — sessions will never find it` });
    }
    for (const t of linkedTargets(read.get(di))) allLinks.add(t);
  }

  /** A pointer in an index that resolves to nothing is a dead end for every session. */
  const checkPointers = (f) => {
    for (const target of mdLinkTargets(stripCode(read.get(f)))) {
      if (!isLocalTarget(target) || present.has(target)) continue;
      findings.push({ level: 'warn', file: f, message: `broken pointer link (${target}) — no such file` });
    }
  };
  if (hasIndex) checkPointers(INDEX);

  for (const f of files) {
    if (f === INDEX) continue;
    const text = read.get(f);
    const stem = f.slice(0, -3);
    const fm = text.match(FRONTMATTER_RE);
    if (!fm) {
      findings.push({ level: 'error', file: f, message: 'no YAML frontmatter (needs name, description, type)' });
    } else {
      const block = fm[1];
      const nameMatch = block.match(/^name:\s*(\S.*?)\s*$/m);
      if (!nameMatch) findings.push({ level: 'error', file: f, message: 'frontmatter missing `name`' });
      else {
        const declared = nameMatch[1].replace(/["']/g, '').replace(/\.md$/, '');
        if (declared !== stem) {
          findings.push({ level: 'warn', file: f, message: `frontmatter name "${declared}" does not match filename — links to [[${declared}]] will not resolve` });
        }
      }
      if (!/^description:\s*\S/m.test(block)) {
        findings.push({ level: 'error', file: f, message: 'frontmatter missing `description` — that line is what a session reads to decide whether to open the file' });
      }
      const typeMatch = block.match(/^\s*type:\s*(\S+)/m);
      if (!typeMatch) {
        findings.push({ level: 'warn', file: f, message: `frontmatter missing \`type\` (one of ${MEMORY_TYPES.join(', ')})` });
      } else if (!MEMORY_TYPES.includes(typeMatch[1].replace(/["']/g, ''))) {
        findings.push({ level: 'warn', file: f, message: `unknown type "${typeMatch[1]}" — expected one of ${MEMORY_TYPES.join(', ')}` });
      }
      if (/^\s*type:\s*["']?feedback/m.test(block)) {
        const body = text.slice(fm[0].length);
        if (!/\bwhy\b/i.test(body)) findings.push({ level: 'warn', file: f, message: 'feedback file has no "Why" section — a rule without a reason gets argued with' });
        if (!/how to apply/i.test(body)) findings.push({ level: 'warn', file: f, message: 'feedback file has no "How to apply" section' });
      }
    }

    // A `[[name]]` that resolves to nothing is the rot a rename leaves behind.
    for (const name of wikiLinkTargets(stripCode(text))) {
      if (!looksLikeLinkName(name) || present.has(`${name}.md`)) continue;
      const near = new RegExp(`^${TYPE_PREFIX}-${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.md$`);
      const matches = files.filter((c) => near.test(c));
      const hint = matches.length === 1 ? ` (did you mean [[${matches[0].slice(0, -3)}]]?)` : '';
      findings.push({ level: 'warn', file: f, message: `broken link [[${name}]] — no such file${hint}` });
    }
    if (/^index-.+\.md$/.test(f)) checkPointers(f);

    if (!/^index-.+\.md$/.test(f) && !allLinks.has(f)) {
      findings.push({ level: 'warn', file: f, message: 'orphan — not linked from the root index or any domain index' });
    }
    const lineCount = text.split(/\r?\n/).length;
    if (lineCount > 120) {
      findings.push({ level: 'warn', file: f, message: `${lineCount} lines — one fact per file; consider splitting` });
    }
  }

  if (drift) {
    const docs = files.map((f) => ({ name: f, text: read.get(f) }));
    findings.push(...driftFindings(docs, { minFiles: driftMinFiles }));
  }
  return findings;
}

const LEVEL_LABEL = { error: 'FAIL', warn: 'warn', info: 'info' };

export function cmdMemoryLint(flags) {
  const dir = path.resolve(expandHome(
    typeof flags.dir === 'string' ? flags.dir : (process.env.HQ_MEMORY_DIR || path.join(os.homedir(), '.claude', 'memory'))
  ));
  const drift = Boolean(flags.drift) && flags.drift !== 'false';
  const parsedMin = Number.parseInt(flags['drift-min-files'], 10);
  const driftMinFiles = Number.isFinite(parsedMin) && parsedMin > 0 ? parsedMin : 2;

  const findings = lintMemoryDir(dir, { drift, driftMinFiles });
  if (flags.json) {
    console.log(JSON.stringify({ dir, findings }, null, 2));
  } else {
    console.log(`memory-lint: ${dir}`);
    if (findings.length === 0) console.log('  clean.');
    for (const f of findings) console.log(`  ${LEVEL_LABEL[f.level] || f.level} ${f.file}: ${f.message}`);
  }
  // `info` findings are advisory. Only an error fails the lint.
  process.exitCode = findings.some((f) => f.level === 'error') ? 1 : 0;
}
