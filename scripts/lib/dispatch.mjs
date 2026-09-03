// Work handed from one seat to a department, and the result handed back.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isFile, safeSlug, todayIso, truncate, renderTemplate } from './util.mjs';
import { discoverConfig, isOrchestratorDomain } from './config.mjs';
export const DISPATCH_FILE = 'dispatches.md';
/**
 * One line per dispatch, append-only, human-readable and human-editable:
 *
 *   - [ ] d-a1b2c3 · 2026-02-04 · hq -> video · !high · re-render the intro
 *   - [x] d-a1b2c3 · 2026-02-04 · hq -> video · re-render the intro ^ done 2026-02-05: shipped
 *   ... with " · acked 2026-02-06" appended once the orchestrator has reviewed it.
 *
 * The separators are written as the middle dot and the arrows below; the regex
 * accepts the ASCII forms too, because people edit this file by hand.
 */
export const SEP = ' · ';
export const ARROW = '→';        // ->
const DONE_MARK = '↳';    // downwards arrow with tip rightwards
const DISPATCH_RE = new RegExp(
  '^- \\[( |x)\\]\\s*' +
  '(d-[0-9a-f]{6})\\s*[·|]\\s*' +
  '(\\d{4}-\\d{2}-\\d{2})\\s*[·|]\\s*' +
  '([a-z0-9._-]+)\\s*(?:→|->)\\s*([a-z0-9._-]+)\\s*[·|]\\s*' +
  '(.*)$'
);

/* ----------------------------------------------------------------- reading */

export function dispatchPath(hqRoot) {
  return path.join(hqRoot, DISPATCH_FILE);
}
export function parseDispatches(text) {
  const out = [];
  let inFence = false;
  for (const line of String(text).split(/\r?\n/)) {
    // The file documents its own format in a fenced block. Those are examples,
    // not dispatches, and parsing them would inject a fictional task.
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = line.match(DISPATCH_RE);
    if (!m) continue;
    const [, mark, id, date, from, to] = m;
    let rest = m[6];

    let acked = null;
    const ack = rest.match(/\s*[·|]\s*acked\s+(\d{4}-\d{2}-\d{2})\s*$/);
    if (ack) { acked = ack[1]; rest = rest.slice(0, ack.index); }

    let done = null;
    const d = rest.match(/\s*(?:↳|->>|=>)\s*done\s+(\d{4}-\d{2}-\d{2})\s*:?\s*(.*)$/);
    if (d) { done = { date: d[1], note: d[2].trim() }; rest = rest.slice(0, d.index); }

    let priority = null;
    const pr = rest.match(/^!\s*([a-z]+)\s*[·|]\s*/i);
    if (pr) { priority = pr[1].toLowerCase(); rest = rest.slice(pr[0].length); }

    out.push({
      id, date, from, to, priority,
      text: rest.trim(),
      done: mark === 'x' ? (done || { date: null, note: '' }) : null,
      acked,
      line,
    });
  }
  return out;
}
export function readDispatches(hqRoot) {
  const file = dispatchPath(hqRoot);
  return isFile(file) ? parseDispatches(fs.readFileSync(file, 'utf8')) : [];
}
export function openDispatchesFor(hqRoot, domain) {
  const d = safeSlug(domain);
  return readDispatches(hqRoot).filter((x) => x.to === d && !x.done);
}
export function awaitingReview(hqRoot) {
  return readDispatches(hqRoot).filter((x) => x.done && !x.acked);
}

/* ----------------------------------------------------------------- writing */

function serialise(d) {
  const head = `- [${d.done ? 'x' : ' '}] ${d.id}${SEP}${d.date}${SEP}${d.from} ${ARROW} ${d.to}${SEP}`;
  const body = (d.priority ? `!${d.priority}${SEP}` : '') + d.text;
  const done = d.done ? ` ${DONE_MARK} done ${d.done.date}: ${d.done.note}` : '';
  const ack = d.acked ? `${SEP}acked ${d.acked}` : '';
  return head + body + done + ack;
}
function ensureDispatchFile(hqRoot) {
  const file = dispatchPath(hqRoot);
  if (!isFile(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, renderTemplate('dispatches.md', { DATE: todayIso() }), 'utf8');
  }
  return file;
}
/** Rewrite one dispatch line in place, leaving every other byte of the file alone. */
function replaceDispatchLine(hqRoot, id, transform) {
  const file = ensureDispatchFile(hqRoot);
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  let found = null;
  for (let i = 0; i < lines.length; i++) {
    const parsed = parseDispatches(lines[i])[0];
    if (parsed && parsed.id === id) {
      found = transform(parsed);
      if (found === null) return { file, dispatch: parsed, changed: false };
      lines[i] = serialise(found);
      fs.writeFileSync(file, lines.join('\n'), 'utf8');
      return { file, dispatch: found, changed: true };
    }
  }
  return { file, dispatch: null, changed: false };
}

/* ---------------------------------------------------------------- commands */

