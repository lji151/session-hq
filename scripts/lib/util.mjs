// Small helpers shared by every other module. No session-hq concepts live here.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url));
export const SCRIPTS_DIR = path.resolve(LIB_DIR, '..');
export const PLUGIN_ROOT = path.resolve(SCRIPTS_DIR, '..');
export const TEMPLATES = path.join(PLUGIN_ROOT, 'templates');
/** The CLI entry point, so a printed command is runnable wherever the plugin lives. */
export const SELF = path.join(SCRIPTS_DIR, 'hq.mjs');

/* -------------------------------------------------------------- filesystem */

export function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}
export function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}
export function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
export function safeReadJson(p) {
  try { return readJson(p); } catch { return {}; }
}
export function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

/* ----------------------------------------------------------------- objects */

export function deepMerge(base, override) {
  const out = { ...base };
  for (const [k, v] of Object.entries(override || {})) {
    const bothPlainObjects =
      v && typeof v === 'object' && !Array.isArray(v) &&
      base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]);
    if (bothPlainObjects) out[k] = deepMerge(base[k], v);
    else if (v !== undefined) out[k] = v;
  }
  return out;
}

/* -------------------------------------------------------------------- time */

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
export function nowIso() {
  return new Date().toISOString();
}
export function hoursSince(date) {
  return (Date.now() - date.getTime()) / 3600000;
}

/* ----------------------------------------------------------------- strings */

export function expandHome(p) {
  if (typeof p !== 'string' || p.length === 0) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}
/** Cross-platform slug so a domain name can never escape the HQ root. */
export function safeSlug(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 64);
}
export function truncate(s, n) {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

/* -------------------------------------------------- commands and templates */

/** A copy-pasteable invocation of this very script, for adapters with no slash commands. */
export function cliCmd(rest) {
  return `node "${SELF}" ${rest}`;
}
export function renderTemplate(name, vars) {
  let text = fs.readFileSync(path.join(TEMPLATES, name), 'utf8');
  for (const [k, v] of Object.entries(vars)) {
    text = text.split(`{{${k}}}`).join(String(v));
  }
  return text;
}
