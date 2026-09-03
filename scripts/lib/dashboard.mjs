// Every domain on one screen, in three renderings.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { isFile, expandHome, hoursSince, truncate, safeSlug } from './util.mjs';
import { discoverConfig, statusPath } from './config.mjs';
import { lastUpdatedAt, summariseDomain } from './status.mjs';
import { awaitingReview } from './dispatch.mjs';
import { LABELS_EN, resolveLabels, fmt } from './labels.mjs';
import { buildCss, builtinTemplate, fillTemplate, THEMES, THEME_NAMES,
         DENSITIES, DENSITY_NAMES, SECTION_NAMES, DEFAULT_SECTIONS } from './theme.mjs';

/** Tier 3: files a user drops in the HQ root to take over the look entirely. */
export const CSS_FILE = 'dashboard.css';
export const TEMPLATE_FILE = 'dashboard.template.html';

/* --------------------------------------------------------------- gathering */

export function relTime(hours, labels = LABELS_EN) {
  if (hours === null) return labels.never;
  if (hours < 1) return labels.justNow;
  if (hours < 48) return fmt(labels.hoursAgo, { n: Math.round(hours) });
  return fmt(labels.daysAgo, { n: Math.round(hours / 24) });
}
/** `YYYY-MM-DD HH:MM UTC` — what every renderer shows for "generated". */
export function formatGeneratedAt(date) {
  return `${date.toISOString().replace('T', ' ').slice(0, 16)} UTC`;
}
export function collectDashboard(config, hqRoot, staleAfterHours) {
  const rows = (config.domains || []).map((d) => summariseDomain(hqRoot, safeSlug(d), staleAfterHours));
  const inboxFile = path.join(hqRoot, config.inbox?.file || 'ideas-inbox.md');
  const decisionsFile = path.join(hqRoot, config.decisions?.file || 'decisions.md');
  const howMany = Number.isInteger(config.dashboard?.decisions) && config.dashboard.decisions >= 0
    ? config.dashboard.decisions
    : 3;
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
    decisions: lastEntries(decisionsFile, howMany),
  };
}
// A dated bullet: "- 2026-01-28 | ..." or "- **2026-01-28 | ...**", the date
// optionally followed by more text (a time, a tag) before the "|". Bold is
// common in hand-written entries and must not make a line invisible to this.
const DATED_LINE_RE = /^-\s+\*{0,2}(\d{4}-\d{2}-\d{2})/;

/** Count dated bullets, ignoring the explanatory header of the file. */
function countEntries(file) {
  if (!isFile(file)) return 0;
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((l) => DATED_LINE_RE.test(l))
    .length;
}
/**
 * The last `n` dated bullets, newest last (the file's own append-only
 * convention). A file that is genuinely append-only sorts by date the same
 * way it sorts by position, so this is "last n in file order"; sorting by
 * the leading date is what makes it correct even when it isn't — a line
 * edited in place, or moved — rather than just trusting file order blindly.
 */
function lastEntries(file, n) {
  if (!isFile(file) || n <= 0) return [];
  const candidates = [];
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, index) => {
    const m = line.match(DATED_LINE_RE);
    if (m) candidates.push({ line, index, date: m[1] });
  });
  const newestFirst = [...candidates].sort((a, b) =>
    b.date === a.date ? b.index - a.index : b.date.localeCompare(a.date));
  return newestFirst.slice(0, n)
    .sort((a, b) => a.index - b.index)
    .map((c) => c.line);
}

/* ------------------------------------------------------- look and language */

/**
 * One run's look, from config and flags. Flags win, for one run only; anything
 * unrecognised falls back to the default and says so on stderr rather than
 * failing — a typo in a theme name should never cost you the dashboard.
 */
