// Every domain on one screen, in three renderings.
import fs from 'node:fs';
import path from 'node:path';
import { isFile, expandHome, hoursSince, truncate, safeSlug } from './util.mjs';
import { discoverConfig, statusPath } from './config.mjs';
import { lastUpdatedAt, summariseDomain } from './status.mjs';
import { awaitingReview } from './dispatch.mjs';

/* --------------------------------------------------------------- gathering */

export function relTime(hours) {
  if (hours === null) return 'never';
  if (hours < 1) return 'just now';
  if (hours < 48) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
export function collectDashboard(config, hqRoot, staleAfterHours) {
  const rows = (config.domains || []).map((d) => summariseDomain(hqRoot, safeSlug(d), staleAfterHours));
  const inboxFile = path.join(hqRoot, config.inbox?.file || 'ideas-inbox.md');
  const decisionsFile = path.join(hqRoot, config.decisions?.file || 'decisions.md');
  return {
    hqRoot,
    staleAfterHours,
    generatedAt: new Date(),
    rows,
    stale: rows.filter((r) => r.stale).sort((a, b) => b.ageHours - a.ageHours),
    blocked: rows.flatMap((r) => r.blocked.map((b) => ({ domain: r.domain, ...b }))),
    untouched: rows.filter((r) => r.untouched),
    awaiting: awaitingReview(hqRoot),
    inboxCount: countEntries(inboxFile),
    decisions: lastEntries(decisionsFile, 3),
  };
}
/** Count `- ` list entries, ignoring the explanatory header of the file. */
function countEntries(file) {
  if (!isFile(file)) return 0;
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^-\s+\d{4}-\d{2}-\d{2}\s*\|/.test(l))
    .length;
}
function lastEntries(file, n) {
  if (!isFile(file)) return [];
  const lines = fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^-\s+\d{4}-\d{2}-\d{2}\s*\|/.test(l));
  return lines.slice(-n);
}

/* ---------------------------------------------------------------- terminal */

function pad(s, width) {
  const t = String(s);
  return t.length >= width ? t : t + ' '.repeat(width - t.length);
}
function padLeft(s, width) {
  const t = String(s);
  return t.length >= width ? t : ' '.repeat(width - t.length) + t;
}
export function renderTerminal(d) {
  const out = [];
  out.push(`session-hq dashboard — ${d.hqRoot}`);
  out.push(`${d.rows.length} domain${d.rows.length === 1 ? '' : 's'} · stale after ${d.staleAfterHours}h · generated ${d.generatedAt.toISOString().replace('T', ' ').slice(0, 16)} UTC`);
  out.push('');

  const cells = d.rows.map((r) => [
    r.domain,
    r.exists ? `${relTime(r.ageHours)}${r.stale ? '  ⚠ STALE' : ''}` : 'no file',
    String(r.workstreams),
    String(r.blocked.length),
    String(r.nextActions),
    String(r.openDispatches),
  ]);
  const head = ['DOMAIN', 'LAST UPDATED', 'WORK', 'BLOCKED', 'NEXT', 'ASKED'];
  const widths = head.map((h, i) => Math.max(h.length, ...cells.map((c) => c[i].length)));

  // The three count columns read better right-aligned.
  const fit = (v, i) => (i >= 2 ? padLeft(v, widths[i]) : pad(v, widths[i]));
  out.push(head.map(fit).join('  ').trimEnd());
  out.push(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const c of cells) out.push(c.map(fit).join('  ').trimEnd());
  out.push('');

  out.push(`STALE (> ${d.staleAfterHours}h)`);
  if (d.stale.length === 0) out.push('  none');
  for (const r of d.stale) out.push(`  ${pad(r.domain, 12)} ${relTime(r.ageHours)}`);
  out.push('');

  out.push('BLOCKED');
  if (d.blocked.length === 0) out.push('  none');
  for (const b of d.blocked) out.push(`  ${b.domain} · ${b.workstream} — ${truncate(b.on, 70)}`);
  out.push('');

  out.push('AWAITING REVIEW');
  if (d.awaiting.length === 0) out.push('  none');
  for (const a of d.awaiting) {
    out.push(`  ${a.id}  ${a.to} — ${truncate(a.text, 46)}`);
    if (a.done.note) out.push(`          done ${a.done.date}: ${truncate(a.done.note, 62)}`);
  }
  out.push('');

  out.push('UNTOUCHED');
  if (d.untouched.length === 0) out.push('  none');
  for (const r of d.untouched) out.push(`  ${r.domain}${r.exists ? ' (no workstreams yet)' : ' (no status file)'}`);
  out.push('');

  out.push(`INBOX  ${d.inboxCount} idea${d.inboxCount === 1 ? '' : 's'} waiting`);
  out.push('LATEST DECISIONS');
  if (d.decisions.length === 0) out.push('  none recorded');
  for (const line of d.decisions) out.push(`  ${truncate(line.replace(/^-\s*/, ''), 90)}`);

  return out.join('\n');
}

