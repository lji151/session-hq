// Configuration discovery and validation, and the paths derived from them.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { expandHome, isFile, safeReadJson, deepMerge, safeSlug } from './util.mjs';

export const CONFIG_NAME = 'hq.config.json';
export const DEFAULT_CONFIG = {
  hqRoot: '~/hq',
  domains: ['video', 'apps', 'business'],
  defaultDomain: null,
  inject: { on: 'session-start', maxLines: 60, staleAfterHours: 48 },
  update: { mode: 'on-stop', everyNTools: 0, minMinutesBetween: 20, enforce: false },
  orchestrator: { domain: 'hq', injectDashboard: true, maxLines: 80 },
  inbox: { file: 'ideas-inbox.md' },
  decisions: { file: 'decisions.md' },
  language: 'en',
};
const INJECT_MODES = ['session-start', 'session-start+compact', 'off'];
const UPDATE_MODES = ['on-stop', 'periodic', 'manual'];

/* --------------------------------------------------------------- discovery */

/**
 * Discovery order: HQ_ROOT env -> walk up from cwd -> ~/.session-hq/hq.config.json
 * Returns { config, configPath, hqRoot, source } or null when nothing is configured.
 */
export function discoverConfig({ cwd = process.cwd(), env = process.env } = {}) {
  if (env.HQ_ROOT) {
    const root = path.resolve(expandHome(env.HQ_ROOT));
    const cfgPath = path.join(root, CONFIG_NAME);
    const config = isFile(cfgPath) ? deepMerge(DEFAULT_CONFIG, safeReadJson(cfgPath)) : { ...DEFAULT_CONFIG };
    return { config, configPath: isFile(cfgPath) ? cfgPath : null, hqRoot: root, source: 'HQ_ROOT' };
  }

  let dir = path.resolve(cwd);
  for (;;) {
    const cfgPath = path.join(dir, CONFIG_NAME);
    if (isFile(cfgPath)) return fromConfigFile(cfgPath, 'cwd-walk');
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const homeCfg = path.join(os.homedir(), '.session-hq', CONFIG_NAME);
  if (isFile(homeCfg)) return fromConfigFile(homeCfg, 'home');

  return null;
}
function fromConfigFile(cfgPath, source) {
  const raw = safeReadJson(cfgPath);
  const config = deepMerge(DEFAULT_CONFIG, raw);
  // An explicit hqRoot wins; otherwise the config file's own directory is the root.
  const hqRoot = raw.hqRoot ? path.resolve(expandHome(raw.hqRoot)) : path.dirname(cfgPath);
  return { config, configPath: cfgPath, hqRoot, source };
}
export function validateConfig(config) {
  const errors = [];
  const warnings = [];
  if (!config || typeof config !== 'object') return { errors: ['config is not an object'], warnings };

  if (!Array.isArray(config.domains) || config.domains.length === 0) {
    errors.push('domains must be a non-empty array');
  } else if (config.domains.some((d) => safeSlug(d) !== String(d).toLowerCase())) {
    warnings.push('domain names should be lowercase kebab-case (they become file names)');
  }
  if (config.defaultDomain !== null && config.defaultDomain !== undefined) {
    if (!Array.isArray(config.domains) || !config.domains.includes(config.defaultDomain)) {
      errors.push(`defaultDomain "${config.defaultDomain}" is not in domains`);
    }
  }
  if (!INJECT_MODES.includes(config.inject?.on)) errors.push(`inject.on must be one of ${INJECT_MODES.join(' | ')}`);
  if (!Number.isInteger(config.inject?.maxLines) || config.inject.maxLines < 1) errors.push('inject.maxLines must be a positive integer');
  if (typeof config.inject?.staleAfterHours !== 'number' || config.inject.staleAfterHours < 0) errors.push('inject.staleAfterHours must be a non-negative number');
  if (!UPDATE_MODES.includes(config.update?.mode)) errors.push(`update.mode must be one of ${UPDATE_MODES.join(' | ')}`);
  if (!Number.isInteger(config.update?.everyNTools) || config.update.everyNTools < 0) errors.push('update.everyNTools must be a non-negative integer');
  if (config.update?.mode === 'periodic' && config.update.everyNTools === 0) {
    warnings.push('update.mode is "periodic" but update.everyNTools is 0, so no nudge will ever fire');
  }
  if (typeof config.update?.minMinutesBetween !== 'number' || config.update.minMinutesBetween < 0) errors.push('update.minMinutesBetween must be a non-negative number');
  if (typeof config.update?.enforce !== 'boolean') errors.push('update.enforce must be a boolean');
  if (!config.orchestrator?.domain) errors.push('orchestrator.domain is required');
  if (typeof config.orchestrator?.injectDashboard !== 'boolean') errors.push('orchestrator.injectDashboard must be a boolean');
  if (!Number.isInteger(config.orchestrator?.maxLines) || config.orchestrator.maxLines < 1) errors.push('orchestrator.maxLines must be a positive integer');
  if (Array.isArray(config.domains) && config.domains.map(safeSlug).includes(safeSlug(config.orchestrator?.domain))) {
    warnings.push('orchestrator.domain is also listed in domains; it is a seat, not a department, and will appear as a dashboard row');
  }
  if (!config.inbox?.file) errors.push('inbox.file is required');
  if (!config.decisions?.file) errors.push('decisions.file is required');
  return { errors, warnings };
}

/* ------------------------------------------------------------------- paths */

export function statusPath(hqRoot, domain) {
  return path.join(hqRoot, `status-${safeSlug(domain)}.md`);
}
export function statePath(hqRoot, sessionId) {
  return path.join(hqRoot, '.state', `${safeSlug(sessionId) || 'unknown'}.json`);
}

/* --------------------------------------- which domain a session belongs to */

export function resolveDomain({ config, env = process.env, explicit = null }) {
  if (explicit) return safeSlug(explicit);
  if (env.HQ_DOMAIN) return safeSlug(env.HQ_DOMAIN);
  if (config.defaultDomain) return safeSlug(config.defaultDomain);
  return null;
}
/**
 * The CEO seat can be a person reading `dashboard`, or a session.
 * A session whose domain is `orchestrator.domain` (or the literal `all`) is
 * given the whole HQ instead of one status file.
 */
/** The status file a session is accountable for. The seat owns `status-<seat>.md`. */
export function accountableDomain(domain, config) {
  return isOrchestratorDomain(domain, config) ? safeSlug(config.orchestrator?.domain || 'hq') : domain;
}
export function isOrchestratorDomain(domain, config) {
  if (!domain) return false;
  const seat = safeSlug(config.orchestrator?.domain || 'hq');
  return domain === seat || domain === 'all';
}
