// Value drift — the same parameter written with different numbers in different files.
//
// Why this exists: every other check in the lint asks whether a file is well formed.
// A number that was copied into six files and then updated in one of them leaves all
// six well formed, so nothing catches it until a session acts on the stale copy. This
// scanner is the cheapest thing that can see across files at all.
//
// It is a heuristic and it is deliberately a timid one: it only looks at numbers that
// carry a unit and sit next to a word, and it only speaks up when two different files
// disagree. Even so it still pairs the occasional unrelated number, so the check is
// opt-in (`memory-lint --drift`) and its findings are advisory — `info`, never a failure.
//
// Node built-ins only; this module imports nothing.

/** Units worth comparing. A bare number with no unit is far too noisy to match on. */
const UNITS = [
  '°C', '℃', '%', 'MiB', 'GiB', 'GB', 'MB', 'ms', 'sec', 'min', 'fps', 'px',
  'tokens', 'words', 's', 'h',
  '초', '분', '시간', '회', '명', '줄', '편', '프레임', '토큰', '단어',
];
/** `℃` and `°C` are the same gate written two ways. */
const UNIT_ALIASES = { '℃': '°C' };

function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
// Longest first, so `sec` is preferred over `s` and `시간` over `시`.
const UNIT_ALT = [...UNITS].sort((a, b) => b.length - a.length).map(esc).join('|');

const NUM = String.raw`\d+(?:\.\d+)?`;
const VALUE = String.raw`${NUM}(?:\s*[~\-/]\s*${NUM})?`;
// The unit may not run straight into another Latin word: `5 s` is a value, `5 seconds` is prose.
const VALUE_RE = new RegExp(String.raw`(${VALUE})[ ]?(${UNIT_ALT})(?![A-Za-z0-9])`, 'g');

/** A number that is really a date, a time, a year or a version is not a parameter. */
const NOT_A_VALUE = [
  String.raw`\b\d{4}-\d{1,2}-\d{1,2}\b`,          // 2026-09-12
  String.raw`\b\d+\.\d+\.\d+\b`,                  // 0.3.0
  String.raw`\b\d{1,2}:\d{2}\b`,                  // 09:30
  String.raw`\b\d{1,2}[-/]\d{1,2}\b`,             // 09-12, 9/12
  String.raw`\b(?:19|20|21)\d{2}\b`,              // 2026
];
// ...unless a unit follows it, in which case `5-10%` is a range and not a date.
const UNIT_FOLLOWS = String.raw`(?![ ]?(?:${UNIT_ALT}))`;
const MASKS = NOT_A_VALUE.map((p) => new RegExp(p + UNIT_FOLLOWS, 'g'));

/** Lines that are recording what a value used to be, not what it is. */
const HISTORY_RE = /이력|\bhistory\b|\bchangelog\b|\bwas\b\s+\d/i;
const ARROW_RE = /→|->/;

/** Words that name nothing. Without this, half the corpus keys on "is" or "the". */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'and', 'or', 'but', 'if', 'of',
  'to', 'at', 'in', 'on', 'for', 'from', 'by', 'with', 'as', 'than', 'then', 'over', 'under',
  'up', 'per', 'into', 'about', 'it', 'its', 'this', 'that', 'these', 'those', 'we', 'you',
  'they', 'not', 'no', 'all', 'only', 'each', 'every', 'any', 'do', 'does', 'did', 'has',
  'have', 'had', 'can', 'may', 'will', 'would', 'should', 'must', 'about',
]);

/** A unit word is not a parameter name: "초를 5분" keys on the wrong half otherwise. */
const UNIT_WORDS = new Set(UNITS.map((u) => u.toLowerCase()));
const HANGUL_PARTICLE = /(?:으로|부터|까지|에서|은|는|이|가|을|를|의|에|로|와|과|도|만)$/;
function isUnitWord(token) {
  const t = token.toLowerCase();
  return UNIT_WORDS.has(t) || UNIT_WORDS.has(t.replace(HANGUL_PARTICLE, ''));
}

