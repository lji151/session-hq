// Every word the dashboard prints, in one place, so a language is a data change.
//
// Two complete sets ship (`en`, `ko`); `dashboard.labels` may also be an object,
// which is merged over the set the config would otherwise have used. Only
// `footerWatch` and `footerManual` may contain markup — they land in the page's
// footer element; everything else is escaped before it reaches the HTML.

export const LABELS_EN = {
  lang: 'en',
  title: 'session-hq dashboard',

  // section headings
  stale: 'Stale',
  blocked: 'Blocked',
  review: 'Awaiting review',
  untouched: 'Untouched',
  domains: 'Domains',
  inbox: 'Inbox',
  decisions: 'Latest decisions',
  inboxAndDecisions: 'Inbox and decisions',

  // table headers
  colDomain: 'Domain',
  colUpdated: 'Last updated',
  colWork: 'Work',
  colWorkstreams: 'Workstreams',
  colBlocked: 'Blocked',
  colNext: 'Next',
  colAsked: 'Asked',

  // row values
  staleTag: 'STALE',
  noFile: 'no file',
  noWorkstreams: 'no workstreams yet',
  noStatusFile: 'no status file',
  never: 'never',
  justNow: 'just now',
  hoursAgo: '{n}h ago',
  daysAgo: '{n}d ago',

  // empty states
  emptyStale: 'Nothing stale.',
  emptyBlocked: 'Nothing blocked.',
  emptyReview: 'Nothing waiting on review.',
  emptyUntouched: 'Every domain has work recorded.',
  emptyDecisions: 'No decisions recorded.',
  none: 'None.',
  noneShort: 'none',
  noneRecorded: 'none recorded',

  // header and footer
  domainCount: '{n} domain',
  domainsCount: '{n} domains',
  staleAfter: 'stale after {h}h',
  generated: 'generated {when}',
  ideaWaiting: '{n} idea waiting',
  ideasWaiting: '{n} ideas waiting',
  footerWatch: 'Auto-refreshing every {s}s &middot; generated {when}.',
  footerManual: 'Generated {when} &middot; run <code>hq dashboard</code> again, or <code>--watch</code>, to refresh.',
};

export const LABELS_KO = {
  lang: 'ko',
  title: 'session-hq 대시보드',

  stale: '오래됨',
  blocked: '막힘',
  review: '검토 대기',
  untouched: '손대지 않음',
  domains: '도메인',
  inbox: '인박스',
  decisions: '최근 결정',
  inboxAndDecisions: '인박스와 결정',

  colDomain: '도메인',
  colUpdated: '마지막 갱신',
  colWork: '작업',
  colWorkstreams: '작업 흐름',
  colBlocked: '막힘',
  colNext: '다음',
  colAsked: '요청',

  staleTag: '오래됨',
  noFile: '파일 없음',
  noWorkstreams: '아직 작업 없음',
  noStatusFile: '상태 파일 없음',
  never: '기록 없음',
  justNow: '방금',
  hoursAgo: '{n}시간 전',
  daysAgo: '{n}일 전',

  emptyStale: '오래된 도메인이 없다.',
  emptyBlocked: '막힌 것이 없다.',
  emptyReview: '검토를 기다리는 것이 없다.',
  emptyUntouched: '모든 도메인에 작업이 기록되어 있다.',
  emptyDecisions: '기록된 결정이 없다.',
  none: '없음.',
  noneShort: '없음',
  noneRecorded: '기록 없음',

  domainCount: '도메인 {n}개',
  domainsCount: '도메인 {n}개',
  staleAfter: '{h}시간이 지나면 오래됨',
  generated: '생성 {when}',
  ideaWaiting: '아이디어 {n}개 대기 중',
  ideasWaiting: '아이디어 {n}개 대기 중',
  footerWatch: '{s}초마다 자동 새로고침 &middot; 생성 {when}.',
  footerManual: '생성 {when} &middot; 새로 고치려면 <code>hq dashboard</code>를 다시 실행하거나 <code>--watch</code>를 붙인다.',
};

export const LABEL_SETS = { en: LABELS_EN, ko: LABELS_KO };
export const LABEL_SET_NAMES = Object.keys(LABEL_SETS);

/** `{n}`, `{h}`, `{s}`, `{when}` — the only placeholders a label may carry. */
export function fmt(template, vars = {}) {
  return String(template).replace(/\{(\w+)\}/g, (whole, key) =>
    (Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : whole));
}

/**
 * Resolve the label set for one run.
 *
 * Precedence: `--labels` flag, then `dashboard.labels`, then the top-level
 * `language` key, then English. An object anywhere in that chain is merged over
 * the set the rest of the chain selected, so overriding one word keeps the other
 * eighty.
 */
export function resolveLabels(spec, { language = 'en' } = {}) {
  const base = LABEL_SETS[language] || LABELS_EN;
  if (spec === null || spec === undefined || spec === '') return base;
  if (typeof spec === 'string') return LABEL_SETS[spec] || base;
  if (typeof spec === 'object' && !Array.isArray(spec)) {
    const named = typeof spec.base === 'string' ? LABEL_SETS[spec.base] : null;
    const { base: _ignored, ...rest } = spec;
    return { ...(named || base), ...rest };
  }
  return base;
}
