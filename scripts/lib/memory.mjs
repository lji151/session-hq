// Linting a layered-memory directory.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { isDir, expandHome } from './util.mjs';

const MEMORY_TYPES = ['user', 'feedback', 'project', 'reference'];
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;
const LINK_RE = /\(([^)]+\.md)\)|\[\[([^\]]+)\]\]/g;
function linkedTargets(text) {
  const out = new Set();
  for (const m of text.matchAll(LINK_RE)) {
    const raw = m[1] || `${m[2]}.md`;
    out.add(raw.split(/[\\/]/).pop());
  }
  return out;
}

export function lintMemoryDir(dir) {
  const findings = [];
  if (!isDir(dir)) return [{ level: 'error', file: dir, message: 'memory directory not found' }];

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
  const INDEX = 'MEMORY.md';
  const hasIndex = files.includes(INDEX);
  if (!hasIndex) findings.push({ level: 'error', file: INDEX, message: 'top-level index missing — layered memory needs exactly one entry point' });

  const rootLinks = hasIndex ? linkedTargets(fs.readFileSync(path.join(dir, INDEX), 'utf8')) : new Set();
  const domainIndexes = files.filter((f) => /^index-.+\.md$/.test(f));

  const allLinks = new Set(rootLinks);
  for (const di of domainIndexes) {
    if (!rootLinks.has(di)) {
      findings.push({ level: 'warn', file: di, message: `domain index not linked from ${INDEX} — sessions will never find it` });
    }
    for (const t of linkedTargets(fs.readFileSync(path.join(dir, di), 'utf8'))) allLinks.add(t);
  }

  for (const f of files) {
    if (f === INDEX) continue;
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const fm = text.match(FRONTMATTER_RE);
    if (!fm) {
      findings.push({ level: 'error', file: f, message: 'no YAML frontmatter (needs name, description, type)' });
    } else {
      const block = fm[1];
      if (!/^name:\s*\S/m.test(block)) findings.push({ level: 'error', file: f, message: 'frontmatter missing `name`' });
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
    if (!/^index-.+\.md$/.test(f) && !allLinks.has(f)) {
      findings.push({ level: 'warn', file: f, message: 'orphan — not linked from the root index or any domain index' });
    }
    const lineCount = text.split(/\r?\n/).length;
    if (lineCount > 120) {
      findings.push({ level: 'warn', file: f, message: `${lineCount} lines — one fact per file; consider splitting` });
    }
  }
  return findings;
}

export function cmdMemoryLint(flags) {
  const dir = path.resolve(expandHome(
    typeof flags.dir === 'string' ? flags.dir : (process.env.HQ_MEMORY_DIR || path.join(os.homedir(), '.claude', 'memory'))
  ));
  const findings = lintMemoryDir(dir);
  if (flags.json) {
    console.log(JSON.stringify({ dir, findings }, null, 2));
  } else {
    console.log(`memory-lint: ${dir}`);
    if (findings.length === 0) console.log('  clean.');
    for (const f of findings) console.log(`  ${f.level === 'error' ? 'FAIL' : 'warn'} ${f.file}: ${f.message}`);
  }
  process.exitCode = findings.some((f) => f.level === 'error') ? 1 : 0;
}