/** Punctuation that ends a clause. `:` `=` and `→` join a key to its value, so they do not. */
const CLAUSE_BREAK = /[.,;!?()[\]{}"'|—–…、。]/;
const WORD_CHAR = /[0-9A-Za-z가-힣]/;

/** Blank out fenced code blocks and inline code spans, keeping line and column positions. */
export function stripCode(text) {
  const out = [];
  let fence = null;
  for (const line of String(text).split(/\r?\n/)) {
    const opener = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      if (opener && opener[1][0] === fence[0] && opener[1].length >= fence.length) fence = null;
      out.push('');
      continue;
    }
    if (opener) { fence = opener[1]; out.push(''); continue; }
    out.push(line.replace(/`+[^`\n]*`+/g, (s) => ' '.repeat(s.length)));
  }
  return out.join('\n');
}

function mask(line) {
  let out = line;
  for (const re of MASKS) out = out.replace(re, (s) => ' '.repeat(s.length));
  return out;
}

/** The nearest word within three tokens to the left, without crossing a clause boundary. */
function keywordBefore(before) {
  let start = 0;
  for (let i = before.length - 1; i >= 0; i--) {
    if (CLAUSE_BREAK.test(before[i])) { start = i + 1; break; }
  }
  const tokens = before.slice(start).split(/\s+/).filter(Boolean).slice(-3);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i].replace(/^[^0-9A-Za-z가-힣]+/, '').replace(/[^0-9A-Za-z가-힣]+$/, '');
    if (/^[A-Za-z][A-Za-z-]+$/.test(t)) {
      if (!STOPWORDS.has(t.toLowerCase()) && !isUnitWord(t)) return t;
      continue;
    }
    const hangul = t.match(/[가-힣]{2,}/);
    if (hangul && !isUnitWord(hangul[0])) return hangul[0];
  }
  return null;
}

function normaliseValue(raw) {
  return raw.replace(/\s+/g, '').replace(/[-/]/g, '~');
}

/** Every (keyword, unit, value) pair one line offers. */
function pairsInLine(line) {
  const masked = mask(line);
  const found = [];
  for (const m of masked.matchAll(VALUE_RE)) {
    const charBefore = masked[m.index - 1] ?? ' ';
    if (WORD_CHAR.test(charBefore) || charBefore === '.') continue;
    const keyword = keywordBefore(masked.slice(0, m.index));
    if (!keyword) continue;
    const unit = UNIT_ALIASES[m[2]] || m[2];
    found.push({
      key: keyword.toLowerCase() + unit,
      keyword: keyword.toLowerCase(),
      unit,
      value: normaliseValue(m[1]),
    });
  }
  return found;
}

/**
 * Aggregate values across files.
 *
 * @param {{name: string, text: string}[]} docs
 * @returns {Map<string, {keyword: string, unit: string, values: Map<string, Set<string>>}>}
 */
export function collectValues(docs) {
  const keys = new Map();
  for (const { name, text } of docs) {
    for (const line of stripCode(text).split(/\r?\n/)) {
      if (HISTORY_RE.test(line)) continue;
      const pairs = pairsInLine(line);
      if (pairs.length === 0) continue;
      // `83°C → 78°C → 72°C` is one parameter's history; the last arm is the current value.
      let chosen = pairs;
      if (ARROW_RE.test(line)) {
        const last = new Map();
        for (const p of pairs) last.set(p.key, p);
        chosen = [...last.values()];
      }
      for (const p of chosen) {
        let entry = keys.get(p.key);
        if (!entry) { entry = { keyword: p.keyword, unit: p.unit, values: new Map() }; keys.set(p.key, entry); }
        let files = entry.values.get(p.value);
        if (!files) { files = new Set(); entry.values.set(p.value, files); }
        files.add(name);
      }
    }
  }
  return keys;
}

/** The `file` on the one finding that is about the list rather than about a file. */
export const DRIFT_TAIL = '(drift)';

/**
 * Findings for parameters that two or more files disagree about.
 *
 * @param {{name: string, text: string}[]} docs
 * @param {{minFiles?: number, maxKeys?: number}} [options]
 */
export function driftFindings(docs, { minFiles = 2, maxKeys = 10 } = {}) {
  const reports = [];
  for (const [, entry] of collectValues(docs)) {
    if (entry.values.size < 2) continue;
    const perFile = new Map();
    for (const [value, set] of entry.values) {
      for (const f of set) {
        if (!perFile.has(f)) perFile.set(f, new Set());
        perFile.get(f).add(value);
      }
    }
    if (perFile.size < minFiles) continue;
    // A parameter has one value per file. A word that carries several numbers inside a single
    // file — "6 GB … 32 GB … 64 GB" — is a generic word, not a parameter name, so drop the key
    // rather than report every file that uses the word.
    if ([...perFile.values()].some((values) => values.size > 1)) continue;
    reports.push({ entry, fileCount: perFile.size });
  }
  reports.sort((a, b) =>
    b.fileCount - a.fileCount ||
    b.entry.values.size - a.entry.values.size ||
    (a.entry.keyword + a.entry.unit).localeCompare(b.entry.keyword + b.entry.unit));

  const findings = reports.slice(0, maxKeys).map(({ entry }) => {
    const ordered = [...entry.values.entries()]
      .sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]) || a[0].localeCompare(b[0]));
    const shown = ordered.map(([value, files]) => `${value} (${[...files].sort().join(', ')})`);
    return {
      level: 'info',
      file: [...ordered[0][1]].sort()[0],
      message: `value drift: "${entry.keyword} ${entry.unit}" = ${shown.join(', ')} — one of these is ` +
        'probably stale; pick one file as the source of truth and point the others at it',
    };
  });
  // A long advisory list is a list nobody reads. Say how much was held back and stop.
  if (reports.length > findings.length) {
    findings.push({
      level: 'info',
      file: DRIFT_TAIL,
      message: `${reports.length - findings.length} more — raise --drift-min-files or fix these first`,
    });
  }
  return findings;
}
