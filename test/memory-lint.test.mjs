import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { lintMemoryDir } from '../scripts/hq.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', 'scripts', 'hq.mjs');

let DIR;

/** A fact file with the frontmatter the lint expects, so only the body is under test. */
function fact(name, body, { type = 'reference', frontmatterName = name } = {}) {
  const fm = ['---', `name: ${frontmatterName}`, `description: One line about ${name}.`, `type: ${type}`, '---', ''];
  fs.writeFileSync(path.join(DIR, `${name}.md`), `${fm.join('\n')}\n${body}\n`, 'utf8');
}
/** Domain indexes carry frontmatter too; the root index does not. */
function write(name, text) {
  const fm = /^index-/.test(name)
    ? ['---', `name: ${name.slice(0, -3)}`, `description: One line about ${name}.`, 'type: reference', '---', '', ''].join('\n')
    : '';
  fs.writeFileSync(path.join(DIR, name), `${fm}${text}\n`, 'utf8');
}
function lint(options) {
  return lintMemoryDir(DIR, options);
}
function messages(findings, level) {
  return findings.filter((f) => !level || f.level === level).map((f) => `${f.file}: ${f.message}`);
}
/** Only the findings the test is about — the fixtures are minimal, not clean. */
function matching(findings, re) {
  return findings.filter((f) => re.test(f.message));
}

beforeEach(() => {
  DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'session-hq-memory-'));
});
afterEach(() => {
  fs.rmSync(DIR, { recursive: true, force: true });
});

describe('memory-lint: link integrity', () => {
  test('a broken wikilink names the file that would have matched with a type prefix', () => {
    write('MEMORY.md', '# Index\n\n- [Rules](index-rules.md)\n');
    write('index-rules.md', '# Rules\n\n- [Episode length](feedback-episode-length.md)\n');
    fact('feedback-episode-length', 'Keep it short.\n\n**Why:** attention.\n\n**How to apply:** trim.', { type: 'feedback' });
    fact('reference-tooling', 'See [[episode-length]] for the rule.');

    const found = matching(lint(), /broken link/);
    assert.equal(found.length, 1);
    assert.equal(found[0].level, 'warn');
    assert.equal(found[0].file, 'reference-tooling.md');
    assert.equal(found[0].message,
      'broken link [[episode-length]] — no such file (did you mean [[feedback-episode-length]]?)');
  });

  test('a broken wikilink with nothing to suggest says only that', () => {
    write('MEMORY.md', '# Index\n\n- [Rules](index-rules.md)\n');
    write('index-rules.md', '# Rules\n\n- [Tooling](reference-tooling.md)\n');
    fact('reference-tooling', 'See [[nowhere-at-all]].');

    const found = matching(lint(), /broken link/);
    assert.equal(found.length, 1);
    assert.equal(found[0].message, 'broken link [[nowhere-at-all]] — no such file');
  });

  test('ambiguous prefixes offer no suggestion', () => {
    write('MEMORY.md', '# Index\n\n- [Rules](index-rules.md)\n');
    write('index-rules.md', '# Rules\n\n- [a](feedback-gate.md)\n- [b](project-gate.md)\n- [c](reference-tooling.md)\n');
    fact('feedback-gate', 'A rule.\n\n**Why:** because.\n\n**How to apply:** do it.', { type: 'feedback' });
    fact('project-gate', 'A project.', { type: 'project' });
    fact('reference-tooling', 'See [[gate]].');

    const found = matching(lint(), /broken link/);
    assert.equal(found.length, 1);
    assert.equal(found[0].message, 'broken link [[gate]] — no such file');
  });

  test('prose brackets and links inside a fenced block are not links', () => {
    write('MEMORY.md', '# Index\n\n- [Rules](index-rules.md)\n');
    write('index-rules.md', '# Rules\n\n- [Tooling](reference-tooling.md)\n');
    fact('reference-tooling', [
      'The range [[0.3,7.4]] is a coordinate pair, and [[see the notes]] is prose.',
      '',
      '```markdown',
      'See [[not-a-real-file]] for the details.',
      '```',
      '',
      'Inline `[[also-not-real]]` is a code span.',
    ].join('\n'));

    assert.deepEqual(matching(lint(), /broken link/), []);
  });

  test('a frontmatter name that does not match the filename is reported', () => {
    write('MEMORY.md', '# Index\n\n- [Rules](index-rules.md)\n');
    write('index-rules.md', '# Rules\n\n- [Tooling](reference-tooling.md)\n');
    fact('reference-tooling', 'Body.', { frontmatterName: 'tooling' });

    const found = matching(lint(), /frontmatter name/);
    assert.equal(found.length, 1);
    assert.equal(found[0].level, 'warn');
    assert.equal(found[0].message,
      'frontmatter name "tooling" does not match filename — links to [[tooling]] will not resolve');
  });

  test('a link inside a nested pair of parentheses still resolves', () => {
    write('MEMORY.md', '# Index\n\n- [Rules](index-rules.md)\n');
    write('index-rules.md',
      '# Rules\n\n- [Tooling](reference-tooling.md) — the build wrapper (see also [Gate](reference-gate.md))\n');
    fact('reference-tooling', 'Body.');
    fact('reference-gate', 'Body.');

    const findings = lint();
    assert.deepEqual(matching(findings, /orphan/), [], messages(findings).join('\n'));
    assert.deepEqual(matching(findings, /broken pointer/), []);
  });

  test('a pointer link in an index that resolves to nothing is reported once', () => {
    write('MEMORY.md', '# Index\n\n- [Rules](index-rules.md)\n- [Gone](reference-gone.md)\n');
    write('index-rules.md', '# Rules\n\n- [Tooling](reference-tooling.md)\n- [External](https://example.invalid/x.md)\n');
    fact('reference-tooling', 'Body.');

    const found = matching(lint(), /broken pointer/);
    assert.equal(found.length, 1);
    assert.equal(found[0].file, 'MEMORY.md');
    assert.equal(found[0].message, 'broken pointer link (reference-gone.md) — no such file');
  });
});

