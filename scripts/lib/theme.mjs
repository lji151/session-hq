// Looks for the dashboard page: four presets, a few knobs, and the built-in template.
//
// A theme is *only* a set of CSS custom properties. The rule block underneath
// them names no colour, font, size or spacing of its own — every value comes
// through `var(...)` — so a new preset is a new variable map and nothing else,
// and a user's own `dashboard.css` can override any one of them.

/* ------------------------------------------------------------------ themes */

const MONO = 'ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace';
const SANS = 'ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';
const SERIF = '"Iowan Old Style","Palatino Linotype",Palatino,Georgia,Cambria,"Times New Roman",serif';

export const FONT_ALIASES = { mono: MONO, sans: SANS, serif: SERIF };

/**
 * Each preset is `{ scheme, vars, dark? }`. `dark` is a partial override applied
 * under `prefers-color-scheme: dark`; a preset that commits to one look omits it.
 */
export const THEMES = {
  // The 0.2.0 look, unchanged: warm off-white, monospace, follows the OS.
  auto: {
    scheme: 'light dark',
    vars: {
      bg: '#fbfbf9', surface: '#ffffff', fg: '#1a1a1a', mut: '#666666', line: '#dcdcd6',
      accent: '#8a4b00',
      stale: '#8a4b00', 'stale-bg': '#fdf0dd',
      blocked: '#9b2c2c', 'blocked-bg': '#fbe9e9',
      review: '#1f5f8b', 'review-bg': '#e6f0f7',
      untouched: '#5b5b55', 'untouched-bg': '#eeeee8',
      font: MONO, 'font-head': MONO, size: '14px', radius: '3px',
    },
    dark: {
      bg: '#16171a', surface: '#1d1e22', fg: '#e8e8e4', mut: '#9a9a95', line: '#33343a',
      accent: '#f0b775',
      stale: '#f0b775', 'stale-bg': '#3a2a12',
      blocked: '#f0a3a3', 'blocked-bg': '#3a1a1a',
      review: '#9ecbe8', 'review-bg': '#12263a',
      untouched: '#a8a8a2', 'untouched-bg': '#26272b',
    },
  },
  // Warm light, serif headings. Reads like a printed page; ignores the OS.
  paper: {
    scheme: 'light',
    vars: {
      bg: '#f7f3ea', surface: '#fffdf7', fg: '#2b2622', mut: '#7a6f62', line: '#e0d6c4',
      accent: '#8a5a2b',
      stale: '#a05a00', 'stale-bg': '#f6e6cd',
      blocked: '#92353a', 'blocked-bg': '#f6e0e0',
      review: '#3a5f7d', 'review-bg': '#e2ecf3',
      untouched: '#6e6559', 'untouched-bg': '#ece5d8',
      font: SANS, 'font-head': SERIF, size: '15px', radius: '4px',
    },
  },
  // Dark, monospace, green and amber. A console that happens to be a page.
  terminal: {
    scheme: 'dark',
    vars: {
      bg: '#0b0f0b', surface: '#101610', fg: '#c8f0c0', mut: '#6f8f6a', line: '#1e2c1c',
      accent: '#58d15a',
      stale: '#f0b429', 'stale-bg': '#2a2210',
      blocked: '#ff6b6b', 'blocked-bg': '#2a1414',
      review: '#58d15a', 'review-bg': '#122a12',
      untouched: '#7a8f78', 'untouched-bg': '#1a221a',
      font: MONO, 'font-head': MONO, size: '13.5px', radius: '2px',
    },
  },
  // Cool dark, sans. The one that looks least like a terminal.
  slate: {
    scheme: 'dark',
    vars: {
      bg: '#171a21', surface: '#1e222b', fg: '#e6e9ef', mut: '#98a0b3', line: '#2c313c',
      accent: '#6ea8fe',
      stale: '#ffd479', 'stale-bg': '#3a3016',
      blocked: '#ff8a8a', 'blocked-bg': '#3a1f1f',
      review: '#6ea8fe', 'review-bg': '#16283f',
      untouched: '#98a0b3', 'untouched-bg': '#242935',
      font: SANS, 'font-head': SANS, size: '14px', radius: '6px',
    },
  },
};
export const THEME_NAMES = Object.keys(THEMES);

