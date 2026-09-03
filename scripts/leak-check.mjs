#!/usr/bin/env node
/**
 * leak-check — refuse to ship personal data.
 *
 * Scans a directory tree against a denylist of terms and regexes and exits 1 on
 * any hit. The denylist lives OUTSIDE the repository on purpose: it contains the
 * very strings that must never appear inside it, so committing it would defeat
 * the point.
 *
 *   node scripts/leak-check.mjs [--denylist <file>] [--dir <dir>] [--json] [--quiet]
 *
 * Defaults: --dir  = the repository root (parent of scripts/)
 *           --denylist = ../.leak-denylist.txt, relative to the repository root
 *
 * Denylist format: one entry per line. Blank lines and lines starting with `#`
 * are ignored. Each entry is compiled as a case-insensitive regular expression;
 * an entry that is not valid regex syntax is matched literally instead, so
 * `some\path\` works without escaping.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

const SKIP_DIRS = new Set(['.git', 'node_modules', '.cache', 'dist', 'build', 'coverage']);
const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz', '.tar',
  '.mp4', '.mov', '.mp3', '.wav', '.woff', '.woff2', '.ttf', '.otf', '.exe', '.dll',
]);

export function parseDenylist(text) {
  const entries = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    let re;
    let kind = 'regex';
    try {
      re = new RegExp(line, 'gi');
    } catch {
      re = new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      kind = 'literal';
    }
    entries.push({ term: line, kind, re });
  }
  return entries;
}

/** Files to scan: git-tracked when available, otherwise a filtered walk. */
export function listFiles(dir) {
  try {
    const out = execFileSync('git', ['-C', dir, 'ls-files', '-z'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const tracked = out.split('\0').filter(Boolean).map((f) => path.join(dir, f));
    if (tracked.length > 0) return tracked;
  } catch {
    // Not a git repo, or git is unavailable. Fall through to the walk.
  }
  const found = [];
  (function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(path.join(current, entry.name));
      } else if (entry.isFile()) {
        found.push(path.join(current, entry.name));
      }
    }
  })(dir);
  return found;
}

export function scanText(text, entries) {
  const hits = [];
  const lines = text.split(/\r?\n/);
  for (const entry of entries) {
    for (let i = 0; i < lines.length; i++) {
      entry.re.lastIndex = 0;
      const m = entry.re.exec(lines[i]);
      if (m) {
        hits.push({ term: entry.term, kind: entry.kind, line: i + 1, match: m[0], excerpt: lines[i].trim().slice(0, 160) });
      }
    }
  }
  return hits;
}

export function scanTree({ dir, denylistPath }) {
  if (!fs.existsSync(denylistPath)) {
    const err = new Error(`denylist not found: ${denylistPath}`);
    err.code = 'ENODENYLIST';
    throw err;
  }
  const entries = parseDenylist(fs.readFileSync(denylistPath, 'utf8'));
  const results = [];
  let scanned = 0;

  for (const file of listFiles(dir)) {
    if (BINARY_EXT.has(path.extname(file).toLowerCase())) continue;
    let text;
    try {
      const buf = fs.readFileSync(file);
      if (buf.includes(0)) continue; // binary
      text = buf.toString('utf8');
    } catch {
      continue;
    }
    scanned++;
    for (const hit of scanText(text, entries)) {
      results.push({ file: path.relative(dir, file).split(path.sep).join('/'), ...hit });
    }
  }
  return { scanned, terms: entries.length, hits: results };
}

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq !== -1) flags[a.slice(2, eq)] = a.slice(eq + 1);
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) { flags[a.slice(2)] = argv[i + 1]; i++; }
    else flags[a.slice(2)] = true;
  }
  return flags;
}

export async function main(argv = process.argv.slice(2)) {
  const flags = parseArgs(argv);
  const dir = path.resolve(typeof flags.dir === 'string' ? flags.dir : REPO_ROOT);
  const denylistPath = path.resolve(
    typeof flags.denylist === 'string' ? flags.denylist : path.join(REPO_ROOT, '..', '.leak-denylist.txt')
  );

  let result;
  try {
    result = scanTree({ dir, denylistPath });
  } catch (err) {
    if (err.code === 'ENODENYLIST') {
      console.error(`leak-check: ${err.message}`);
      console.error('Create one (one term or regex per line) outside the repo, or pass --denylist <file>.');
      process.exitCode = 2;
      return;
    }
    throw err;
  }

  if (flags.json) {
    console.log(JSON.stringify({ dir, denylistPath, ...result }, null, 2));
  } else if (result.hits.length === 0) {
    if (!flags.quiet) {
      console.log(`leak-check: clean — ${result.scanned} files scanned against ${result.terms} denylist terms.`);
    }
  } else {
    console.error(`leak-check: ${result.hits.length} hit(s) in ${result.scanned} files.\n`);
    for (const h of result.hits) {
      console.error(`  ${h.file}:${h.line}  [${h.term}] -> "${h.match}"`);
      console.error(`      ${h.excerpt}`);
    }
    console.error('\nRemove or fictionalise every hit before committing.');
  }
  process.exitCode = result.hits.length === 0 ? 0 : 1;
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().catch((err) => {
    console.error(`leak-check: ${err.message}`);
    process.exitCode = 2;
  });
}
