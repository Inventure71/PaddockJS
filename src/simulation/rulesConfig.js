import { DEFAULT_RULES } from './rules/ruleDefaults.js';
import { normalizeModules } from './rules/moduleConfig.js';
import { clamp01, mergeConfig } from './rules/ruleConfigMerge.js';
import { RULESET_MODULES } from './rules/rulesetPresets.js';

export { DEFAULT_RULES } from './rules/ruleDefaults.js';

export function normalizeRaceRules(rules = {}) {
  const requestedRuleset = rules?.ruleset ?? rules?.profile ?? 'paddock';
  const ruleset = Object.hasOwn(RULESET_MODULES, requestedRuleset) ? requestedRuleset : 'custom';
  const presetModules = RULESET_MODULES[ruleset] ?? RULESET_MODULES.custom;
  const modules = normalizeModules(mergeConfig(presetModules, rules.modules), rules.modules);
  const flatOverrides = Object.fromEntries(
    Object.entries(rules ?? {}).filter(([key]) => key !== 'ruleset' && key !== 'profile' && key !== 'modules'),
  );

  return {
    ...DEFAULT_RULES,
    ...flatOverrides,
    ruleset,
    modules,
  };
}

export function getPenaltyRule(rules, type) {
  const penalties = rules?.modules?.penalties;
  if (!penalties?.enabled) return null;
  const config = penalties[type];
  if (!config || config.strictness <= 0) return null;
  return {
    ...config,
    strictness: clamp01(config.strictness * penalties.stewardStrictness, config.strictness),
  };
}