/* ---------------------------------------------------------------- markdown */

export function renderMarkdown(d) {
  const out = [];
  out.push('# session-hq dashboard');
  out.push('');
  out.push(`\`${d.hqRoot}\` · ${d.rows.length} domains · stale after ${d.staleAfterHours}h · generated ${d.generatedAt.toISOString()}`);
  out.push('');
  out.push('| Domain | Last updated | Workstreams | Blocked | Next | Asked |');
  out.push('|---|---|---:|---:|---:|---:|');
  for (const r of d.rows) {
    const when = r.exists ? `${relTime(r.ageHours)}${r.stale ? ' **STALE**' : ''}` : 'no file';
    out.push(`| ${r.domain} | ${when} | ${r.workstreams} | ${r.blocked.length} | ${r.nextActions} | ${r.openDispatches} |`);
  }
  out.push('');
  out.push(`## Stale (> ${d.staleAfterHours}h)`);
  out.push('');
  if (d.stale.length === 0) out.push('None.');
  for (const r of d.stale) out.push(`- **${r.domain}** — ${relTime(r.ageHours)}`);
  out.push('');
  out.push('## Blocked');
  out.push('');
  if (d.blocked.length === 0) out.push('None.');
  for (const b of d.blocked) out.push(`- **${b.domain}** · ${b.workstream} — ${truncate(b.on, 160)}`);
  out.push('');
  out.push('## Awaiting review');
  out.push('');
  if (d.awaiting.length === 0) out.push('None.');
  for (const a of d.awaiting) out.push(`- \`${a.id}\` **${a.to}** — ${truncate(a.text, 90)}` + (a.done.note ? ` ↳ done ${a.done.date}: ${truncate(a.done.note, 110)}` : ''));
  out.push('');
  out.push('## Untouched');
  out.push('');
  if (d.untouched.length === 0) out.push('None.');
  for (const r of d.untouched) out.push(`- **${r.domain}** — ${r.exists ? 'no workstreams yet' : 'no status file'}`);
  out.push('');
  out.push(`## Inbox and decisions`);
  out.push('');
  out.push(`${d.inboxCount} idea${d.inboxCount === 1 ? '' : 's'} waiting.`);
  out.push('');
  if (d.decisions.length === 0) out.push('No decisions recorded.');
  for (const line of d.decisions) out.push(line);
  return out.join('\n') + '\n';
}

/* -------------------------------------------------------------------- html */