export const DENSITIES = {
  comfortable: { 'pad-y': '2rem', 'pad-x': '1.25rem', 'row-y': '.45rem', 'li-y': '.3rem', lh: '1.55', gap: '2rem' },
  compact: { 'pad-y': '1.1rem', 'pad-x': '.9rem', 'row-y': '.22rem', 'li-y': '.14rem', lh: '1.35', gap: '1.15rem' },
};
export const DENSITY_NAMES = Object.keys(DENSITIES);

/* ------------------------------------------------------------- sanitising */

/** A colour we are willing to paste into a stylesheet: `#rgb` … `#rrggbbaa`. */
export function normaliseAccent(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) ? v : null;
}
/** `mono` | `sans` | `serif`, or any CSS font stack with declaration syntax removed. */
export function normaliseFont(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v) return null;
  if (FONT_ALIASES[v]) return FONT_ALIASES[v];
  const cleaned = v.replace(/[;{}<>@]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return cleaned || null;
}

/* --------------------------------------------------------------------- css */

/**
 * The variables, then the rules. Nothing below `:root` names a literal colour,
 * font, size or spacing — which is what makes a theme "only variables".
 */
const RULES = `
* { box-sizing: border-box; }
body { margin:0; padding:var(--pad-y) var(--pad-x); background:var(--bg); color:var(--fg);
       font:var(--size)/var(--lh) var(--font); }
main { max-width:60rem; margin:0 auto; }
h1 { font-family:var(--font-head); font-size:1.35em; font-weight:700; margin:0 0 .25rem;
     letter-spacing:.01em; color:var(--fg); }
h2 { font-family:var(--font-head); font-size:.8em; text-transform:uppercase; letter-spacing:.08em;
     color:var(--mut); margin:var(--gap) 0 .5rem; border-bottom:1px solid var(--line);
     padding-bottom:.35rem; font-weight:700; }
h2::before { content:""; display:inline-block; width:.5em; height:.5em; border-radius:var(--radius);
             background:var(--accent); margin-right:.55em; vertical-align:baseline; }
.sec-stale h2::before { background:var(--stale); }
.sec-blocked h2::before { background:var(--blocked); }
.sec-review h2::before { background:var(--review); }
.sec-untouched h2::before { background:var(--untouched); }
.meta { color:var(--mut); margin:0 0 1.5rem; font-size:.85em; overflow-wrap:anywhere; }
.table-wrap { max-width:100%; overflow-x:auto; background:var(--surface);
              border:1px solid var(--line); border-radius:var(--radius); padding:0 .75rem; }
table { border-collapse:collapse; width:100%; }
th { text-align:left; font-size:.72em; text-transform:uppercase; letter-spacing:.08em;
     color:var(--mut); border-bottom:1px solid var(--line); padding:var(--row-y) .6rem; font-weight:700; }
td { padding:var(--row-y) .6rem; border-bottom:1px solid var(--line); }
tr:last-child td { border-bottom:0; }
td.n, th.n { text-align:right; }
tr.stale td:first-child { font-weight:700; color:var(--stale); }
.tag { background:var(--stale-bg); color:var(--stale); padding:.05rem .4rem;
       border-radius:var(--radius); font-size:.7em; letter-spacing:.06em; }
ul { margin:.25rem 0; padding-left:1.1rem; }
li { margin:var(--li-y) 0; overflow-wrap:anywhere; }
.sec-blocked li::marker { color:var(--blocked); }
.sec-review li::marker { color:var(--review); }
.sec-untouched li::marker { color:var(--untouched); }
.sec-stale li::marker { color:var(--stale); }
.dom { font-weight:700; color:var(--accent); }
.empty { color:var(--mut); margin:.25rem 0; }
code { background:var(--surface); border:1px solid var(--line); border-radius:var(--radius);
       padding:0 .25em; font-family:var(--font); font-size:.92em; }
footer { margin-top:var(--gap); color:var(--mut); font-size:.78em; }
@media (max-width: 480px) {
  body { padding:var(--pad-x) calc(var(--pad-x) * .7); }
  h2 { margin-top:calc(var(--gap) * .75); }
}
`.trim();

