// Reading a status file: when it was last touched, and what is inside it.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { isFile, hoursSince } from './util.mjs';
import { statusPath } from './config.mjs';
import { openDispatchesFor } from './dispatch.mjs';
const STAMP_RE = /<!--\s*hq:updated\s+([0-9T:.\-Z]+)\s*-->/;
/** Last-updated time for a status file: explicit stamp first, mtime as fallback. */
export function lastUpdatedAt(file) {
  if (!isFile(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  const m = text.match(STAMP_RE);
  if (m) {
    const d = new Date(m[1]);
    if (!Number.isNaN(d.getTime())) return { at: d, source: 'stamp' };
  }
  return { at: fs.statSync(file).mtime, source: 'mtime' };
}
export function hashFile(file) {
  if (!isFile(file)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/* ------------------------------------------------------- workstream blocks */

const NOTHING_RE = /^(nothing|none|n\/a|-+|tbd)\.?$/i;
const PLACEHOLDER_RE = /delete me|nothing has happened yet/i;
/**
 * Parse a status file into `###` workstream blocks.
 *
 * Deliberately forgiving: a field may be missing, bold, or continued across
 * indented lines, and prose sections under a `##` heading are not workstreams.
 */
export function parseStatusFile(text) {
  const blocks = [];
  let cur = null;
  let lastKey = null;

  for (const line of String(text).split(/\r?\n/)) {
    const heading = line.match(/^(#{1,6})\s+(.*\S)\s*$/);
    if (heading) {
      if (heading[1].length === 3) {
        cur = { title: heading[2].replace(/\s*—\s*delete me\s*$/i, '').trim(), raw: heading[2], fields: {} };
        blocks.push(cur);
      } else {
        cur = null; // a `##` section is prose, not a workstream
      }
      lastKey = null;
      continue;
    }
    if (!cur) continue;

    const field = line.match(/^\s*[-*]\s*\*{0,2}([A-Za-z][A-Za-z ]*?)\*{0,2}\s*:\s*(.*)$/);
    if (field) {
      lastKey = field[1].trim().toLowerCase();
      cur.fields[lastKey] = field[2].trim();
      continue;
    }
    // An indented line continues the previous field (sub-bullets under Ruled out).
    if (lastKey && /^\s{2,}\S/.test(line)) {
      cur.fields[lastKey] = `${cur.fields[lastKey]} ${line.trim()}`.trim();
    }
  }
  return blocks;
}
function hasContent(value) {
  return typeof value === 'string' && value.length > 0 && !NOTHING_RE.test(value.trim());
}
/** One domain's numbers, for a dashboard row. */
export function summariseDomain(hqRoot, domain, staleAfterHours) {
  const file = statusPath(hqRoot, domain);
  const row = {
    domain,
    file,
    exists: isFile(file),
    updatedAt: null,
    ageHours: null,
    source: null,
    stale: false,
    workstreams: 0,
    blocked: [],
    nextActions: 0,
    openDispatches: openDispatchesFor(hqRoot, domain).length,
    untouched: true,
  };
  if (!row.exists) return row;

  const stamp = lastUpdatedAt(file);
  row.updatedAt = stamp.at;
  row.ageHours = hoursSince(stamp.at);
  row.source = stamp.source;
  row.stale = row.ageHours > staleAfterHours;

  const blocks = parseStatusFile(fs.readFileSync(file, 'utf8'));
  const real = blocks.filter((b) => !PLACEHOLDER_RE.test(b.raw) && !PLACEHOLDER_RE.test(b.fields.status || ''));
  row.workstreams = real.length;
  row.untouched = real.length === 0;
  for (const b of real) {
    if (hasContent(b.fields['blocked on'])) row.blocked.push({ workstream: b.title, on: b.fields['blocked on'] });
    if (hasContent(b.fields.next)) row.nextActions++;
  }
  return row;
}
