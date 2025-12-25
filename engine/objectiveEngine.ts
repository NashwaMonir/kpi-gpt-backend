// engine/objectiveEngine.ts
//
// Seed-driven objective generation for SMART KPI Engine.
// - Uses objective_patterns, verb_pool, connector_rules, variation_rules,
//   cleanup_rules, humanization_rules, regex_rules, company_tail_rules.
// - Baseline logic is canonical (simple/complex) with seeded variation.
// - Benefit and task_name are normalized via benefit_transform and task_name_cleanup.

import objective_patterns from '../data/objective_patterns.json';
import verb_pool from '../data/verb_pool.json';
import connector_rules from '../data/connector_rules.json';
import metrics_connector_rules from '../data/metrics_connector_rules.json';
import variation_rules from '../data/variation_rules.json';
import cleanup_rules from '../data/cleanup_rules.json';
import humanization_rules from '../data/humanization_rules.json';
import regex_rules from '../data/regex_rules.json';
import company_tail_rules from '../data/company_tail_rules.json';
import benefit_transform from '../data/benefit_transform.json';
import task_name_cleanup from '../data/task_name_cleanup.json';
import baseline_clause_rules from '../data/baseline_clause_rules.json';
import performance_targets from '../data/performance_targets.json';
import { isStrategicBenefit } from './strategicBenefitRules';
import type { PreparedRow, ObjectiveOutput } from './types';

// -----------------------------
// Generic seeded helpers
// -----------------------------