function block(selectorLine, vars, indent = '  ') {
  const body = Object.entries(vars).map(([k, v]) => `${indent}--${k}: ${v};`).join('\n');
  return `${selectorLine}\n${body}\n}`;
}

/**
 * The stylesheet for one look. `accent`, `font` and `density` are the Tier-2
 * knobs; each is applied on top of the preset's own variables, so a knob is
 * never a fork of a theme.
 */
export function buildCss({ theme = 'auto', accent = null, font = null, density = 'comfortable' } = {}) {
  const name = THEMES[theme] ? theme : 'auto';
  const preset = THEMES[name];
  const densityName = DENSITIES[density] ? density : 'comfortable';

  const vars = { density: densityName, ...DENSITIES[densityName], ...preset.vars };
  const cleanAccent = normaliseAccent(accent);
  const cleanFont = normaliseFont(font);
  if (cleanAccent) vars.accent = cleanAccent;
  if (cleanFont) { vars.font = cleanFont; vars['font-head'] = cleanFont; }

  const out = [`/* session-hq dashboard — theme: ${name} · density: ${densityName} */`];
  out.push(block(`:root {\n  color-scheme: ${preset.scheme};`, vars));
  if (preset.dark) {
    const dark = { ...preset.dark };
    if (cleanAccent) dark.accent = cleanAccent;
    out.push(`@media (prefers-color-scheme: dark) {\n${block('  :root {', dark, '    ')}\n}`);
  }
  out.push(RULES);
  return out.join('\n');
}

/* ---------------------------------------------------------------- template */

export const SECTION_NAMES = ['stale', 'blocked', 'review', 'untouched', 'domains', 'inbox', 'decisions'];
export const DEFAULT_SECTIONS = [...SECTION_NAMES];

/** Slots a template may use. Anything else in `{{…}}` renders as nothing. */
export const TEMPLATE_SLOTS = [
  'lang', 'title', 'meta', 'css', 'header',
  ...SECTION_NAMES,
  'footer',
];

/**
 * The built-in page, as a template. Sections appear in the configured order, so
 * `--eject` hands back the file the tool would actually have rendered.
 */
export function builtinTemplate(sections = DEFAULT_SECTIONS) {
  const slots = sections.filter((s) => SECTION_NAMES.includes(s)).map((s) => `  {{${s}}}`).join('\n');
  return `<!doctype html>
<html lang="{{lang}}">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
{{meta}}
<title>{{title}}</title>
<style>
{{css}}
</style>
<main>
  {{header}}
${slots}
  <footer>{{footer}}</footer>
</main>
</html>
`;
}

const SLOT_RE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_-]*)\s*\}\}/g;

/**
 * Fill `{{slot}}` placeholders in one pass — inserted content is never rescanned,
 * so a status line containing braces cannot expand into anything.
 *
 * `--watch` needs its meta tag on the page. A template with `{{meta}}` decides
 * where it goes; a template without one still gets it, injected into the head.
 */
export function fillTemplate(template, slots) {
  const text = String(template);
  const hasMetaSlot = /\{\{\s*meta\s*\}\}/.test(text);
  SLOT_RE.lastIndex = 0;
  let out = text.replace(SLOT_RE, (_, name) => {
    const v = slots[name];
    return v === undefined || v === null ? '' : String(v);
  });
  if (slots.meta && !hasMetaSlot) out = injectHead(out, slots.meta);
  return out;
}
function injectHead(html, tag) {
  const after = (re) => {
    const m = html.match(re);
    if (!m) return null;
    const at = m.index + m[0].length;
    return `${html.slice(0, at)}\n${tag}${html.slice(at)}`;
  };
  return after(/<head[^>]*>/i) || after(/<html[^>]*>/i) || after(/<!doctype[^>]*>/i) || `${tag}\n${html}`;
}