export function resolveDashboardOptions(config = {}, flags = {}, hqRoot = null, { warn = defaultWarn } = {}) {
  const d = config.dashboard || {};

  const themeAsked = flags.theme !== undefined && flags.theme !== true ? String(flags.theme) : d.theme;
  let theme = 'auto';
  if (themeAsked === undefined || themeAsked === null || themeAsked === '') theme = 'auto';
  else if (THEMES[themeAsked]) theme = themeAsked;
  else warn(`unknown theme "${themeAsked}"; using auto (choose: ${THEME_NAMES.join(', ')})`);

  const densityAsked = flags.density !== undefined && flags.density !== true ? String(flags.density) : d.density;
  let density = 'comfortable';
  if (densityAsked === undefined || densityAsked === null || densityAsked === '') density = 'comfortable';
  else if (DENSITIES[densityAsked]) density = densityAsked;
  else warn(`unknown density "${densityAsked}"; using comfortable (choose: ${DENSITY_NAMES.join(', ')})`);

  const labelsAsked = flags.labels !== undefined && flags.labels !== true ? String(flags.labels) : d.labels;
  const labels = resolveLabels(labelsAsked, { language: config.language || 'en' });

  const sections = normaliseSections(d.sections, warn);
  const custom = hqRoot ? loadCustomisations(hqRoot) : { css: null, template: null };

  return {
    theme,
    density,
    labels,
    sections,
    accent: d.accent ?? null,
    font: d.font ?? null,
    title: typeof d.title === 'string' && d.title.trim() ? d.title.trim() : labels.title,
    showHqRoot: d.showHqRoot !== false,
    customCss: custom.css,
    template: custom.template,
  };
}
function defaultWarn(message) {
  console.error(`hq dashboard: ${message}`);
}
function normaliseSections(sections, warn = defaultWarn) {
  if (sections === undefined || sections === null) return [...DEFAULT_SECTIONS];
  if (!Array.isArray(sections)) {
    warn('dashboard.sections must be an array; using the default order');
    return [...DEFAULT_SECTIONS];
  }
  const seen = new Set();
  const out = [];
  for (const raw of sections) {
    const name = String(raw);
    if (!SECTION_NAMES.includes(name)) { warn(`unknown dashboard section "${name}" (known: ${SECTION_NAMES.join(', ')})`); continue; }
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}
/** Tier 3, read fresh on every render: whatever the user left in the HQ root. */
export function loadCustomisations(hqRoot) {
  const read = (name) => {
    const p = path.join(hqRoot, name);
    try { return isFile(p) ? fs.readFileSync(p, 'utf8') : null; } catch { return null; }
  };
  return { css: read(CSS_FILE), template: read(TEMPLATE_FILE) };
}
/** True when the decisions list sits directly under the inbox section. */
function foldsIntoInbox(sections) {
  const at = sections.indexOf('inbox');
  return at !== -1 && sections[at + 1] === 'decisions';
}
function ideas(labels, n) {
  return fmt(n === 1 ? labels.ideaWaiting : labels.ideasWaiting, { n });
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
export function renderTerminal(d, opts = {}) {
  const { labels: L, sections, title, showHqRoot } = withDefaults(opts);
  const up = (s) => String(s).toUpperCase();
  const count = d.rows.length === 1 ? fmt(L.domainCount, { n: 1 }) : fmt(L.domainsCount, { n: d.rows.length });

  const out = [];
  out.push(showHqRoot ? `${title} — ${d.hqRoot}` : title);
  out.push([count, fmt(L.staleAfter, { h: d.staleAfterHours }),
            fmt(L.generated, { when: formatGeneratedAt(d.generatedAt) })].join(' · '));

  const table = () => {
    const cells = d.rows.map((r) => [
      r.domain,
      r.exists ? `${relTime(r.ageHours, L)}${r.stale ? `  ⚠ ${L.staleTag}` : ''}` : L.noFile,
      String(r.workstreams),
      String(r.blocked.length),
      String(r.nextActions),
      String(r.openDispatches),
    ]);
    const head = [L.colDomain, L.colUpdated, L.colWork, L.colBlocked, L.colNext, L.colAsked].map(up);
    const widths = head.map((h, i) => Math.max(h.length, ...cells.map((c) => c[i].length)));
    // The three count columns read better right-aligned.
    const fit = (v, i) => (i >= 2 ? padLeft(v, widths[i]) : pad(v, widths[i]));
    const lines = [head.map(fit).join('  ').trimEnd(), widths.map((w) => '-'.repeat(w)).join('  ')];
    for (const c of cells) lines.push(c.map(fit).join('  ').trimEnd());
    return lines;
  };
  const listing = (heading, items, render) => {
    const lines = [heading];
    if (items.length === 0) lines.push(`  ${L.noneShort}`);
    for (const it of items) lines.push(...[].concat(render(it)));
    return lines;
  };

  const build = {
    domains: table,
    stale: () => listing(`${up(L.stale)} (> ${d.staleAfterHours}h)`, d.stale,
      (r) => `  ${pad(r.domain, 12)} ${relTime(r.ageHours, L)}`),
    blocked: () => listing(up(L.blocked), d.blocked,
      (b) => `  ${b.domain} · ${b.workstream} — ${truncate(b.on, 70)}`),
    review: () => listing(up(L.review), d.awaiting, (a) => {
      const lines = [`  ${a.id}  ${a.to} — ${truncate(a.text, 46)}`];
      if (a.done.note) lines.push(`          done ${a.done.date}: ${truncate(a.done.note, 62)}`);
      return lines;
    }),
    untouched: () => listing(up(L.untouched), d.untouched,
      (r) => `  ${r.domain} (${r.exists ? L.noWorkstreams : L.noStatusFile})`),
    inbox: () => [`${up(L.inbox)}  ${ideas(L, d.inboxCount)}`],
    decisions: () => {
      const lines = [up(L.decisions)];
      if (d.decisions.length === 0) lines.push(`  ${L.noneRecorded}`);
      for (const line of d.decisions) lines.push(`  ${truncate(line.replace(/^-\s*/, ''), 90)}`);
      return lines;
    },
  };

  const fold = foldsIntoInbox(sections);
  let previous = null;
  for (const name of sections) {
    if (!build[name]) continue;
    if (!(fold && previous === 'inbox' && name === 'decisions')) out.push('');
    out.push(...build[name]());
    previous = name;
  }
  return out.join('\n');
}

/* ---------------------------------------------------------------- markdown */

export function renderMarkdown(d, opts = {}) {
  const { labels: L, sections, title, showHqRoot } = withDefaults(opts);
  const meta = [
    ...(showHqRoot ? [`\`${d.hqRoot}\``] : []),
    fmt(L.domainsCount, { n: d.rows.length }),
    fmt(L.staleAfter, { h: d.staleAfterHours }),
    fmt(L.generated, { when: formatGeneratedAt(d.generatedAt) }),
  ].join(' · ');

  const out = [`# ${title}`, '', meta];
  const section = (heading, body) => (heading ? ['', `## ${heading}`, '', ...body] : ['', ...body]);
  const listing = (heading, items, render) =>
    section(heading, items.length === 0 ? [L.none] : items.map(render));

  const fold = foldsIntoInbox(sections);
  const build = {
    domains: () => section(L.domains, [
      `| ${L.colDomain} | ${L.colUpdated} | ${L.colWorkstreams} | ${L.colBlocked} | ${L.colNext} | ${L.colAsked} |`,
      '|---|---|---:|---:|---:|---:|',
      ...d.rows.map((r) => {
        const when = r.exists ? `${relTime(r.ageHours, L)}${r.stale ? ` **${L.staleTag}**` : ''}` : L.noFile;
        return `| ${r.domain} | ${when} | ${r.workstreams} | ${r.blocked.length} | ${r.nextActions} | ${r.openDispatches} |`;
      }),
    ]),
    stale: () => listing(`${L.stale} (> ${d.staleAfterHours}h)`, d.stale,
      (r) => `- **${r.domain}** — ${relTime(r.ageHours, L)}`),
    blocked: () => listing(L.blocked, d.blocked,
      (b) => `- **${b.domain}** · ${b.workstream} — ${truncate(b.on, 160)}`),
    review: () => listing(L.review, d.awaiting,
      (a) => `- \`${a.id}\` **${a.to}** — ${truncate(a.text, 90)}` +
        (a.done.note ? ` ↳ done ${a.done.date}: ${truncate(a.done.note, 110)}` : '')),
    untouched: () => listing(L.untouched, d.untouched,
      (r) => `- **${r.domain}** — ${r.exists ? L.noWorkstreams : L.noStatusFile}`),
    inbox: () => section(fold ? L.inboxAndDecisions : L.inbox, [`${ideas(L, d.inboxCount)}.`]),
    decisions: () => section(fold ? null : L.decisions,
      d.decisions.length === 0 ? [L.emptyDecisions] : d.decisions),
  };

  for (const name of sections) {
    if (build[name]) out.push(...build[name]());
  }
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
/** Fill in whatever the caller left out, so every renderer works with `(d)` alone. */
function withDefaults(opts) {
  const labels = opts.labels || LABELS_EN;
  return {
    labels,
    sections: Array.isArray(opts.sections) ? opts.sections : DEFAULT_SECTIONS,
    title: typeof opts.title === 'string' && opts.title ? opts.title : labels.title,
    showHqRoot: opts.showHqRoot !== false,
  };
}
/**
 * A single self-contained file: inline CSS, no script, no network.
 *
 * Layout is deliberate: the "what did I miss" lists (stale, blocked, awaiting
 * review, untouched) lead, because that is the question a reader actually has.
 * The domain table and the inbox/decisions counts follow, for people who want
 * the detail — and `dashboard.sections` reorders or hides any of them.
 *
 * Pass `watchSeconds` to have the page refresh itself, `template` to render
 * someone else's HTML file instead of the built-in one, and `customCss` to
 * append a stylesheet after the theme's own.
 */
export function renderHtml(d, opts = {}) {
  const { labels: L, sections, title, showHqRoot } = withDefaults(opts);
  const {
    watchSeconds = null, theme = 'auto', density = 'comfortable',
    accent = null, font = null, customCss = null, template = null,
  } = opts;

  const list = (items, empty) => (items.length === 0
    ? `<p class="empty">${empty}</p>`
    : `<ul>${items.join('')}</ul>`);
  const section = (name, heading, body) =>
    `<section class="sec sec-${name}">\n    ${heading ? `<h2>${heading}</h2>\n    ` : ''}${body}\n  </section>`;

  const fold = foldsIntoInbox(sections);
  const build = {
    stale: () => section('stale', `${esc(L.stale)} (${esc(overWord(L))} ${d.staleAfterHours}h)`,
      list(d.stale.map((r) => `<li><span class="dom">${esc(r.domain)}</span> &mdash; ${esc(relTime(r.ageHours, L))}</li>`), esc(L.emptyStale))),
    blocked: () => section('blocked', esc(L.blocked),
      list(d.blocked.map((b) => `<li><span class="dom">${esc(b.domain)}</span> &middot; ${esc(b.workstream)} &mdash; ${esc(truncate(b.on, 200))}</li>`), esc(L.emptyBlocked))),
    review: () => section('review', esc(L.review),
      list(d.awaiting.map((a) => `<li><code>${esc(a.id)}</code> <span class="dom">${esc(a.to)}</span> &mdash; ${esc(truncate(a.text, 120))}${a.done.note ? ` &rarr; ${esc(truncate(a.done.note, 140))}` : ''}</li>`), esc(L.emptyReview))),
    untouched: () => section('untouched', esc(L.untouched),
      list(d.untouched.map((r) => `<li><span class="dom">${esc(r.domain)}</span> &mdash; ${esc(r.exists ? L.noWorkstreams : L.noStatusFile)}</li>`), esc(L.emptyUntouched))),
    domains: () => section('domains', esc(L.domains), domainTable(d, L)),
    inbox: () => section('inbox', esc(fold ? L.inboxAndDecisions : L.inbox),
      `<p>${esc(ideas(L, d.inboxCount))}.</p>`),
    decisions: () => section('decisions', fold ? null : esc(L.decisions),
      list(d.decisions.map((l) => `<li>${esc(l.replace(/^-\s*/, ''))}</li>`), esc(L.emptyDecisions))),
  };

  const slots = {
    lang: esc(L.lang || 'en'),
    title: esc(title),
    meta: watchSeconds ? `<meta http-equiv="refresh" content="${watchSeconds}">` : '',
    css: [buildCss({ theme, accent, font, density }), customCss].filter(Boolean).join('\n\n'),
    header: `<h1>${esc(title)}</h1>\n  <p class="meta">${headerMeta(d, L, showHqRoot)}</p>`,
    footer: watchSeconds
      ? fmt(L.footerWatch, { s: watchSeconds, when: esc(formatGeneratedAt(d.generatedAt)) })
      : fmt(L.footerManual, { when: esc(formatGeneratedAt(d.generatedAt)) }),
  };
  for (const name of SECTION_NAMES) slots[name] = sections.includes(name) ? build[name]() : '';

  return fillTemplate(template || builtinTemplate(sections), slots);
}
/** English reads better as "over 48h" than as an escaped ">"; other sets say so themselves. */
function overWord(labels) {
  return (labels.lang || 'en') === 'en' ? 'over' : '>';
}
function headerMeta(d, L, showHqRoot) {
  return [
    ...(showHqRoot ? [esc(d.hqRoot)] : []),
    esc(fmt(L.domainsCount, { n: d.rows.length })),
    esc(fmt(L.staleAfter, { h: d.staleAfterHours })),
    esc(fmt(L.generated, { when: formatGeneratedAt(d.generatedAt) })),
  ].join(' &middot; ');
}
function domainTable(d, L) {
  const rows = d.rows.map((r) => {
    const when = r.exists
      ? `${esc(relTime(r.ageHours, L))}${r.stale ? ` <span class="tag">${esc(L.staleTag)}</span>` : ''}`
      : esc(L.noFile);
    return `<tr${r.stale ? ' class="stale"' : ''}><td>${esc(r.domain)}</td><td>${when}</td>` +
      `<td class="n">${r.workstreams}</td><td class="n">${r.blocked.length}</td><td class="n">${r.nextActions}</td><td class="n">${r.openDispatches}</td></tr>`;
  }).join('\n');
  return `<div class="table-wrap">
    <table>
      <thead><tr><th>${esc(L.colDomain)}</th><th>${esc(L.colUpdated)}</th><th class="n">${esc(L.colWork)}</th><th class="n">${esc(L.colBlocked)}</th><th class="n">${esc(L.colNext)}</th><th class="n">${esc(L.colAsked)}</th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>
    </div>`;
}

/* ------------------------------------------------------------------- open */

/** Best-effort, fire-and-forget open of a local file in the default browser. */
function openInDefaultBrowser(filePath) {
  try {
    let cmd, args;
    if (process.platform === 'win32') { cmd = 'cmd'; args = ['/c', 'start', '""', filePath]; }
    else if (process.platform === 'darwin') { cmd = 'open'; args = [filePath]; }
    else { cmd = 'xdg-open'; args = [filePath]; }
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => {}); // best-effort: the printed line already names the path
    child.unref();
  } catch {
    // Same: the caller always prints the path regardless of whether this worked.
  }
}
function oneLiner(outPath, watchSeconds) {
  return watchSeconds
    ? `dashboard: ${outPath} — refreshing every ${watchSeconds}s (Ctrl-C to stop)`
    : `dashboard: ${outPath} — run \`hq dashboard\` again, or \`--watch\`, to refresh`;
}

/**
 * The default view: one self-contained page, opened for you. `--watch [seconds]`
 * keeps regenerating it in place until `--watch-iterations` (test-only) is hit,
 * or Ctrl-C. Never blocks on the browser: it is spawned detached and unref'd.
 */
function runPageDashboard({ config, hqRoot, staleAfterHours, flags }) {
  const outPath = path.join(hqRoot, 'dashboard.html');
  const watching = flags.watch !== undefined;
  let watchSeconds = null;
  if (watching) {
    watchSeconds = flags.watch === true ? 30 : Number(flags.watch);
    if (!Number.isFinite(watchSeconds) || watchSeconds <= 0) {
      console.error('hq dashboard: --watch must be a positive number of seconds');
      process.exitCode = 1;
      return;
    }
  }

  // Once, loudly, so a mistyped theme is reported exactly one time per run.
  const first = resolveDashboardOptions(config, flags, hqRoot);
  const render = (opts) => {
    const data = collectDashboard(config, hqRoot, staleAfterHours);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, renderHtml(data, { ...opts, watchSeconds }), 'utf8');
  };

  render(first);
  if (!flags['no-open']) openInDefaultBrowser(outPath);
  console.log(oneLiner(outPath, watchSeconds));

  if (!watching) return;

  const maxIterations = flags['watch-iterations'] !== undefined ? Number(flags['watch-iterations']) : null;
  let count = 1; // the render() above is the first iteration
  if (maxIterations !== null && count >= maxIterations) return;

  return new Promise((resolve) => {
    const stop = () => { clearInterval(timer); process.off('SIGINT', stop); resolve(); };
    const timer = setInterval(() => {
      // Re-resolve quietly: editing dashboard.css or the template shows up next tick.
      render(resolveDashboardOptions(config, flags, hqRoot, { warn: () => {} }));
      count++;
      if (maxIterations !== null && count >= maxIterations) stop();
    }, watchSeconds * 1000);
    process.on('SIGINT', stop);
  });
}

/* ------------------------------------------------------------------ eject */

/**
 * Hand over the real thing: the template this run would have used, and the CSS
 * this run's theme produces. Never overwrites — an existing file is the user's
 * own work, and losing it to a stray `--eject` would be unforgivable.
 */
export function cmdEject(hqRoot, opts) {
  const files = [
    [TEMPLATE_FILE, builtinTemplate(opts.sections)],
    [CSS_FILE, `${buildCss(opts)}\n`],
  ];
  for (const [name, contents] of files) {
    const out = path.join(hqRoot, name);
    if (isFile(out)) {
      console.log(`  kept     ${name} (already exists; delete it to eject a fresh copy)`);
      continue;
    }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, contents, 'utf8');
    console.log(`  created  ${name}`);
  }
  console.log('');
  console.log(`Both are read from ${hqRoot} on the next \`hq dashboard\`. Delete either one to go back.`);
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

  if (flags.eject) return cmdEject(hqRoot, resolveDashboardOptions(config, flags, hqRoot));

  const opts = resolveDashboardOptions(config, flags, hqRoot);
  if (flags.terminal) {
    console.log(renderTerminal(collectDashboard(config, hqRoot, staleAfterHours), opts));
    return;
  }
  if (flags.md) {
    console.log(renderMarkdown(collectDashboard(config, hqRoot, staleAfterHours), opts));
    return;
  }
  if (typeof flags.html === 'string') {
    const out = path.resolve(expandHome(flags.html));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, renderHtml(collectDashboard(config, hqRoot, staleAfterHours), opts), 'utf8');
    console.log(`dashboard written to ${out}`);
    return;
  }

  // No view flag: the one page, opened for you. `--watch` keeps it live.
  return runPageDashboard({ config, hqRoot, staleAfterHours, flags });
}
