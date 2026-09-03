// "Make the dashboard yours": the presets, the knobs and the labels.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { THEMES, THEME_NAMES } from '../scripts/hq.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', 'scripts', 'hq.mjs');

let ROOT;

function hq(args) {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    input: '', encoding: 'utf8', cwd: ROOT, timeout: 15000,
    env: { ...process.env, HQ_ROOT: ROOT, HQ_DOMAIN: '' },
  });
  if (res.error) throw res.error;
  return { stdout: res.stdout ?? '', stderr: res.stderr ?? '', code: res.status };
}
/** Rewrite the `dashboard` block; `null` removes it entirely. */
function setDashboard(block) {
  const p = path.join(ROOT, 'hq.config.json');
  const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (block === null) delete cfg.dashboard;
  else cfg.dashboard = block;
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2), 'utf8');
}
function setLanguage(lang) {
  const p = path.join(ROOT, 'hq.config.json');
  const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
  cfg.language = lang;
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2), 'utf8');
}
/** Render to a throwaway file and hand back its contents. */
function page(extraArgs = []) {
  const out = path.join(ROOT, `page-${Math.random().toString(36).slice(2)}.html`);
  const { code, stderr } = hq(['dashboard', '--no-open', '--html', out, ...extraArgs]);
  assert.equal(code, 0, stderr);
  const html = fs.readFileSync(out, 'utf8');
  fs.rmSync(out, { force: true });
  return html;
}
before(() => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'session-hq-theme-'));
  hq(['init', '--root', ROOT, '--domains', 'video,apps,business', '--yes']);
  fs.appendFileSync(path.join(ROOT, 'ideas-inbox.md'),
    '- 2026-02-01 | a monthly recap | video\n');
  fs.appendFileSync(path.join(ROOT, 'decisions.md'),
    '- 2026-02-02 | cold opens replace framing intros | video\n');
});
after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