export function cmdDispatch(flags, positional) {
  const text = positional.join(' ').trim();
  const found = discoverConfig();
  if (!found) {
    console.error('hq: no hq.config.json found. Run `hq.mjs init` first.');
    process.exitCode = 1;
    return;
  }
  const { config, hqRoot } = found;
  const to = safeSlug(typeof flags.to === 'string' ? flags.to : '');
  if (!to || !text) {
    console.error('usage: hq.mjs dispatch --to <domain> [--from <domain>] [--priority high] "<task>"');
    process.exitCode = 1;
    return;
  }
  const known = (config.domains || []).map(safeSlug);
  if (!known.includes(to) && !isOrchestratorDomain(to, config)) {
    console.error(`hq dispatch: "${to}" is not a known domain (${known.join(', ')})`);
    process.exitCode = 1;
    return;
  }

  const from = safeSlug(typeof flags.from === 'string' ? flags.from : (config.orchestrator?.domain || 'hq'));
  const d = {
    id: `d-${crypto.randomBytes(3).toString('hex')}`,
    date: todayIso(),
    from,
    to,
    priority: typeof flags.priority === 'string' ? safeSlug(flags.priority) : null,
    text: text.replace(/\s*\n\s*/g, ' '),
    done: null,
    acked: null,
  };

  const file = ensureDispatchFile(hqRoot);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\s*$/, '\n') + serialise(d) + '\n', 'utf8');
  console.log(d.id);
  console.log(`dispatched to ${to}: ${d.text}`);
  console.log(`  ${file}`);
}
export function cmdDone(flags, positional) {
  const id = (positional[0] || '').trim();
  const found = discoverConfig();
  if (!found || !/^d-[0-9a-f]{6}$/.test(id)) {
    console.error('usage: hq.mjs done <id> [--note "<one line>"]');
    process.exitCode = 1;
    return;
  }
  const note = typeof flags.note === 'string' ? flags.note.replace(/\s*\n\s*/g, ' ') : '';
  const res = replaceDispatchLine(found.hqRoot, id, (d) => {
    if (d.done) { console.log(`${id} was already done on ${d.done.date}`); return null; }
    return { ...d, done: { date: todayIso(), note } };
  });
  if (!res.dispatch) {
    console.error(`hq done: no dispatch ${id} in ${res.file}`);
    process.exitCode = 1;
    return;
  }
  if (res.changed) console.log(`${id} marked done${note ? `: ${note}` : ''}. It is now awaiting review.`);
}
export function cmdAck(flags, positional) {
  const id = (positional[0] || '').trim();
  const found = discoverConfig();
  if (!found || !/^d-[0-9a-f]{6}$/.test(id)) {
    console.error('usage: hq.mjs ack <id>');
    process.exitCode = 1;
    return;
  }
  const res = replaceDispatchLine(found.hqRoot, id, (d) => {
    if (!d.done) { console.error(`hq ack: ${id} is not done yet — review it after the department reports.`); process.exitCode = 1; return null; }
    if (d.acked) { console.log(`${id} was already acked on ${d.acked}`); return null; }
    return { ...d, acked: todayIso() };
  });
  if (!res.dispatch) {
    console.error(`hq ack: no dispatch ${id} in ${res.file}`);
    process.exitCode = 1;
    return;
  }
  if (res.changed) console.log(`${id} reviewed and closed.`);
}
export function cmdDispatches(flags) {
  const found = discoverConfig();
  if (!found) {
    console.error('hq: no hq.config.json found. Run `hq.mjs init` first.');
    process.exitCode = 1;
    return;
  }
  let list = readDispatches(found.hqRoot);
  if (typeof flags.domain === 'string') {
    const d = safeSlug(flags.domain);
    list = list.filter((x) => x.to === d || x.from === d);
  }
  if (flags['awaiting-review']) list = list.filter((x) => x.done && !x.acked);
  else if (flags.all) { /* everything */ }
  else list = list.filter((x) => !x.done);   // --open is the default

  if (list.length === 0) { console.log('no dispatches match'); return; }
  for (const d of list) {
    const state = d.acked ? 'acked ' : d.done ? 'review' : 'open  ';
    const pri = d.priority ? ` !${d.priority}` : '';
    console.log(`${state} ${d.id}  ${d.date}  ${d.from} ${ARROW} ${d.to}${pri}  ${truncate(d.text, 60)}`);
    if (d.done && d.done.note) console.log(`         done ${d.done.date}: ${truncate(d.done.note, 70)}`);
  }
}

/* ---------------------------------------------- what a department is shown */

/** The "HQ asked you to" block that leads a department session's injection. */
export function dispatchBlock(hqRoot, domain) {
  const open = openDispatchesFor(hqRoot, domain);
  if (open.length === 0) return null;
  const lines = ['### HQ asked you to:', ''];
  for (const d of open) {
    lines.push(`- **${d.id}**${d.priority ? ` (${d.priority} priority)` : ''} · dispatched ${d.date} · ${d.text}`);
  }
  lines.push('', 'Do these first unless the user says otherwise. When one is finished, record the result:');
  lines.push('', '    hq.mjs done <id> --note "<one line: what happened>"', '');
  return lines.join('\n');
}