function esc(s) {
  return String(s)
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;');
}
/** A single self-contained file: inline CSS, no script, no network. */
export function renderHtml(d) {
  const rows = d.rows.map((r) => {
    const when = r.exists ? `${relTime(r.ageHours)}${r.stale ? ' <span class="tag">STALE</span>' : ''}` : 'no file';
    return `<tr${r.stale ? ' class="stale"' : ''}><td>${esc(r.domain)}</td><td>${when}</td>` +
      `<td class="n">${r.workstreams}</td><td class="n">${r.blocked.length}</td><td class="n">${r.nextActions}</td><td class="n">${r.openDispatches}</td></tr>`;
  }).join('\n');

  const list = (items, empty) => (items.length === 0
    ? `<p class="empty">${empty}</p>`
    : `<ul>${items.join('')}</ul>`);

  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>session-hq dashboard</title>
<style>
  :root { color-scheme: light dark; --fg:#1a1a1a; --bg:#fbfbf9; --mut:#666; --line:#dcdcd6; --warn:#8a4b00; --warnbg:#fdf0dd; }
  @media (prefers-color-scheme: dark) {
    :root { --fg:#e8e8e4; --bg:#16171a; --mut:#9a9a95; --line:#33343a; --warn:#f0b775; --warnbg:#3a2a12; }
  }
  * { box-sizing: border-box; }
  body { margin:0; padding:2rem 1.25rem; background:var(--bg); color:var(--fg);
         font:14px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
  main { max-width: 60rem; margin: 0 auto; }
  h1 { font-size:1.1rem; margin:0 0 .25rem; letter-spacing:.01em; }
  h2 { font-size:.8rem; text-transform:uppercase; letter-spacing:.08em; color:var(--mut);
       margin:2rem 0 .5rem; border-bottom:1px solid var(--line); padding-bottom:.35rem; }
  .meta { color:var(--mut); margin:0 0 1.5rem; font-size:.85rem; }
  table { border-collapse:collapse; width:100%; }
  th { text-align:left; font-size:.72rem; text-transform:uppercase; letter-spacing:.08em;
       color:var(--mut); border-bottom:1px solid var(--line); padding:.4rem .6rem .4rem 0; font-weight:600; }
  td { padding:.45rem .6rem .45rem 0; border-bottom:1px solid var(--line); }
  td.n, th.n { text-align:right; padding-right:1.2rem; }
  tr.stale td:first-child { font-weight:700; }
  .tag { background:var(--warnbg); color:var(--warn); padding:.05rem .4rem; border-radius:3px;
         font-size:.7rem; letter-spacing:.06em; }
  ul { margin:.25rem 0; padding-left:1.1rem; }
  li { margin:.3rem 0; }
  .dom { font-weight:700; }
  .empty { color:var(--mut); margin:.25rem 0; }
  footer { margin-top:2.5rem; color:var(--mut); font-size:.78rem; }
</style>
<main>
  <h1>session-hq dashboard</h1>
  <p class="meta">${esc(d.hqRoot)} &middot; ${d.rows.length} domains &middot; stale after ${d.staleAfterHours}h &middot; generated ${esc(d.generatedAt.toISOString())}</p>

  <table>
    <thead><tr><th>Domain</th><th>Last updated</th><th class="n">Work</th><th class="n">Blocked</th><th class="n">Next</th><th class="n">Asked</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>

  <h2>Stale (over ${d.staleAfterHours}h)</h2>
  ${list(d.stale.map((r) => `<li><span class="dom">${esc(r.domain)}</span> &mdash; ${esc(relTime(r.ageHours))}</li>`), 'Nothing stale.')}

  <h2>Blocked</h2>
  ${list(d.blocked.map((b) => `<li><span class="dom">${esc(b.domain)}</span> &middot; ${esc(b.workstream)} &mdash; ${esc(truncate(b.on, 200))}</li>`), 'Nothing blocked.')}

  <h2>Awaiting review</h2>
  ${list(d.awaiting.map((a) => `<li><code>${esc(a.id)}</code> <span class="dom">${esc(a.to)}</span> &mdash; ${esc(truncate(a.text, 120))}${a.done.note ? ` &rarr; ${esc(truncate(a.done.note, 140))}` : ''}</li>`), 'Nothing waiting on review.')}

  <h2>Untouched</h2>
  ${list(d.untouched.map((r) => `<li><span class="dom">${esc(r.domain)}</span> &mdash; ${r.exists ? 'no workstreams yet' : 'no status file'}</li>`), 'Every domain has work recorded.')}

  <h2>Inbox and decisions</h2>
  <p>${d.inboxCount} idea${d.inboxCount === 1 ? '' : 's'} waiting.</p>
  ${list(d.decisions.map((l) => `<li>${esc(l.replace(/^-\s*/, ''))}</li>`), 'No decisions recorded.')}

  <footer>Static snapshot. Regenerate with <code>hq.mjs dashboard --html &lt;file&gt;</code>.</footer>
</main>
</html>
`;
}

/* ----------------------------------------------------------------- command */

export function cmdDashboard(flags) {
  const found = discoverConfig();
  if (!found) {
    console.error('hq: no hq.config.json found. Run `hq.mjs init` first.');
    process.exitCode = 1;
    return;
  }
  const { config, hqRoot } = found;
  const staleAfterHours = flags['stale-hours'] !== undefined
    ? Number(flags['stale-hours'])
    : config.inject.staleAfterHours;
  if (!Number.isFinite(staleAfterHours) || staleAfterHours < 0) {
    console.error('hq dashboard: --stale-hours must be a non-negative number');
    process.exitCode = 1;
    return;
  }

  const data = collectDashboard(config, hqRoot, staleAfterHours);

  if (typeof flags.html === 'string') {
    const out = path.resolve(expandHome(flags.html));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, renderHtml(data), 'utf8');
    console.log(`dashboard written to ${out}`);
    return;
  }
  console.log(flags.md ? renderMarkdown(data) : renderTerminal(data));
}