describe('tier 1: one word picks a look', () => {
  test('every preset renders, and carries its own variables', () => {
    assert.deepEqual(THEME_NAMES, ['auto', 'paper', 'terminal', 'slate']);
    for (const name of THEME_NAMES) {
      const html = page(['--theme', name]);
      assert.match(html, new RegExp(`theme: ${name}\\b`), `${name}: the stylesheet says which theme it is`);
      for (const key of ['bg', 'fg', 'accent', 'line', 'stale', 'blocked', 'review', 'untouched', 'font', 'size', 'radius']) {
        assert.ok(html.includes(`--${key}: ${THEMES[name].vars[key]};`),
          `${name}: --${key} must be the preset's own value`);
      }
      assert.ok(!/<script/i.test(html), `${name}: still no scripts`);
      assert.ok(!/https?:\/\//i.test(html), `${name}: still no network references`);
    }
  });

  test('a theme is only variables: dark is a variable swap, not a second stylesheet', () => {
    const auto = page(['--theme', 'auto']);
    assert.match(auto, /@media \(prefers-color-scheme: dark\)/, 'auto follows the OS');
    assert.ok(auto.includes(`--bg: ${THEMES.auto.dark.bg};`), 'the dark block redefines the same names');
    assert.ok(!/@media \(prefers-color-scheme: dark\)/.test(page(['--theme', 'paper'])),
      'a preset that commits to one look ships no dark block');
  });

  test('--theme overrides the configured theme for one run', () => {
    setDashboard({ theme: 'paper' });
    assert.match(page(), /theme: paper/, 'the config decides by default');
    assert.match(page(['--theme', 'slate']), /theme: slate/, 'the flag wins');
    assert.match(page(), /theme: paper/, 'and only for that one run');
    setDashboard(null);
  });

  test('an unknown theme warns and still gives you a page', () => {
    const out = path.join(ROOT, 'unknown.html');
    const { code, stderr } = hq(['dashboard', '--no-open', '--theme', 'papper', '--html', out]);
    assert.equal(code, 0, 'a typo must never cost you the dashboard');
    assert.match(stderr, /unknown theme "papper"/);
    assert.match(stderr, /auto, paper, terminal, slate/);
    assert.match(fs.readFileSync(out, 'utf8'), /theme: auto/);
    fs.rmSync(out, { force: true });
  });
});

describe('tier 2: knobs, no CSS needed', () => {
  after(() => setDashboard(null));

  test('accent, font and density all land in the stylesheet', () => {
    setDashboard({ theme: 'slate', accent: '#ff0066', font: 'serif', density: 'compact' });
    const html = page();
    assert.ok(html.includes('--accent: #ff0066;'), 'the accent overrides the theme');
    assert.ok(!html.includes(`--accent: ${THEMES.slate.vars.accent};`), 'and replaces it, rather than sitting beside it');
    assert.match(html, /--font: "Iowan Old Style"/, 'the "serif" alias expands to a stack');
    assert.match(html, /--font-head: "Iowan Old Style"/, 'headings follow the font knob too');
    assert.ok(html.includes('--density: compact;'), 'density is a variable like everything else');
    assert.match(html, /--lh: 1\.35;/, 'and it actually changes the metrics');
  });

  test('an arbitrary font stack is accepted, with declaration syntax stripped', () => {
    setDashboard({ font: 'Comic Sans MS, cursive' });
    const html = page();
    assert.match(html, /--font: Comic Sans MS, cursive;/);
    setDashboard({ font: 'Trebuchet MS; } body { display:none } .x {' });
    assert.ok(!/body \{ display:none \}/.test(page()), 'a font stack cannot open a new rule');
  });

  test('a nonsense accent is ignored rather than pasted into the stylesheet', () => {
    setDashboard({ theme: 'slate', accent: 'red; } body { display:none' });
    const html = page();
    assert.ok(html.includes(`--accent: ${THEMES.slate.vars.accent};`), 'the theme keeps its own accent');
    assert.ok(!/display:none/.test(html));
  });

  test('--density overrides the config for one run', () => {
    setDashboard({ density: 'compact' });
    assert.ok(page().includes('--density: compact;'));
    assert.ok(page(['--density', 'comfortable']).includes('--density: comfortable;'));
  });

  test('title, showHqRoot and decisions change what the page says', () => {
    setDashboard({ title: 'Studio HQ', showHqRoot: false, decisions: 0 });
    const html = page();
    assert.match(html, /<title>Studio HQ<\/title>/);
    assert.match(html, /<h1>Studio HQ<\/h1>/);
    assert.ok(!html.includes(ROOT.replace(/\\/g, '\\')), 'showHqRoot:false keeps the path off the page');
    assert.match(html, /No decisions recorded\./, 'decisions:0 shows none, rather than three');
  });

  test('sections order and omission are respected on the page', () => {
    setDashboard({ sections: ['decisions', 'domains', 'stale'] });
    const html = page();
    const at = (re) => { const i = html.search(re); assert.ok(i !== -1, `${re} not found`); return i; };
    assert.ok(at(/<h2>Latest decisions/) < at(/<h2>Domains/), 'decisions first');
    assert.ok(at(/<h2>Domains/) < at(/<h2>Stale/), 'then the table, then stale');
    for (const gone of [/<h2>Blocked/, /<h2>Awaiting review/, /<h2>Untouched/, /<h2>Inbox/]) {
      assert.ok(!gone.test(html), `${gone} was omitted from sections and must not render`);
    }
  });

  test('the same order and omission apply to --md and --terminal', () => {
    setDashboard({ sections: ['decisions', 'domains', 'stale'] });

    const md = hq(['dashboard', '--no-open', '--md']).stdout;
    assert.ok(md.indexOf('## Latest decisions') < md.indexOf('## Domains'));
    assert.ok(md.indexOf('## Domains') < md.indexOf('## Stale'));
    assert.ok(!/^## Blocked$/m.test(md));
    assert.ok(!/^## Untouched$/m.test(md));

    const t = hq(['dashboard', '--no-open', '--terminal']).stdout;
    assert.ok(t.indexOf('LATEST DECISIONS') < t.indexOf('DOMAIN '));
    assert.ok(t.indexOf('DOMAIN ') < t.indexOf('STALE ('));
    assert.ok(!/^BLOCKED$/m.test(t), 'the blocked list is gone (the table column is not it)');
    assert.ok(!/^UNTOUCHED$/m.test(t));
  });
});

describe('tier 2: labels', () => {
  const ENGLISH_HEADINGS = /<h2>(Stale|Blocked|Awaiting review|Untouched|Domains|Inbox|Latest decisions)/;
  after(() => { setDashboard(null); setLanguage('en'); });

  test('labels: "ko" translates every heading, and leaves no English one behind', () => {
    setDashboard({ labels: 'ko' });
    const html = page();
    for (const ko of ['오래됨', '막힘', '검토 대기', '손대지 않음', '도메인', '인박스와 결정']) {
      assert.ok(html.includes(`<h2>${ko}`), `missing Korean heading: ${ko}`);
    }
    assert.ok(!ENGLISH_HEADINGS.test(html), 'no English heading may survive');
    assert.match(html, /<html lang="ko">/);
    assert.match(html, /<title>session-hq 대시보드<\/title>/);
    assert.match(html, /아이디어 1개 대기 중/, 'the empty/count sentences are translated too');
    assert.match(html, /생성 \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/, 'and so is the footer');
    assert.ok(!/ideas waiting|Generated |no workstreams yet/.test(html));
  });

  test('--labels ko does the same for one run, in every renderer', () => {
    setDashboard(null);
    assert.match(page(['--labels', 'ko']), /<h2>막힘/);
    assert.match(hq(['dashboard', '--no-open', '--md', '--labels', 'ko']).stdout, /^## 막힘$/m);
    assert.match(hq(['dashboard', '--no-open', '--terminal', '--labels', 'ko']).stdout, /^막힘$/m);
    assert.ok(ENGLISH_HEADINGS.test(page()), 'sanity: a run without the flag is still English');
  });

  test('the top-level language key is honoured when dashboard.labels is unset', () => {
    setDashboard(null);
    setLanguage('ko');
    assert.match(page(), /<h2>막힘/, 'language: ko is enough');
    setDashboard({ labels: 'en' });
    assert.match(page(), /<h2>Blocked/, 'an explicit dashboard.labels still wins');
    setLanguage('en');
  });

  test('an object of overrides replaces single words and keeps the rest', () => {
    setDashboard({ labels: { stale: 'Gone quiet', blocked: 'Stuck' } });
    const html = page();
    assert.match(html, /<h2>Gone quiet \(over 48h\)/);
    assert.match(html, /<h2>Stuck<\/h2>/);
    assert.match(html, /<h2>Awaiting review<\/h2>/, 'the other eighty labels are still English');
  });
});
