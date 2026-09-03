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

describe('wrap (the generic adapter)', () => {
  test('prints the injection, runs the child, and propagates its exit code', () => {
    const { stdout, code } = hq(['wrap', '--domain', 'apps', '--',
      process.execPath, '-e', "console.log('CHILD-RAN'); process.exit(7)"]);
    assert.equal(code, 7, 'the child exit code must survive');
    assert.match(stdout, /Domain: \*\*apps\*\*/);
    assert.match(stdout, /CHILD-RAN/);
    assert.ok(stdout.indexOf('Domain: **apps**') < stdout.indexOf('CHILD-RAN'),
      'context must be printed before the agent starts');
  });

  test('--quiet suppresses the injection but still runs the child', () => {
    const { stdout, code } = hq(['wrap', '--domain', 'apps', '--quiet', '--',
      process.execPath, '-e', "console.log('ONLY-CHILD')"]);
    assert.equal(code, 0);
    assert.match(stdout, /ONLY-CHILD/);
    assert.ok(!/Domain: \*\*apps\*\*/.test(stdout));
  });

  test('reminds on stderr when the status file is unchanged', () => {
    const { stderr, code } = hq(['wrap', '--domain', 'apps', '--quiet', '--expect-update', '--',
      process.execPath, '-e', "console.log('did work')"]);
    assert.equal(code, 0);
    assert.match(stderr, /`status-apps\.md` is unchanged/);
    assert.match(stderr, /Negative results matter/);
  });

  test('stays silent when the wrapped session updated the status file', () => {
    // JSON.stringify gives a correctly escaped JS string literal for a Windows path.
    const target = JSON.stringify(statusFile('video'));
    const { stderr } = hq(['wrap', '--domain', 'video', '--quiet', '--expect-update', '--',
      process.execPath, '-e', `require('fs').appendFileSync(${target}, ' - Status: written ')`]);
    assert.equal(stderr.trim(), '');
  });

  test('stays silent for a short run when --expect-update is not passed', () => {
    const { stderr } = hq(['wrap', '--domain', 'apps', '--quiet', '--',
      process.execPath, '-e', "console.log('quick')"]);
    assert.equal(stderr.trim(), '');
  });

  test('--min-seconds 0 makes any run worth a reminder', () => {
    const { stderr } = hq(['wrap', '--domain', 'apps', '--quiet', '--min-seconds', '0', '--',
      process.execPath, '-e', "console.log('quick')"]);
    assert.match(stderr, /`status-apps\.md` is unchanged/);
  });

  test('refuses to run with nothing after --', () => {
    const { code, stderr } = hq(['wrap', '--domain', 'apps']);
    assert.equal(code, 1);
    assert.match(stderr, /nothing to run/);
  });

  test('records session state for the wrapped run', () => {
    hq(['wrap', '--domain', 'apps', '--quiet', '--', process.execPath, '-e', '0']);
    const states = fs.readdirSync(path.join(ROOT, '.state'))
      .filter((f) => f.startsWith('wrap-'))
      .map((f) => JSON.parse(fs.readFileSync(path.join(ROOT, '.state', f), 'utf8')));
    assert.ok(states.length > 0, 'a wrapped run must leave state behind');
    // Other wrap tests leave their own state files, and readdir order is not defined,
    // so look for the one this test created rather than trusting position.
    const mine = states.filter((s) => s.domain === 'apps');
    assert.ok(mine.length > 0, 'the apps run must be among them');
    assert.equal(typeof mine[0].statusHashAtStart, 'string');
  });

  test('runs a Windows .cmd shim through the shell fallback', { skip: process.platform !== 'win32' }, () => {
    const shim = path.join(ROOT, 'probe.cmd');
    fs.writeFileSync(shim, ['@echo off', 'echo SHIM-RAN', 'exit /b 3', ''].join(os.EOL));
    const { stdout, code } = hq(['wrap', '--domain', 'apps', '--quiet', '--', shim]);
    assert.equal(code, 3, '.cmd exit codes must survive the shell fallback');
    assert.match(stdout, /SHIM-RAN/);
  });

  test('runs the command anyway when no HQ is configured', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'session-hq-nohq-'));
    try {
      const res = spawnSync(process.execPath, [CLI, 'wrap', '--quiet', '--',
        process.execPath, '-e', "console.log('STILL-RAN')"], {
        encoding: 'utf8', cwd: empty,
        env: { ...process.env, HQ_ROOT: '', HQ_DOMAIN: '', USERPROFILE: empty, HOME: empty },
      });
      assert.equal(res.status, 0);
      assert.match(res.stdout, /STILL-RAN/);
      assert.match(res.stderr, /no hq\.config\.json found/);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
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

describe('adapter-aware instructions', () => {
  test('hook injection tells the model to use /hq-update', () => {
    const { stdout } = hq(['inject', '--event', 'session-start'], {
      stdin: { session_id: 'sess-voice-hook', cwd: ROOT },
      env: { HQ_DOMAIN: 'apps' },
    });
    const text = JSON.parse(stdout).hookSpecificOutput.additionalContext;
    assert.match(text, /update it with `\/hq-update`/);
    assert.ok(!/update-check --domain/.test(text), 'hooks should not advertise the raw CLI');
  });

  test('inject --print tells a shell to edit the file and run update-check', () => {
    const { stdout } = hq(['inject', '--print', '--domain', 'apps']);
    assert.ok(!/\/hq-update/.test(stdout), 'there are no slash commands outside Claude Code');
    assert.ok(!/\/hq-status/.test(stdout));
    assert.match(stdout, /edit `status-apps\.md` directly/);
    assert.match(stdout, /hq\.mjs" update-check --domain apps/);
  });

  test('the domain list adapts too', () => {
    const hooked = hq(['inject', '--event', 'session-start'], {
      stdin: { session_id: 'sess-voice-idx', cwd: ROOT }, env: { HQ_DOMAIN: '' },
    });
    assert.match(JSON.parse(hooked.stdout).hookSpecificOutput.additionalContext, /`\/hq-status <domain>`/);
    const printed = hq(['inject', '--print'], { env: { HQ_DOMAIN: '' } });
    assert.ok(!/\/hq-status/.test(printed.stdout));
    assert.match(printed.stdout, /Pass `--domain <domain>`/);
  });

  test('wrap prints no slash commands at all', () => {
    const { stdout, stderr } = hq(['wrap', '--domain', 'apps', '--expect-update', '--',
      process.execPath, '-e', '0']);
    assert.ok(!/\/hq-/.test(stdout), `wrap stdout mentioned a slash command: ${stdout}`);
    assert.ok(!/\/hq-/.test(stderr), `wrap stderr mentioned a slash command: ${stderr}`);
    assert.match(stdout, /hq\.mjs" update-check --domain apps/);
  });

  test('update-check --domain reports from a shell without a hook payload', () => {
    const before = hq(['update-check', '--domain', 'apps']);
    assert.equal(before.code, 0);
    assert.match(before.stdout, /UNCHANGED since the session/);
    assert.ok(!/\/hq-/.test(before.stdout));

    fs.appendFileSync(statusFile('apps'), os.EOL + '- Status: written by hand' + os.EOL);
    const after = hq(['update-check', '--domain', 'apps']);
    assert.match(after.stdout, /Nothing outstanding/);
  });

  test('update-check --domain on an unknown domain says so rather than hanging', () => {
    const { stdout } = hq(['update-check', '--domain', 'nosuchdomain']);
    assert.match(stdout, /does not exist yet/);
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