describe('memory-lint: value drift', () => {
  function twoFiles(aBody, bBody) {
    write('MEMORY.md', '# Index\n\n- [Rules](index-rules.md)\n');
    write('index-rules.md', '# Rules\n\n- [A](reference-a.md)\n- [B](reference-b.md)\n');
    fact('reference-a', aBody);
    fact('reference-b', bBody);
  }

  test('the same parameter with two values in two files is reported', () => {
    twoFiles('The gate is 55°C, checked before every run.', 'Stop the run above a gate of 72°C.');

    const found = matching(lint({ drift: true }), /value drift/);
    assert.equal(found.length, 1);
    assert.equal(found[0].level, 'info');
    assert.equal(found[0].message,
      'value drift: "gate °C" = 55 (reference-a.md), 72 (reference-b.md) — one of these is probably ' +
      'stale; pick one file as the source of truth and point the others at it');
  });

  test('drift is off unless asked for, and never fails the lint', () => {
    twoFiles('The gate is 55°C.', 'The gate is 72°C.');

    assert.deepEqual(matching(lint(), /value drift/), []);
    assert.equal(matching(lint({ drift: true }), /value drift/).length, 1);
    assert.equal(lint({ drift: true }).some((f) => f.level === 'error'), false);
  });

  test('--drift-min-files raises the bar', () => {
    twoFiles('The gate is 55°C.', 'The gate is 72°C.');

    assert.equal(matching(lint({ drift: true, driftMinFiles: 2 }), /value drift/).length, 1);
    assert.equal(matching(lint({ drift: true, driftMinFiles: 3 }), /value drift/).length, 0);
  });

  test('the same value in both files is not drift', () => {
    twoFiles('The gate is 55°C.', 'The gate is 55°C, same as everywhere else.');
    assert.deepEqual(matching(lint({ drift: true }), /value drift/), []);
  });

  test('two values inside one file are not drift', () => {
    twoFiles('A gate of 83°C in one run and a gate of 55°C in another.', 'Nothing numeric here.');
    assert.deepEqual(matching(lint({ drift: true }), /value drift/), []);
  });

  test('years, dates, times and version numbers are not values', () => {
    twoFiles(
      'Written 2026-09-12, revised 09-04 at 09:30. Plugin 0.3.0, since 2024.',
      'Written 2026-01-02, revised 01-30 at 22:15. Plugin 0.4.0, since 2019.');
    assert.deepEqual(matching(lint({ drift: true }), /value drift/), []);
  });

  test('numbers inside code spans and fences are not values', () => {
    twoFiles(
      'Set the gate with `--gate 55°C`.\n\n```sh\nrun --gate 55°C\n```',
      'Set the gate with `--gate 72°C`.\n\n```sh\nrun --gate 72°C\n```');
    assert.deepEqual(matching(lint({ drift: true }), /value drift/), []);
  });

  test('an arrow chain counts only its last value', () => {
    twoFiles(
      'The gate moved 83°C → 78°C → 66°C over three runs.',
      'The gate settled at 66°C.');
    assert.deepEqual(matching(lint({ drift: true }), /value drift/), []);
  });

  test('a number with no unit or no nearby word is ignored', () => {
    twoFiles('The gate is 55.', '72 and the gate.');
    assert.deepEqual(matching(lint({ drift: true }), /value drift/), []);
  });

  test('the list stops at ten keys and says how many it held back', () => {
    const keys = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel',
                  'india', 'juliett', 'kilo', 'lima'];
    twoFiles(
      keys.map((k, i) => `- ${k}: ${10 + i}%`).join('\n'),
      keys.map((k, i) => `- ${k}: ${90 + i}%`).join('\n'));

    const found = matching(lint({ drift: true }), /value drift|more —/);
    assert.equal(found.filter((f) => /value drift/.test(f.message)).length, 10);
    assert.equal(found.length, 11);
    assert.equal(found.at(-1).level, 'info');
    assert.equal(found.at(-1).file, '(drift)');
    assert.equal(found.at(-1).message, '2 more — raise --drift-min-files or fix these first');
  });
});