function hashString(str: string): number {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededIndex(seed: number, salt: string, size: number): number {
  if (size <= 0) return 0;
  const h = hashString(seed.toString() + '|' + salt);
  return h % size;
}

function seededPick<T>(seed: number, salt: string, items: T[]): T | null {
  if (!items.length) return null;
  const idx = seededIndex(seed, salt, items.length);
  return items[idx];
}

// -----------------------------
// Pattern + verb selection
// -----------------------------

function selectPattern(row: PreparedRow, mode: 'simple' | 'complex'): any | null {
  const patterns = objective_patterns as any[];

  const candidates = patterns.filter((p) => {
    const okMode = !p.mode || p.mode === mode || p.mode === 'both';

    const okRole =
      !p.applicable_roles ||
      p.applicable_roles.length === 0 ||
      p.applicable_roles.includes(row.team_role);

    const okType =
      !p.applicable_task_types ||
      p.applicable_task_types.length === 0 ||
      p.applicable_task_types.includes(row.task_type);

    return okMode && okRole && okType;
  });

  return seededPick(
    row.variation_seed,
    `pattern|${mode}|${row.team_role}|${row.task_type}`,
    candidates
  );
}

function selectVerb(
  row: PreparedRow,
  verbSlot: string,
  mode: 'simple' | 'complex'
): string {
  const verbs = verb_pool as any[];

  const candidates = verbs.filter((v) => {
    const okSlot = !v.slot || v.slot === verbSlot;
    const okRole = !v.roles || v.roles.length === 0 || v.roles.includes(row.team_role);
    const okType = !v.task_types || v.task_types.length === 0 || v.task_types.includes(row.task_type);
    const okMode = !v.modes || v.modes.length === 0 || v.modes.includes(mode);
    return okSlot && okRole && okType && okMode;
  });

  const chosen = seededPick(
    row.variation_seed,
    `verb|${verbSlot}|${mode}|${row.team_role}|${row.task_type}`,
    candidates
  );
  return (chosen as any)?.text || 'Deliver';
}

// -----------------------------
// Baseline + metrics
// -----------------------------
function containsBaselineMarker(text: string): boolean {
  return /\b(measured\s+against|based\s+on|baseline)\b/i.test(String(text || ''));
}

function anyMetricContainsBaseline(row: PreparedRow): boolean {
  return (
    containsBaselineMarker(row.output_metric) ||
    containsBaselineMarker(row.quality_metric) ||
    containsBaselineMarker(row.improvement_metric)
  );
}

function startsWithEnsure(text: string): boolean {
  return /^\s*ensure\b/i.test(String(text || ''));
}

function stripLeadingEnsureVerb(text: string): string {
  const s = String(text || '').trim();
  if (!s) return '';
  return s.replace(/^ensure\b\s*/i, '').trim();
}

function startsWithImperativeVerb(text: string): boolean {
  const s = String(text || '').trim();
  // Common imperative verbs used in KPI metrics.
  // Keep intentionally tight to avoid false positives (e.g., nouns).
    return /^(reduce|increase|improve|decrease|lower|raise|maximize|minimize|achieve|deliver|provide|support|publish|complete|implement|roll\s+out|rollout|launch|ship|optimize|streamline|ensure)\b/i.test(s);
  }

function lowerFirst(text: string): string {
  const s = String(text || '').trim();
  if (!s) return '';
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function pickBaselineLabel(improvementMetric: string): string {
  const perf = performance_targets as any;
  const lower = improvementMetric.toLowerCase();

  if (/(quality|defect|error|bug|issues?)/.test(lower)) {
    return perf.quality_baseline || perf.default_baseline || '';
  }
  if (/(output|throughput|volume|delivery|capacity)/.test(lower)) {
    return perf.output_baseline || perf.default_baseline || '';
  }
  if (/(improve|improvement|efficiency|performance|satisfaction|experience|engagement)/.test(lower)) {
    return perf.improvement_baseline || perf.default_baseline || '';
  }
  return perf.default_baseline || '';
}

function pickBaselineVariant(mode: 'simple' | 'complex', seed: number): string {
  const rules = baseline_clause_rules as any;
  const cfg = mode === 'simple' ? rules.simple : rules.complex;
  if (!cfg) return '';

  const variants: string[] =
    Array.isArray(cfg.variants) && cfg.variants.length
      ? cfg.variants
      : (cfg.default ? [cfg.default] : []);

  if (!variants.length) return '';
  const idx = seededIndex(seed, `baseline_clause|${mode}`, variants.length);
  return variants[idx];
}

// NOTE (v10.8+): Legacy baseline builder kept for backward compatibility.
// The enterprise path uses buildEnterpriseBaselineClause(); avoid adding new logic here.
function buildBaselineClause(
  improvementMetric: string,
  mode: 'simple' | 'complex',
  seed: number
): string {
  const hasImprovement = !!improvementMetric && improvementMetric.trim().length > 0;
  if (!hasImprovement) return '';

  // v10.8 contract: SIMPLE objectives must NEVER include baseline clauses.
  if (mode === 'simple') {
    return '';
  }
  // Enterprise guard: never add a baseline clause if the improvement metric already includes baseline markers.
  if (containsBaselineMarker(improvementMetric)) return '';

  const baseClause = pickBaselineVariant(mode, seed);
  if (!baseClause) return '';

  const baselineLabelRaw = pickBaselineLabel(improvementMetric).trim();
  const perf = performance_targets as any;
  const defaultLabel = (perf.default_baseline as string | undefined)?.trim();

  if (!baselineLabelRaw || (defaultLabel && baselineLabelRaw === defaultLabel)) {
    return baseClause;
  }

  // Prevent accidental double-parentheses if the rules already include them.
  const baselineLabel = baselineLabelRaw.replace(/^\(\s*/, '').replace(/\s*\)$/, '').trim();
  return `${baseClause} (${baselineLabel})`;
}

function buildMetricsClause(row: PreparedRow, mode: 'simple' | 'complex'): string {
  const metricParts: string[] = [];

  if (row.output_metric) metricParts.push(row.output_metric);
  if (row.quality_metric) metricParts.push(row.quality_metric);

  const improvementText = (row.improvement_metric || '').trim();
  if (improvementText) {
    metricParts.push(improvementText);
  }

  if (!metricParts.length) return '';

  let metricsJoined = '';
  if (metricParts.length === 1) metricsJoined = metricParts[0];
  else if (metricParts.length === 2) metricsJoined = metricParts.join(' and ');
  else metricsJoined = metricParts.slice(0, -1).join(', ') + ', and ' + metricParts[metricParts.length - 1];

  let connector = pickMetricsConnector(row, mode);

  // v10.8 grammar guard: never produce "to achieve Deliver/Provide" (or similar).
  // If the metrics phrase starts with an imperative verb, force a safe connector and normalize casing.
  if (startsWithImperativeVerb(metricsJoined)) {
    if (/\bto\s+achieve\b/i.test(connector)) connector = ' to ';
    return connector + lowerFirst(metricsJoined);
  }

  return connector + metricsJoined;
}
// -----------------------------
// Benefit transform + task name cleanup
// -----------------------------

type BenefitTransformRule = { pattern: string; replacement: string };

function applyBenefitTransform(rawBenefit: string): string {
  if (!rawBenefit) return '';
  let benefit = rawBenefit.trim();
  const rules = benefit_transform as BenefitTransformRule[];

  for (const rule of rules) {
    if (!rule.pattern) continue;
    const re = new RegExp(rule.pattern, 'i');
    if (re.test(benefit)) {
      benefit = benefit.replace(re, rule.replacement);
      break;
    }
  }

  benefit = benefit.replace(/\s+/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim();
  return benefit;
}

type TaskNameCleanupConfig = {
  role_prefixes?: string[];
  normalize_map?: { [key: string]: string };
};

function normalizeTaskName(rawTaskName: string, teamRole: string): string {
  if (!rawTaskName) return '';

  const cfg = task_name_cleanup as TaskNameCleanupConfig;
  let name = rawTaskName.trim();

  if (cfg.role_prefixes && cfg.role_prefixes.length) {
    for (const prefix of cfg.role_prefixes) {
      const re = new RegExp(`^${prefix}\\s+`, 'i');
      if (re.test(name) && prefix.toLowerCase() === teamRole.toLowerCase()) {
        name = name.replace(re, '');
        break;
      }
    }
  }

  if (cfg.normalize_map) {
    for (const [k, v] of Object.entries(cfg.normalize_map)) {
      const re = new RegExp(`\\b${k}\\b`, 'ig');
      name = name.replace(re, v);
    }
  }

  name = name
    .split(/\s+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ')
    .trim();

  return name;
}

// -----------------------------
// Company tail + connectors
// -----------------------------

function isGenericCompanyName(rawCompany: string, cfg: any): boolean {
  const name = (rawCompany || '').trim();
  if (!name) return true;

  const lower = name.toLowerCase();
  if (lower === 'generic') return true;

  const behavior = cfg?.behavior || {};
  const gd = behavior.generic_detection || {};
  const patterns = gd.treat_as_generic_if_matches_regex as string[] | undefined;

  if (Array.isArray(patterns)) {
    for (const pattern of patterns) {
      if (!pattern) continue;
      const re = new RegExp(pattern, 'i');
      if (re.test(name)) return true;
    }
  }

  return false;
}

function roleFamilyFromTeamRole(teamRole: string): 'design' | 'development' | 'content' {
  const r = (teamRole || '').toLowerCase();
  if (r.includes('develop')) return 'development';
  if (r.includes('content')) return 'content';
  return 'design';
}
function isTailAllowedForVariant(variant: any, row: PreparedRow): boolean {
  const family = roleFamilyFromTeamRole(row.team_role);

  const category = String(variant?.category || '').toLowerCase().trim();
  const template = String(variant?.template || '').toLowerCase();

  // Policy A: governance must come from lead patterns (objective_patterns), not from company tails.
  if (category === 'governance') return false;

  // Safety net: block governance wording even if the category is missing/mislabeled.
  // (Prevents silent leakage via uncategorized variants.)
  const governanceKeywords = /(\bgovernance\b|\benforc(e|ing)\b|\bstandards?\b|\breview\s+gates?\b|\bapproval\s+gates?\b)/i;
  if (governanceKeywords.test(template)) return false;

  // If the JSON explicitly says which families can use it, trust that first (optional future enhancement).
  const allowedFamilies = Array.isArray(variant?.allowed_role_families)
    ? (variant.allowed_role_families as string[]).map((s) => s.toLowerCase())
    : null;

  if (allowedFamilies && allowedFamilies.length) {
    return allowedFamilies.includes(family);
  }

  // Category-first filtering (enterprise control point).
  // Design/content must not get reliability/security tails.
  if (category) {
    const ALLOW: Record<string, Set<string>> = {
      design: new Set(['digital_cx', 'seo', 'delivery_efficiency']),
      content: new Set(['digital_cx', 'seo', 'delivery_efficiency']),
      development: new Set([
        'digital_cx',
        'seo',
        'delivery_efficiency',
        'reliability',
        'security'
      ])
    };

    const allowSet = ALLOW[family] || ALLOW.design;
    return allowSet.has(category);
  }

  // Fallback: keyword safety net for uncategorized templates.
  const devKeywords =
    /(uptime|availability|incident|mttr|latency|response\s*time|platform\s+stability|service\s+continuity|sla|reliab|security|vulnerab)/;

  if (family === 'design' || family === 'content') {
    return !devKeywords.test(template);
  }

  return true;
}


function selectTailRule(row: PreparedRow): any | null {
  const cfg = company_tail_rules as any;

  const buckets = cfg.buckets || {};
  const behavior = cfg.behavior || {};
  const selectionOrder: string[] = (behavior.selection_order as string[]) || Object.keys(buckets);
  const fallbackId: string =
    (behavior.fallback_bucket as string) ||
    (selectionOrder.length ? selectionOrder[selectionOrder.length - 1] : '');

  const rawCompany = (row.company || '').trim();
  const hasCompany = !!rawCompany;
  const isGeneric = isGenericCompanyName(rawCompany, cfg);

  const rawBenefit = row.strategic_benefit || '';
  const hasBenefit = !!rawBenefit.trim();
  const strategic = isStrategicBenefit(rawBenefit);

  let chosenBucket: any | undefined;

  for (const bucketId of selectionOrder) {
    const bucket = buckets[bucketId];
    if (!bucket) continue;

    const conditions = (bucket.conditions as any) || {};
    const condHasCompany = conditions.has_company as boolean | undefined;
    const condIsGeneric = conditions.company_is_generic as boolean | undefined;
    const condHasBenefit = conditions.has_benefit as boolean | undefined;
    const condIsStrategic = conditions.is_strategic as boolean | undefined;

    if (condHasCompany !== undefined && condHasCompany !== hasCompany) continue;
    if (condIsGeneric !== undefined && condIsGeneric !== isGeneric) continue;
    if (condHasBenefit !== undefined && condHasBenefit !== hasBenefit) continue;
    if (condIsStrategic !== undefined && condIsStrategic !== strategic) continue;

    chosenBucket = bucket;
    break;
  }

  if (!chosenBucket) {
    chosenBucket = (fallbackId && buckets[fallbackId]) || Object.values(buckets)[0];
  }

  if (!chosenBucket || !Array.isArray(chosenBucket.variants) || !chosenBucket.variants.length) {
    return null;
  }

  const variants = chosenBucket.variants as any[];

  // Role-family filtering to prevent tail leakage.
  const filtered = variants.filter((v) => isTailAllowedForVariant(v, row));

  // If nothing is allowed after filtering, return null to avoid role-family tail leakage.
  if (!filtered.length) return null;

  const selected = seededPick(
    row.variation_seed,
    `company_tail|${chosenBucket.id}|${roleFamilyFromTeamRole(row.team_role)}`,
    filtered
  );

  return selected;
}

function buildTailClause(row: PreparedRow, mode: 'simple' | 'complex'): string {
  if (mode === 'simple') {
    const rawCompany = (row.company || '').trim();
    const benefitTextCheck = applyBenefitTransform(row.strategic_benefit || '');
    if (!rawCompany && !benefitTextCheck) {
      return '';
    }
  }

  const tailRule = selectTailRule(row);
  if (!tailRule) return '';

  let tail = String((tailRule as any).template || '').trim();
  if (!tail) return '';

  const companyName = (row.company || 'the organization').trim();
  const benefitText = applyBenefitTransform(row.strategic_benefit || '');

  tail = tail.replace('{company}', companyName).replace('{benefit}', benefitText);

  const connectors = connector_rules as any[];
  if (Array.isArray(connectors) && connectors.length) {
    const connector = seededPick(
      row.variation_seed,
      `tail_connector|${row.team_role}|${row.task_type}`,
      connectors
    );

    if (connector && (connector as any).prefix) {
      const prefix = String((connector as any).prefix);
      tail = prefix + tail.replace(/^,\s*/, '');
      return tail;
    }
  }

  if (!/^[,;]/.test(tail[0])) {
    tail = ', ' + tail;
  }

  return tail;
}

// -----------------------------
// Regex + cleanup + humanization
// -----------------------------

function applyRegexRules(text: string): string {
  for (const rule of regex_rules as any[]) {
    if (!rule.pattern) continue;
    const flags = (rule.flags as string) || 'g';
    const re = new RegExp(rule.pattern as string, flags);
    text = text.replace(re, (rule.replacement as string) ?? '');
  }
  return text;
}

function applyCleanupRules(text: string): string {
  for (const rule of cleanup_rules as any[]) {
    if (!rule.pattern) continue;
    const flags = (rule.flags as string) || 'g';
    const re = new RegExp(rule.pattern as string, flags);
    text = text.replace(re, (rule.replacement as string) ?? '');
  }
  return text;
}

function applyHumanizationRules(text: string): string {
  for (const rule of humanization_rules as any[]) {
    if (!rule.pattern) continue;
    const flags = (rule.flags as string) || 'g';
    const re = new RegExp(rule.pattern as string, flags);
    text = text.replace(re, (rule.replacement as string) ?? '');
  }
  return text;
}

function postProcessObjective(text: string): string {
  let out = text.trim();

  out = applyRegexRules(out);
  out = applyCleanupRules(out);
  out = applyHumanizationRules(out);

  out = out.trim();
  if (!out.endsWith('.')) out += '.';
  out = out.replace(/\.\.+$/, '.');

  return out;
}
// -----------------------------
// Objective lint + repair (Phase 2.2)
// -----------------------------

function dedupeTailPhrases(text: string): string {
  const re = /(,\s*supporting\b[^.]*?)(\s*\1)+/gi;
  return text.replace(re, '$1');
}

function hasBaseline(text: string): boolean {
  // Baseline clause may be expressed in different rule-driven variants.
  // Keep this intentionally broad to avoid missing valid baselines.
  return /\b(measured\s+against|based\s+on|baseline)\b/i.test(text);
}

function repairDoubleConnectors(text: string): string {
  return text.replace(/\bwhile\b([^.]*)\bwhile\b/gi, 'while$1and');
}

// -----------------------------
// Helper types and functions for objective modes and strategic logic
// -----------------------------

type ObjectiveMode = 'simple' | 'complex';

function isLeadRole(teamRole: string): boolean {
  const lower = (teamRole || '').toLowerCase().trim();
  return /\blead\b/.test(lower);
}

function hasAllMetrics(row: PreparedRow): boolean {
  const out = (row.output_metric || '').trim();
  const qual = (row.quality_metric || '').trim();
  const imp = (row.improvement_metric || '').trim();
  return !!out && !!qual && !!imp;
}

function decideEffectiveMode(row: PreparedRow): ObjectiveMode {
  const forceComplex =
    isLeadRole(row.team_role) ||
    row.metrics_auto_suggested === true ||
    isStrategicBenefit(row.strategic_benefit) ||
    !hasAllMetrics(row);

  return forceComplex ? 'complex' : 'simple';
}


// -----------------------------
// Enterprise pattern selection + clause assembly (Phase 2)
// -----------------------------

type EnterpriseClauseKey =
  | 'deadline'
  | 'role_action'
  | 'performance'
  | 'quality'
  | 'improvement'
  | 'baseline'
  | 'governance'
  | 'risk_dependency'
  | 'collaboration'
  | 'company_tail';

function isEnterprisePattern(p: any): boolean {
  if (!p) return false;
  if (Array.isArray(p.clause_order) && p.clause_order.length) return true;
  const id = String(p.id || '');
  return id.startsWith('enterprise_');
}

function selectEnterprisePattern(row: PreparedRow, mode: ObjectiveMode): any | null {
  const patterns = objective_patterns as any[];

  const candidates = patterns.filter((p) => {
    if (!isEnterprisePattern(p)) return false;

    const okMode = !p.mode || p.mode === mode || p.mode === 'both';

    const okRole =
      !p.applicable_roles ||
      p.applicable_roles.length === 0 ||
      p.applicable_roles.includes(row.team_role);

    const okType =
      !p.applicable_task_types ||
      p.applicable_task_types.length === 0 ||
      p.applicable_task_types.includes(row.task_type);

    return okMode && okRole && okType;
  });

  return seededPick(
    row.variation_seed,
    `enterprise_pattern|${mode}|${row.team_role}|${row.task_type}`,
    candidates
  );
}

function ensureLeadingComma(text: string): string {
  const s = String(text || '').trim();
  if (!s) return '';
  if (/^[,;]/.test(s[0])) return s;
  return ', ' + s;
}


function toIsoDateOnly(candidate: string): string {
  const s = String(candidate || '').trim();
  if (!s) return '';

  // Accept YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // Accept full ISO and strip time: YYYY-MM-DDTHH:mm...
  const m = s.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (m) return m[1];

  // No guessing here: upstream normalization owns parsing.
  return '';
}

// v10.8: All date parsing/normalization must be handled upstream (normalizeFields).
// The engine only accepts ISO date-only (YYYY-MM-DD) or strips time if present.
function getObjectiveDeadline(row: PreparedRow): string {
  const anyRow = row as any;

  // v10.8 lock: objectiveEngine must not parse/guess date formats.
  // Upstream normalization (normalizeFields) must provide ISO date-only.
  const candidate = String(
    anyRow.dead_line_iso ||
      anyRow.dead_line_normalized ||
      row.dead_line ||
      ''
  ).trim();

  const iso = toIsoDateOnly(candidate);
  return iso || 'the agreed deadline';
}

function buildEnterpriseBaselineClause(row: PreparedRow, mode: ObjectiveMode): string {
  const explicit = String((row as any).base_line || (row as any).baseline || '').trim();
  if (explicit) return ensureLeadingComma(`measured against ${explicit}`);

  // Guard: if any metric already embeds baseline markers, do not add another baseline clause.
  if (mode === 'complex' && anyMetricContainsBaseline(row)) {
    return '';
  }

  const family = roleFamilyFromTeamRole(row.team_role);
  try {
    const cfg = (baseline_clause_rules as any)?.[mode]?.enterprise_defaults;
    const chosen = cfg?.[family];
    if (chosen) return ensureLeadingComma(String(chosen));
  } catch {
    // ignore
  }

  const variant = pickBaselineVariant(mode, row.variation_seed);
  if (variant) return ensureLeadingComma(variant);

  // Final fallback must be rules-driven (no hardcoded baseline text).
  // Expect baseline_clause_rules[mode].hard_fallback or baseline_clause_rules[mode].default to exist.
  const rules = baseline_clause_rules as any;
  const hardFallback = String(rules?.[mode]?.hard_fallback || rules?.[mode]?.default || '').trim();
  if (mode === 'complex' && hardFallback) return ensureLeadingComma(hardFallback);

  return '';
}

function buildEnterpriseMetricsClause(row: PreparedRow, mode: ObjectiveMode): string {
  const parts: string[] = [];
  if (row.output_metric) parts.push(row.output_metric);
  if (row.quality_metric) parts.push(row.quality_metric);
  if (row.improvement_metric) parts.push(row.improvement_metric);
  if (!parts.length) return '';

  let joined = '';
  if (parts.length === 1) joined = parts[0];
  else if (parts.length === 2) joined = parts.join(' and ');
  else joined = parts.slice(0, -1).join(', ') + ', and ' + parts[parts.length - 1];

  let connector = pickMetricsConnector(row, mode === 'simple' ? 'simple' : 'complex');

  // v10.8 grammar guard: if the metrics phrase starts with an imperative verb,
  // avoid connectors like "to achieve" and avoid "to Deliver" casing.
  if (startsWithImperativeVerb(joined)) {
    if (/\bto\s+achieve\b/i.test(connector)) connector = ' to ';
    return connector + lowerFirst(joined);
  }

  return connector + joined;
}
// Enterprise clause-order needs atomic metric clauses (performance/quality/improvement),
// not a single combined blob, otherwise clause_order cannot control grammar.
function buildEnterpriseMetricClauses(row: PreparedRow): {
  performance: string;
  quality: string;
  improvement: string;
} {
  const out = String(row.output_metric || '').trim();
  const qual = String(row.quality_metric || '').trim();
  const imp = String(row.improvement_metric || '').trim();

  let first = true;
  let performance = '';
  let quality = '';
  let improvement = '';

  // For enterprise clause-order, we still need atomic clauses,
  // but connectors must remain JSON-driven via pickMetricsConnector() to avoid hardcoded drift.
  if (out) {
    const cleaned = stripLeadingPunctuation(out);

    // Use the same connector logic as the legacy path (JSON-driven + seeded).
    const conn = pickMetricsConnector(row, 'complex');

    if (startsWithEnsure(cleaned)) {
      const body = stripLeadingEnsureVerb(cleaned);
      // Ensure connector matches “ensure” semantics.
      // If JSON is missing, pickMetricsConnector already falls back safely.
      if (String(conn).toLowerCase().includes('ensure')) {
        performance = body ? `${conn}${body}`.trim() : String(conn).trim();
      } else {
        performance = body ? `to ensure ${body}` : 'to ensure';
      }
    } else if (startsWithImperativeVerb(cleaned)) {
      // Imperative metrics should never get “to achieve”.
      // Connector should typically be “ to ”; we keep grammar by lowercasing the first letter.
      performance = `${conn}${lowerFirst(cleaned)}`.trim();
    } else {
      // Non-imperative metric phrases should use the default (non-imperative) connector bucket.
      // pickMetricsConnector(row,'complex') selects from JSON (default) and falls back safely.
      performance = `${conn}${cleaned}`.trim();
    }

    first = false;
  }

  if (qual) {
    const cleaned = stripLeadingPunctuation(qual);

    // If quality is the first (rare), use a complex connector to keep grammar consistent.
    if (first) {
      const conn = pickMetricsConnector(row, 'complex');
      const body = startsWithEnsure(cleaned) ? stripLeadingEnsureVerb(cleaned) : cleaned;

      if (String(conn).toLowerCase().includes('ensure')) {
        quality = body ? `${conn}${body}`.trim() : String(conn).trim();
      } else {
        quality = body ? `to ensure ${body}` : 'to ensure';
      }
    } else {
      // Subsequent quality clause should remain gerund form.
      quality = `ensuring ${startsWithEnsure(cleaned) ? stripLeadingEnsureVerb(cleaned) : cleaned}`;
    }

    first = false;
  }

  if (imp) {
    const cleaned = stripLeadingPunctuation(imp);

    // Enterprise grammar:
    // - If metric starts with an imperative verb (Reduce/Increase/Improve/Achieve...), use it directly.
    // - Otherwise fall back to a gerund form.
    if (first) {
      improvement = startsWithImperativeVerb(cleaned)
        ? `to ${lowerFirst(cleaned)}`
        : `to improve ${cleaned}`;
    } else {
      improvement = startsWithImperativeVerb(cleaned)
        ? `and ${lowerFirst(cleaned)}`
        : `and improving ${cleaned}`;
    }

    first = false;
  }

  return { performance, quality, improvement };
}

function buildEnterpriseIcRiskClause(row: PreparedRow): string {
  // v10.8: IC complex must NOT include governance or risk clauses.
  // Allow collaboration/coordination language only (execution-focused).
  const family = roleFamilyFromTeamRole(row.team_role);
  if (family === 'development') {
    return 'while coordinating with DevOps for release readiness and deployment alignment';
  }
  if (family === 'content') {
    return 'while coordinating cross-functional reviews with Product and Brand to ensure publishing alignment';
  }
  return 'while collaborating with Product and Development to ensure clear handoff and release alignment';
}

function buildEnterpriseLeadRiskClause(row: PreparedRow): string {
  const family = roleFamilyFromTeamRole(row.team_role);

  if (family === 'development') {
    return 'while managing cross-team dependencies, coordinating structured risk reviews, and ensuring timely escalation with DevOps and Architecture';
  }
  if (family === 'content') {
    return 'while managing cross-functional dependencies, coordinating structured reviews, and ensuring timely escalation with Product, Legal, and Brand';
  }
  return 'while managing cross-functional dependencies, coordinating stakeholder alignment with Product and Engineering, and reducing delivery risk through timely escalation';
}
function buildEnterpriseLeadGovernanceClause(row: PreparedRow, pattern: any): string {
  // Governance wording must be rules-driven. Prefer pattern-provided variants/templates.
  // Non-breaking: if the pattern does not provide governance text, return empty.
  const family = roleFamilyFromTeamRole(row.team_role);

  // Option A: pattern.governance_variants: string[]
  if (Array.isArray(pattern?.governance_variants) && pattern.governance_variants.length) {
    const picked = seededPick(
      row.variation_seed,
      `governance_variant|${family}|${row.team_role}|${row.task_type}`,
      pattern.governance_variants as string[]
    );
    return String(picked || '').trim();
  }

  // Option B: pattern.governance_by_family: { design?: string[]; development?: string[]; content?: string[] }
  const byFamily = pattern?.governance_by_family;
  const familyVariants = byFamily?.[family];
  if (Array.isArray(familyVariants) && familyVariants.length) {
    const picked = seededPick(
      row.variation_seed,
      `governance_family|${family}|${row.team_role}|${row.task_type}`,
      familyVariants as string[]
    );
    return String(picked || '').trim();
  }

  // Option C: pattern.governance_template: string
  if (typeof pattern?.governance_template === 'string' && pattern.governance_template.trim()) {
    return pattern.governance_template.trim();
  }

  return '';
}

function stripLeadingPunctuation(text: string): string {
  const s = String(text || '').trim();
  return s.replace(/^[,;]\s*/, '').trim();
}

function stripGovernanceRiskIfIC(text: string, row: PreparedRow): string {
  // Lead roles keep governance & risk by contract
  if (isLeadRole(row.team_role)) return text;

  let out = text;

  /**
   * 1) Remove full governance / risk clauses introduced by enterprise patterns
   *    These are always introduced with "while …"
   */
  const clausePatterns = [
    // enforcing governance / standards
    /,?\s*while\s+enforc(?:ing|e)[^,\.]*?(?=[,.])/gi,

    // structured risk reviews / RCA / escalation
    /,?\s*while\s+implementing\s+structured\s+risk[^,\.]*?(?=[,.])/gi,

    // dependency / escalation phrasing
    /,?\s*while\s+(managing|coordinating|resolving)[^,\.]*?(dependency|dependencies|escalation)[^,\.]*?(?=[,.])/gi,
  ];

  for (const re of clausePatterns) {
    out = out.replace(re, '');
  }

  /**
   * 2) Remove stray governance / risk keywords (safety net)
   *    Word-bounded to avoid damaging unrelated content
   */
  out = out.replace(
    /\b(governance|risk\s+reviews?|dependency\s+escalation|escalation|architecture\s+oversight|compliance\s+oversight)\b/gi,
    ''
  );

  /**
   * 3) Grammar repair
   *    Clean up punctuation after removals
   */
  out = out
    .replace(/\s{2,}/g, ' ')     // collapse spaces
    .replace(/\s+,/g, ',')       // space before comma
    .replace(/,\s*\./g, '.')     // ", ." → "."
    .replace(/,\s*,/g, ',')      // ", ,"
    .replace(/\s+\./g, '.')      // space before period
    .trim();

  return out;
}

function lintAndRepairObjective(
  objective: string,
  row: PreparedRow,
  mode: 'simple' | 'complex'
): string {
  let out = objective;

  // v10.8: IC complex must never include governance/risk language.
  out = stripGovernanceRiskIfIC(out, row);

  // 1) Deduplicate repeated tails
  out = dedupeTailPhrases(out);

  // 2) Ensure baseline exists in complex (enterprise requirement)
  if (mode === 'complex' && !hasBaseline(out)) {
    const baseline = buildEnterpriseBaselineClause(row, 'complex');
    if (baseline) out = out.replace(/\.$/, '') + baseline + '.';
  }

  // 3) Ensure lead complex has risk/dependency clause (fallback repair).
  // Governance wording must come from rules (no hardcoded governance injection).
  if (mode === 'complex' && isLeadRole(row.team_role)) {
    const hasRiskOnly =
      /\bdependency\b/i.test(out) ||
      /\brisk\b/i.test(out) ||
      /\bescalat(e|ion)\b/i.test(out);

    if (!hasRiskOnly) {
      const leadClause = ensureLeadingComma(buildEnterpriseLeadRiskClause(row));
      if (leadClause) out = out.replace(/\.$/, '') + leadClause + '.';
    }
  }

  // 4) Unsafe connector combos
  out = repairDoubleConnectors(out);

  // 5) Re-run cleanup/humanization to keep HR-grade tone
  out = postProcessObjective(out);

  return out;
}

function finalizeObjectiveText(objective: string): string {
  let s = String(objective || '');

  // Minimal trust fix: remove duplicate support phrase when pattern + tail collide
  s = s.replace(/\bin support of supporting\b/gi, 'in support of');
  // Grammar: avoid "Deliver scoped delivery of ..." duplication.
  s = s.replace(/\bDeliver\s+scoped\s+delivery\s+of\b/gi, 'Deliver scoped execution of');
  return s;
}

function assembleFromClauses(order: EnterpriseClauseKey[], clauses: Record<string, string>): string {
  const out: string[] = [];
  for (const k of order) {
    const t = String(clauses[k] || '').trim();
    if (t) out.push(t);
  }
  return out.join(' ');
}
function buildEnterpriseClauses(
  row: PreparedRow,
  mode: ObjectiveMode,
  pattern: any
): { clause_order: EnterpriseClauseKey[]; clauses: Record<string, string> } {
  const lead = isLeadRole(row.team_role);

  const deadline = getObjectiveDeadline(row);

  const normalizedTaskName = normalizeTaskName(row.task_name, row.team_role);
  const deliverable = `${normalizedTaskName} ${String(row.task_type || '').toLowerCase()}`.trim();

  const verbSlot = String(pattern?.verb_slot || 'deliver');
  const verb = selectVerb(row, verbSlot, mode);

  const metricClauses = buildEnterpriseMetricClauses(row);
  // v10.8 contract gate:
  // - SIMPLE: no baseline, no governance, no risk/dependency.
  // - COMPLEX: baseline required; lead roles may include governance + risk/dependency.
  const baselineClause = mode === 'complex' ? buildEnterpriseBaselineClause(row, mode) : '';

  let tailClause = buildTailClause(row, mode);
  if (mode === 'complex' && !tailClause) tailClause = '';

  const riskClause =
    mode === 'complex' && lead ? ensureLeadingComma(buildEnterpriseLeadRiskClause(row)) : '';

  // Governance wording must be rules-driven (pattern/rules file). No hardcoded governance text here.
  const governanceClause =
    mode === 'complex' && lead ? buildEnterpriseLeadGovernanceClause(row, pattern) : '';

  // Keep these “atomic” so clause_order controls grammar.
  const clauses: Record<string, string> = {
    deadline: `By ${deadline},`,
    role_action: `${row.team_role} ${verb} ${deliverable}`,
    performance: metricClauses.performance,
    quality: metricClauses.quality,
    improvement: metricClauses.improvement,
    baseline: baselineClause,
    governance: mode === 'complex' ? ensureLeadingComma(stripLeadingPunctuation(governanceClause)) : '',
    risk_dependency: mode === 'complex' && lead ? riskClause : '',
    collaboration: '', // optional if you later separate collaboration vs risk
    company_tail: tailClause
  };

  const clause_order = (pattern?.clause_order || []) as EnterpriseClauseKey[];
  return { clause_order, clauses };
}
// -----------------------------
// Variation rules (micro-variation)
// -----------------------------

function applyVariationRules(
  text: string,
  row: PreparedRow,
  mode: 'simple' | 'complex'
): string {
  for (const rule of variation_rules as any[]) {
    const slotId = rule.slot_id as string | undefined;
    if (!slotId) continue;

    const variants = rule.variants as string[] | undefined;
    if (!variants || variants.length === 0) continue;

    const chosen = seededPick(row.variation_seed, `variation|${slotId}|${mode}`, variants);
    if (!chosen) continue;

    const placeholder = new RegExp(`\\{${slotId}\\}`, 'g');
    text = text.replace(placeholder, chosen);
  }
  return text;
}
// -----------------------------
// Main builders
// -----------------------------

function getMetricsConnectorVariants(mode: 'simple' | 'complex', kind: 'default' | 'imperative'): string[] {
  const cfg = metrics_connector_rules as any;
  const root = cfg?.metrics_connectors;
  if (!root) return [];

  if (mode === 'simple') {
    const simple = root.simple;
    return Array.isArray(simple) ? simple : [];
  }

  // complex
  const complex = root.complex;
  if (!complex) return [];

  const arr = kind === 'imperative' ? complex.imperative : complex.default;
  return Array.isArray(arr) ? arr : [];
}

function pickMetricsConnector(row: PreparedRow, mode: 'simple' | 'complex'): string {
  // SIMPLE always uses JSON-driven connectors (default to " with " if config missing)
  if (mode === 'simple') {
    const variants = getMetricsConnectorVariants('simple', 'default');
    const picked = seededPick(row.variation_seed, `metrics_connector|simple|${row.team_role}|${row.task_type}`, variants);
    return (picked as any) || ' with ';
  }

  // COMPLEX: imperative metrics must not get "to achieve".
  const out = String(row.output_metric || '').trim();
  const isImperative = !!out && startsWithImperativeVerb(out);

  const kind: 'default' | 'imperative' = isImperative ? 'imperative' : 'default';
  const variants = getMetricsConnectorVariants('complex', kind);

  // v10.8: If JSON is missing, fall back to a minimal safe connector.
  // We intentionally avoid hardcoding "to achieve" to prevent "to achieve Achieve ..." duplication.
  if (!variants.length) {
    if (isImperative) return startsWithEnsure(out) ? ' to ensure ' : ' to ';
    return ' to ';
  }

  // For imperative, allow JSON to contain both " to " and " to ensure ".
  // Enforce ensure-selection when output starts with Ensure.
  if (kind === 'imperative' && startsWithEnsure(out)) {
    const ensureCandidates = variants.filter((v) => String(v).toLowerCase().includes('ensure'));
    const ensurePicked = seededPick(
      row.variation_seed,
      `metrics_connector|complex|imperative|ensure|${row.team_role}|${row.task_type}`,
      ensureCandidates
    );
    if (ensurePicked) return String(ensurePicked);
  }

  const picked = seededPick(
    row.variation_seed,
    `metrics_connector|complex|${kind}|${row.team_role}|${row.task_type}`,
    variants
  );
  // v10.8 safety: if the imperative bucket accidentally contains "to achieve",
  // force a safe connector to prevent "to achieve Deliver/Provide".
  if (kind === 'imperative' && picked && /\bto\s+achieve\b/i.test(String(picked))) {
    return startsWithEnsure(out) ? ' to ensure ' : ' to ';
  }
  return (picked as any) || (isImperative ? (startsWithEnsure(out) ? ' to ensure ' : ' to ') : ' to ');
}

function buildObjectiveInternal(row: PreparedRow, _requestedMode: 'simple' | 'complex'): string {
  // Contract: never generate objective text for invalid rows.
  const anyRow = row as any;
  if (anyRow.isValid === false || (typeof anyRow.invalidReason === 'string' && anyRow.invalidReason.trim())) {
    return '';
  }
  // --- v10.8 mode guard (engine-owned mode) ---
  // Even if a caller requests "simple", the engine must enforce the contract.
  const contractMode: ObjectiveMode = decideEffectiveMode(row);
  const effectiveMode: ObjectiveMode = contractMode;

  const deadline = getObjectiveDeadline(row);

  // Enterprise patterns are optional; schema stays backward compatible.
  const enterprisePattern = selectEnterprisePattern(row, effectiveMode);

  // Decide: if an enterprise pattern exists, use it; otherwise fallback to legacy patterns.
  const shouldUseEnterprise = !!enterprisePattern;

  // --- Enterprise clause-order path (preferred when available) ---
    if (
    shouldUseEnterprise &&
    Array.isArray((enterprisePattern as any).clause_order) &&
    (enterprisePattern as any).clause_order.length
  ) {
    const { clause_order, clauses } = buildEnterpriseClauses(row, effectiveMode, enterprisePattern);

    let objective = assembleFromClauses(clause_order, clauses);

    // Variations must be keyed by the enforced mode (not the requested one).
    objective = applyVariationRules(objective, row, effectiveMode);
    objective = postProcessObjective(objective);

    // Lint/repair must use the enforced mode.
    objective = lintAndRepairObjective(objective, row, effectiveMode);
    objective = finalizeObjectiveText(objective);

    return objective;
  }

  // --- Legacy pattern path (backward compatible) ---
  const pattern = shouldUseEnterprise ? enterprisePattern : selectPattern(row, effectiveMode);

  const normalizedTaskName = normalizeTaskName(row.task_name, row.team_role);
  const deliverable = `${normalizedTaskName} ${String(row.task_type || '').toLowerCase()}`.trim();

  const verbSlot = (pattern && (pattern as any).verb_slot) || 'deliver';
  const verb = selectVerb(row, verbSlot, effectiveMode);

  const metricsClause = shouldUseEnterprise
    ? buildEnterpriseMetricsClause(row, effectiveMode)
    : buildMetricsClause(row, effectiveMode);

  const baselineClause =
  effectiveMode === 'complex'
    ? buildEnterpriseBaselineClause(row, effectiveMode) // or a renamed “buildBaselineClauseV108”
    : '';

  let tailClause = buildTailClause(row, effectiveMode);
  if (shouldUseEnterprise && effectiveMode === 'complex' && !tailClause) {
    tailClause = '';
  }
  if (shouldUseEnterprise && effectiveMode === 'complex') {
    tailClause = dedupeTailPhrases(tailClause);
  }

  const lead = isLeadRole(row.team_role);

// v10.8 strict gate: SIMPLE must never include governance/risk clauses.
const ic_risk_clause =
  effectiveMode === 'complex' && !lead
    ? ensureLeadingComma(stripLeadingPunctuation(buildEnterpriseIcRiskClause(row)))
    : '';

const lead_risk_clause =
  effectiveMode === 'complex' && lead
    ? ensureLeadingComma(stripLeadingPunctuation(buildEnterpriseLeadRiskClause(row)))
    : '';

const governance_clause =
  effectiveMode === 'complex' && lead
    ? ensureLeadingComma(stripLeadingPunctuation(buildEnterpriseLeadGovernanceClause(row, pattern)))
    : '';

  let template: string;
  if (pattern && typeof (pattern as any).template === 'string') {
    template = (pattern as any).template as string;
  } else {
    template = '{verb} the {deliverable} by {deadline}{metrics_clause}{tail_clause}';
  }

  let objective = template
    .replace('{verb}', verb)
    .replace('{deliverable}', deliverable)
    .replace('{deadline}', deadline)
    .replace('{metrics_clause}', metricsClause)
    .replace('{baseline_clause}', baselineClause)
    .replace('{tail_clause}', tailClause)
    .replace('{governance_clause}', governance_clause)
    .replace('{ic_risk_clause}', ic_risk_clause)
    .replace('{lead_risk_clause}', lead_risk_clause);

  // v10.8/v11 baseline contract:
  // - SIMPLE: never include baseline
  // - COMPLEX: include baseline at most once
  // Some legacy templates do not include {baseline_clause}; inject baselineClause once (before tail) when needed.
  if (effectiveMode === 'complex' && baselineClause && !containsBaselineMarker(objective)) {
    const templateHasBaseline = template.includes('{baseline_clause}');
    if (!templateHasBaseline) {
      const tail = String(tailClause || '');
      if (tail && objective.includes(tail)) {
        objective = objective.replace(tail, `${baselineClause}${tail}`);
      } else {
        objective = objective.replace(/\.$/, '') + baselineClause;
      }
    }
  }

  // Ensure SIMPLE never leaks baseline even if a legacy template contains {baseline_clause}.
  if (effectiveMode === 'simple') {
    objective = objective.replace(/\s*,\s*(measured\s+against|based\s+on)[^,.]*?(?=[,.])/gi, '');
  }

  objective = applyVariationRules(objective, row, effectiveMode);
  objective = postProcessObjective(objective);

  objective = lintAndRepairObjective(objective, row, effectiveMode);
  objective = finalizeObjectiveText(objective);

  return objective;
}

export function buildSimpleObjective(row: PreparedRow): string {
  return buildObjectiveInternal(row, 'simple');
}

export function buildComplexObjective(row: PreparedRow): string {
  return buildObjectiveInternal(row, 'complex');
}

export function buildObjectivesForRow(row: PreparedRow): ObjectiveOutput {
  // Contract: INVALID rows must never have objectives.
  // Upstream validators set `isValid` / `invalidReason` on PreparedRow for bulk flows.
  // For safety, treat any explicit invalid signal as a hard stop.
  const anyRow = row as any;
  if (anyRow.isValid === false || (typeof anyRow.invalidReason === 'string' && anyRow.invalidReason.trim())) {
    return {
      row_id: row.row_id,
      simple_objective: '',
      complex_objective: ''
    };
  }
  const effectiveMode = decideEffectiveMode(row);

  let simple = '';
  let complex = '';

  if (effectiveMode === 'simple') {
    simple = buildSimpleObjective(row);
  } else {
    complex = buildComplexObjective(row);
  }

  return {
    row_id: row.row_id,
    simple_objective: simple,
    complex_objective: complex
  };
}

export function runObjectiveEngine(rows: PreparedRow[]): ObjectiveOutput[] {
  return rows.map(buildObjectivesForRow);
}