import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', 'scripts', 'hq.mjs');

let ROOT;

/** Run hq.mjs, optionally piping a hook payload to stdin. */
function hq(args, { stdin = null, env = {}, cwd = ROOT } = {}) {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    input: stdin === null ? '' : JSON.stringify(stdin),
    encoding: 'utf8',
    cwd,
    env: { ...process.env, HQ_ROOT: ROOT, ...env },
  });
  if (res.error) throw res.error;
  return { stdout: res.stdout ?? '', stderr: res.stderr ?? '', code: res.status };
}

function readConfig() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'hq.config.json'), 'utf8'));
}
function patchConfig(patch) {
  const c = readConfig();
  fs.writeFileSync(path.join(ROOT, 'hq.config.json'), JSON.stringify({ ...c, ...patch }, null, 2));
}
function statusFile(domain) {
  return path.join(ROOT, `status-${domain}.md`);
}

before(() => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'session-hq-test-'));
});
after(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe('init', () => {
  test('creates the config, the state dir, and one status file per domain', () => {
    const { code, stdout } = hq(['init', '--root', ROOT, '--domains', 'video,apps,business']);
    assert.equal(code, 0);
    assert.match(stdout, /initialised at/);

    for (const f of ['hq.config.json', 'README.md', 'ideas-inbox.md', 'decisions.md',
                     'status-video.md', 'status-apps.md', 'status-business.md']) {
      assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} should exist`);
    }
    assert.ok(fs.statSync(path.join(ROOT, '.state')).isDirectory());

    const cfg = readConfig();
    assert.deepEqual(cfg.domains, ['video', 'apps', 'business']);
    assert.equal(cfg.update.mode, 'on-stop');
    assert.equal(cfg.update.enforce, false);
  });

  test('is idempotent: a second run keeps existing files', () => {
    const marker = '\n### Marker block\n';
    fs.appendFileSync(statusFile('apps'), marker);
    const { code, stdout } = hq(['init', '--root', ROOT, '--domains', 'video,apps,business']);
    assert.equal(code, 0);
    assert.match(stdout, /kept/);
    assert.ok(fs.readFileSync(statusFile('apps'), 'utf8').includes('Marker block'));
  });

  test('slugifies a domain so it cannot escape the HQ root', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-hq-slug-'));
    try {
      hq(['init', '--root', dir, '--domains', '../escape,Weird Name'], { env: { HQ_ROOT: dir } });
      const files = fs.readdirSync(dir);
      assert.ok(files.includes('status-escape.md'), `got ${files.join(', ')}`);
      assert.ok(files.includes('status-weird-name.md'));
      assert.ok(!fs.existsSync(path.join(dir, '..', 'status-escape.md')));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('doctor', () => {
  test('passes on a freshly initialised HQ', () => {
    const { code, stdout } = hq(['doctor']);
    assert.equal(code, 0, stdout);
    assert.match(stdout, /doctor: no errors/);
    assert.match(stdout, /hooks\.SessionStart: declared/);
  });

  test('--json reports structured checks', () => {
    const { stdout } = hq(['doctor', '--json']);
    const report = JSON.parse(stdout);
    assert.equal(report.ok, true);
    assert.ok(report.checks.some((c) => c.name === 'config.schema' && c.level === 'ok'));
  });

  test('fails on an invalid enum value', () => {
    patchConfig({ update: { mode: 'whenever', everyNTools: 0, minMinutesBetween: 20, enforce: false } });
    const { code, stdout } = hq(['doctor']);
    assert.equal(code, 1);
    assert.match(stdout, /update\.mode must be one of/);
    patchConfig({ update: { mode: 'on-stop', everyNTools: 0, minMinutesBetween: 20, enforce: false } });
  });

  test('fails when defaultDomain is not a known domain', () => {
    patchConfig({ defaultDomain: 'nope' });
    const { code, stdout } = hq(['doctor']);
    assert.equal(code, 1);
    assert.match(stdout, /defaultDomain "nope" is not in domains/);
    patchConfig({ defaultDomain: null });
  });
});

describe('inject', () => {
  test('--print emits the status file for the domain', () => {
    const { code, stdout } = hq(['inject', '--print', '--domain', 'apps']);
    assert.equal(code, 0);
    assert.match(stdout, /Domain: \*\*apps\*\*/);
    assert.match(stdout, /apps — status/);
  });

  test('with no domain, lists the domains instead', () => {
    const { stdout } = hq(['inject', '--print'], { env: { HQ_DOMAIN: '' } });
    assert.match(stdout, /no domain selected/);
    for (const d of ['video', 'apps', 'business']) assert.match(stdout, new RegExp(`\\*\\*${d}\\*\\*`));
  });

  test('SessionStart returns additionalContext and records session state', () => {
    const { stdout } = hq(['inject', '--event', 'session-start'], {
      stdin: { session_id: 'sess-inject', cwd: ROOT, hook_event_name: 'SessionStart' },
      env: { HQ_DOMAIN: 'apps' },
    });
    const out = JSON.parse(stdout);
    assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
    assert.match(out.hookSpecificOutput.additionalContext, /Domain: \*\*apps\*\*/);

    const state = JSON.parse(fs.readFileSync(path.join(ROOT, '.state', 'sess-inject.json'), 'utf8'));
    assert.equal(state.domain, 'apps');
    assert.equal(state.toolCalls, 0);
    assert.equal(typeof state.statusHashAtStart, 'string');
  });

  test('compact injection is silent unless inject.on opts in', () => {
    const payload = { session_id: 'sess-compact', cwd: ROOT, hook_event_name: 'PreCompact' };
    assert.equal(hq(['inject', '--event', 'compact'], { stdin: payload, env: { HQ_DOMAIN: 'apps' } }).stdout.trim(), '');

    patchConfig({ inject: { on: 'session-start+compact', maxLines: 60, staleAfterHours: 48 } });
    const out = JSON.parse(hq(['inject', '--event', 'compact'], { stdin: payload, env: { HQ_DOMAIN: 'apps' } }).stdout);
    assert.match(out.systemMessage, /Domain: \*\*apps\*\*/);
    patchConfig({ inject: { on: 'session-start', maxLines: 60, staleAfterHours: 48 } });
  });

  test('inject.on "off" silences the hook but not --print', () => {
    patchConfig({ inject: { on: 'off', maxLines: 60, staleAfterHours: 48 } });
    const hooked = hq(['inject', '--event', 'session-start'], {
      stdin: { session_id: 'sess-off', cwd: ROOT }, env: { HQ_DOMAIN: 'apps' },
    });
    assert.equal(hooked.stdout.trim(), '');
    assert.match(hq(['inject', '--print', '--domain', 'apps']).stdout, /apps — status/);
    patchConfig({ inject: { on: 'session-start', maxLines: 60, staleAfterHours: 48 } });
  });

  test('trims to inject.maxLines', () => {
    patchConfig({ inject: { on: 'session-start', maxLines: 5, staleAfterHours: 48 } });
    const { stdout } = hq(['inject', '--print', '--domain', 'apps']);
    assert.match(stdout, /trimmed to 5 lines/);
    patchConfig({ inject: { on: 'session-start', maxLines: 60, staleAfterHours: 48 } });
  });

  test('flags a stale status file', () => {
    const file = statusFile('video');
    const text = fs.readFileSync(file, 'utf8').replace(/<!-- hq:updated .*? -->/, '<!-- hq:updated 2020-01-01T00:00:00Z -->');
    fs.writeFileSync(file, text);
    const { stdout } = hq(['inject', '--print', '--domain', 'video']);
    assert.match(stdout, /\*\*Stale:\*\*/);
  });

  test('stays silent when no config can be discovered', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'session-hq-noconf-'));
    try {
      const res = spawnSync(process.execPath, [CLI, 'inject', '--event', 'session-start'], {
        input: JSON.stringify({ session_id: 'x', cwd: empty }),
        encoding: 'utf8',
        cwd: empty,
        env: { ...process.env, HQ_ROOT: '', HQ_DOMAIN: '', USERPROFILE: empty, HOME: empty },
      });
      assert.equal(res.status, 0);
      assert.equal(res.stdout.trim(), '');
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('remind / update-check cadence', () => {
  const sid = 'sess-cadence';
  const payload = () => ({ session_id: sid, cwd: ROOT });

  test('a session that did nothing is never reminded', () => {
    hq(['inject', '--event', 'session-start'], { stdin: payload(), env: { HQ_DOMAIN: 'apps' } });
    assert.equal(hq(['update-check'], { stdin: payload(), env: { HQ_DOMAIN: 'apps' } }).stdout.trim(), '');
  });

  test('on-stop mode still counts tool calls, and reminds once', () => {
    for (let i = 0; i < 3; i++) hq(['remind'], { stdin: payload(), env: { HQ_DOMAIN: 'apps' } });
    const state = JSON.parse(fs.readFileSync(path.join(ROOT, '.state', `${sid}.json`), 'utf8'));
    assert.equal(state.toolCalls, 3);

    const first = JSON.parse(hq(['update-check'], { stdin: payload(), env: { HQ_DOMAIN: 'apps' } }).stdout);
    assert.match(first.systemMessage, /used 3 tools but `status-apps\.md` is unchanged/);
    assert.equal(first.decision, undefined, 'soft mode must not block');

    // One reminder per session, always.
    assert.equal(hq(['update-check'], { stdin: payload(), env: { HQ_DOMAIN: 'apps' } }).stdout.trim(), '');
  });

  test('stop_hook_active suppresses the check, so enforcement cannot loop', () => {
    const sid2 = 'sess-loop';
    hq(['inject', '--event', 'session-start'], { stdin: { session_id: sid2, cwd: ROOT }, env: { HQ_DOMAIN: 'apps' } });
    hq(['remind'], { stdin: { session_id: sid2, cwd: ROOT }, env: { HQ_DOMAIN: 'apps' } });
    const { stdout } = hq(['update-check'], {
      stdin: { session_id: sid2, cwd: ROOT, stop_hook_active: true }, env: { HQ_DOMAIN: 'apps' },
    });
    assert.equal(stdout.trim(), '');
  });

  test('enforce:true blocks instead of reminding', () => {
    patchConfig({ update: { mode: 'on-stop', everyNTools: 0, minMinutesBetween: 20, enforce: true } });
    const sid3 = 'sess-enforce';
    hq(['inject', '--event', 'session-start'], { stdin: { session_id: sid3, cwd: ROOT }, env: { HQ_DOMAIN: 'apps' } });
    hq(['remind'], { stdin: { session_id: sid3, cwd: ROOT }, env: { HQ_DOMAIN: 'apps' } });
    const out = JSON.parse(hq(['update-check'], { stdin: { session_id: sid3, cwd: ROOT }, env: { HQ_DOMAIN: 'apps' } }).stdout);
    assert.equal(out.decision, 'block');
    assert.match(out.reason, /Negative results matter/);
    patchConfig({ update: { mode: 'on-stop', everyNTools: 0, minMinutesBetween: 20, enforce: false } });
  });

  test('a session that updated its status file is left alone', () => {
    const sid4 = 'sess-updated';
    hq(['inject', '--event', 'session-start'], { stdin: { session_id: sid4, cwd: ROOT }, env: { HQ_DOMAIN: 'business' } });
    hq(['remind'], { stdin: { session_id: sid4, cwd: ROOT }, env: { HQ_DOMAIN: 'business' } });
    fs.appendFileSync(statusFile('business'), '\n- Status: written back by the session\n');
    assert.equal(hq(['update-check'], { stdin: { session_id: sid4, cwd: ROOT }, env: { HQ_DOMAIN: 'business' } }).stdout.trim(), '');
  });

  test('periodic mode nudges on the Nth call and throttles by minutes', () => {
    patchConfig({ update: { mode: 'periodic', everyNTools: 2, minMinutesBetween: 0, enforce: false } });
    const sid5 = 'sess-periodic';
    hq(['inject', '--event', 'session-start'], { stdin: { session_id: sid5, cwd: ROOT }, env: { HQ_DOMAIN: 'apps' } });

    assert.equal(hq(['remind'], { stdin: { session_id: sid5, cwd: ROOT }, env: { HQ_DOMAIN: 'apps' } }).stdout.trim(), '');
    const second = JSON.parse(hq(['remind'], { stdin: { session_id: sid5, cwd: ROOT }, env: { HQ_DOMAIN: 'apps' } }).stdout);
    assert.match(second.systemMessage, /2 tool calls into this session/);

    // Same counter, but the throttle now blocks the next one.
    patchConfig({ update: { mode: 'periodic', everyNTools: 2, minMinutesBetween: 999, enforce: false } });
    hq(['remind'], { stdin: { session_id: sid5, cwd: ROOT }, env: { HQ_DOMAIN: 'apps' } });
    assert.equal(hq(['remind'], { stdin: { session_id: sid5, cwd: ROOT }, env: { HQ_DOMAIN: 'apps' } }).stdout.trim(), '');

    patchConfig({ update: { mode: 'on-stop', everyNTools: 0, minMinutesBetween: 20, enforce: false } });
  });

  test('manual mode says nothing at all', () => {
    patchConfig({ update: { mode: 'manual', everyNTools: 0, minMinutesBetween: 20, enforce: false } });
    const sid6 = 'sess-manual';
    hq(['inject', '--event', 'session-start'], { stdin: { session_id: sid6, cwd: ROOT }, env: { HQ_DOMAIN: 'apps' } });
    assert.equal(hq(['remind'], { stdin: { session_id: sid6, cwd: ROOT }, env: { HQ_DOMAIN: 'apps' } }).stdout.trim(), '');
    assert.equal(hq(['update-check'], { stdin: { session_id: sid6, cwd: ROOT }, env: { HQ_DOMAIN: 'apps' } }).stdout.trim(), '');
    patchConfig({ update: { mode: 'on-stop', everyNTools: 0, minMinutesBetween: 20, enforce: false } });
  });
});

describe('inbox and decisions', () => {
  test('inbox appends one dated line tagged with the domain', () => {
    const { code, stdout } = hq(['inbox', 'a shared vocabulary file across the two clients'], { env: { HQ_DOMAIN: 'apps' } });
    assert.equal(code, 0);
    assert.match(stdout, /appended to/);
    const text = fs.readFileSync(path.join(ROOT, 'ideas-inbox.md'), 'utf8');
    assert.match(text, /\| a shared vocabulary file across the two clients \| apps$/m);
  });

  test('decide appends to the decision log and honours --domain', () => {
    hq(['decide', 'ship the retry fix behind a flag', '--domain', 'video'], { env: { HQ_DOMAIN: 'apps' } });
    const text = fs.readFileSync(path.join(ROOT, 'decisions.md'), 'utf8');
    assert.match(text, /\| ship the retry fix behind a flag \| video$/m);
  });

  test('empty input is refused', () => {
    const { code, stderr } = hq(['inbox']);
    assert.equal(code, 1);
    assert.match(stderr, /nothing to record/);
  });

  test('appending never rewrites what is already there', () => {
    const before = fs.readFileSync(path.join(ROOT, 'ideas-inbox.md'), 'utf8');
    hq(['inbox', 'second idea'], { env: { HQ_DOMAIN: 'apps' } });
    const after = fs.readFileSync(path.join(ROOT, 'ideas-inbox.md'), 'utf8');
    assert.ok(after.startsWith(before.replace(/\s*$/, '\n')));
  });
});

describe('config discovery', () => {
  test('walks up from cwd to find hq.config.json', () => {
    const nested = path.join(ROOT, 'a', 'b', 'c');
    fs.mkdirSync(nested, { recursive: true });
    const res = spawnSync(process.execPath, [CLI, 'inject', '--print', '--domain', 'apps'], {
      encoding: 'utf8',
      cwd: nested,
      env: { ...process.env, HQ_ROOT: '', HQ_DOMAIN: '' },
    });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /apps — status/);
  });

  test('HQ_ROOT wins over the cwd walk', () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'session-hq-other-'));
    try {
      hq(['init', '--root', other, '--domains', 'solo'], { env: { HQ_ROOT: other } });
      const res = spawnSync(process.execPath, [CLI, 'inject', '--print'], {
        encoding: 'utf8',
        cwd: ROOT,
        env: { ...process.env, HQ_ROOT: other, HQ_DOMAIN: '' },
      });
      assert.match(res.stdout, /\*\*solo\*\*/);
      assert.ok(!/\*\*business\*\*/.test(res.stdout));
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });

  test('Windows-style absolute paths round-trip', () => {
    const { stdout } = hq(['doctor', '--json']);
    const report = JSON.parse(stdout);
    const rootCheck = report.checks.find((c) => c.name === 'hqRoot');
    assert.ok(rootCheck.detail.includes(ROOT), `${rootCheck.detail} should contain ${ROOT}`);
    assert.equal(rootCheck.level, 'ok');
  });
});

describe('cli surface', () => {
  test('no arguments prints usage', () => {
    const { code, stdout } = hq([]);
    assert.equal(code, 0);
    assert.match(stdout, /hq\.mjs init/);
  });

  test('an unknown command exits non-zero', () => {
    const { code, stderr } = hq(['frobnicate']);
    assert.equal(code, 1);
    assert.match(stderr, /unknown command/);
  });
});