describe('memory-lint: the command', () => {
  test('--json carries the new findings, and drift only appears with --drift', () => {
    write('MEMORY.md', '# Index\n\n- [Rules](index-rules.md)\n');
    write('index-rules.md', '# Rules\n\n- [A](reference-a.md)\n- [B](reference-b.md)\n');
    fact('reference-a', 'The gate is 55°C. See [[missing-file]].');
    fact('reference-b', 'The gate is 72°C.');

    const run = (args) => {
      const res = spawnSync(process.execPath, [CLI, 'memory-lint', '--dir', DIR, ...args],
        { input: '', encoding: 'utf8', timeout: 15000 });
      return { code: res.status, out: res.stdout ?? '' };
    };

    const plain = run(['--json']);
    assert.equal(plain.code, 0, plain.out);
    const parsed = JSON.parse(plain.out);
    assert.equal(parsed.findings.filter((f) => /value drift/.test(f.message)).length, 0);
    assert.equal(parsed.findings.filter((f) => /broken link/.test(f.message)).length, 1);

    const withDrift = run(['--json', '--drift']);
    assert.equal(JSON.parse(withDrift.out).findings.filter((f) => /value drift/.test(f.message)).length, 1);

    const text = run(['--drift']);
    assert.match(text.out, /info reference-a\.md: value drift/);
    assert.match(text.out, /warn reference-a\.md: broken link/);
    assert.doesNotMatch(run([]).out, /value drift/);
  });
});
