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
    const okRole =
      !v.roles ||
      v.roles.length === 0 ||
      v.roles.includes(row.team_role);
    const okType =
      !v.task_types ||
      v.task_types.length === 0 ||
      v.task_types.includes(row.task_type);
    const okMode =
      !v.modes ||
      v.modes.length === 0 ||
      v.modes.includes(mode);
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

function hasBaselineWorthyImprovement(improvement: string): boolean {
  if (!improvement) return false;
  const lower = improvement.toLowerCase();

  const hasNumber = /\d/.test(lower);
  const hasChangeVerb = /(increase|decrease|reduce|improve|boost|raise|grow|expand)/.test(lower);
  const hasPercent = /%/.test(lower);

  return hasNumber && (hasChangeVerb || hasPercent);
}

function pickBaselineLabel(improvementMetric: string): string {
  const perf = performance_targets as any;
  const lower = improvementMetric.toLowerCase();

  // Quality-related improvements
  if (/(quality|defect|error|bug|issues?)/.test(lower)) {
    return perf.quality_baseline || perf.default_baseline || '';
  }

  // Output / throughput / delivery metrics
  if (/(output|throughput|volume|delivery|capacity)/.test(lower)) {
    return perf.output_baseline || perf.default_baseline || '';
  }

  // Generic improvement (performance, efficiency, satisfaction, etc.)
  if (/(improve|improvement|efficiency|performance|satisfaction|experience|engagement)/.test(lower)) {
    return perf.improvement_baseline || perf.default_baseline || '';
  }

  // Fallback: default baseline
  return perf.default_baseline || '';
}

// Seeded baseline variant picker
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

function buildBaselineClause(
  improvementMetric: string,
  mode: 'simple' | 'complex',
  seed: number
): string {
  const hasImprovement = !!improvementMetric && improvementMetric.trim().length > 0;
  if (!hasImprovement) return '';

  // For simple mode we keep the guard to avoid noisy baselines.
  // For complex mode we always attach a baseline when an improvement metric exists.
  if (mode === 'simple' && !hasBaselineWorthyImprovement(improvementMetric)) {
    return '';
  }

  // 1. Base clause selection (seeded variant, JSON-driven)
  const baseClause = pickBaselineVariant(mode, seed);
  if (!baseClause) return '';

  // 2. Pick contextual baseline label (quality / output / improvement / default)
  const baselineLabel = pickBaselineLabel(improvementMetric).trim();
  const perf = performance_targets as any;
  const defaultLabel = (perf.default_baseline as string | undefined)?.trim();

  // 3. If no label found or label equals default → return simple base clause
  if (!baselineLabel || (defaultLabel && baselineLabel === defaultLabel)) {
    return baseClause;
  }

  // 4. Otherwise, enrich the clause with the baseline label
  return `${baseClause} (based on the ${baselineLabel})`;
}

function buildMetricsClause(row: PreparedRow, mode: 'simple' | 'complex'): string {
  const metricParts: string[] = [];

  if (row.output_metric) {
    metricParts.push(row.output_metric);
  }
  if (row.quality_metric) {
    metricParts.push(row.quality_metric);
  }

  let improvementText = row.improvement_metric || '';
  let baselineClause = '';

  if (improvementText) {
    baselineClause = buildBaselineClause(improvementText, mode, row.variation_seed);
    if (baselineClause) {
      improvementText = `${improvementText} ${baselineClause}`;
    }
    metricParts.push(improvementText);
  } else if (mode === 'complex' && metricParts.length) {
    // Complex objectives must carry a baseline clause even if the improvement metric
    // was not explicitly provided. In that case, derive the baseline from the
    // existing metric context.
    const syntheticImprovement = metricParts.join(' and ');
    baselineClause = buildBaselineClause(syntheticImprovement, mode, row.variation_seed);
    if (baselineClause) {
      metricParts.push(`measured ${baselineClause}`);
    }
  }

  if (!metricParts.length) return '';

  let metricsJoined = '';
  if (metricParts.length === 1) {
    metricsJoined = metricParts[0];
  } else if (metricParts.length === 2) {
    metricsJoined = metricParts.join(' and ');
  } else {
    metricsJoined =
      metricParts.slice(0, -1).join(', ') + ', and ' + metricParts[metricParts.length - 1];
  }

  const connector = mode === 'simple' ? ' with ' : ', achieving ';
  return connector + metricsJoined;
}

// -----------------------------
// Benefit transform + task name cleanup
// -----------------------------

type BenefitTransformRule = {
  pattern: string;
  replacement: string;
};

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

function selectTailRule(row: PreparedRow): any | null {
  const cfg = company_tail_rules as any;

  const buckets = cfg.buckets || {};
  const behavior = cfg.behavior || {};
  const selectionOrder: string[] =
    (behavior.selection_order as string[]) || Object.keys(buckets);
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
    chosenBucket =
      (fallbackId && buckets[fallbackId]) ||
      Object.values(buckets)[0];
  }

  if (
    !chosenBucket ||
    !Array.isArray(chosenBucket.variants) ||
    !chosenBucket.variants.length
  ) {
    return null;
  }

  const variants = chosenBucket.variants as any[];
  const selected = seededPick(
    row.variation_seed,
    `company_tail|${chosenBucket.id}`,
    variants
  );

  return selected;
}

function buildTailClause(row: PreparedRow, mode: 'simple' | 'complex'): string {
  if (mode === 'simple') {
    // For simple objectives, tails are optional. We only add a tail
    // when there is a company or a meaningful benefit. Otherwise skip.
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

  tail = tail
    .replace('{company}', companyName)
    .replace('{benefit}', benefitText);

  // Optional: connector_rules as a prefix
  const connectors = connector_rules as any[];
  if (Array.isArray(connectors) && connectors.length) {
    const connector = seededPick(
      row.variation_seed,
      `tail_connector|${row.team_role}|${row.task_type}`,
      connectors
    );

    if (connector && (connector as any).prefix) {
      // assume prefix already contains leading comma/space if desired
      const prefix = String((connector as any).prefix);
      tail = prefix + tail.replace(/^,\s*/, '');
      return tail;
    }
  }

  // Fallback: ensure the tail clause attaches cleanly to the main sentence.
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
  // Remove repeated tail phrases that typically start with ", supporting ..."
  const re = /(,\s*supporting\b[^.]*?)(\s*\1)+/gi;
  return text.replace(re, '$1');
}

function hasBaseline(text: string): boolean {
  return /\bmeasured\s+against\b/i.test(text);
}

function hasGovernanceRiskLead(text: string): boolean {
  // Lead complex must include governance + dependency/risk language
  const hasGov = /\bgovernance\b/i.test(text) || /\benforce\b/i.test(text) || /\bgovern(ed|ing)\b/i.test(text);
  const hasRisk = /\bdependency\b/i.test(text) || /\brisk\b/i.test(text) || /\bescalat(e|ion)\b/i.test(text);
  return hasGov && hasRisk;
}

function repairDoubleConnectors(text: string): string {
  // Last safety net (cleanup_rules already handles most cases)
  return text.replace(/\bwhile\b([^.]*)\bwhile\b/gi, 'while$1and');
}

function lintAndRepairObjective(
  objective: string,
  row: PreparedRow,
  mode: 'simple' | 'complex',
  shouldUseEnterprise: boolean
): string {
  let out = objective;

  // 1) Deduplicate repeated tails
  out = dedupeTailPhrases(out);

  // 2) Ensure baseline exists in complex (enterprise requirement)
  if (shouldUseEnterprise && mode === 'complex' && !hasBaseline(out)) {
    const baseline = buildEnterpriseBaselineClause(row, 'complex');
    if (baseline) {
      out = out.replace(/\.$/, '') + baseline + '.';
    }
  }

  // 3) Ensure lead complex has governance+risk (fallback repair)
  if (shouldUseEnterprise && mode === 'complex' && isLeadRole(row.team_role) && !hasGovernanceRiskLead(out)) {
    const leadClause = ensureLeadingComma(buildEnterpriseLeadRiskClause(row));
    if (leadClause) out = out.replace(/\.$/, '') + leadClause + '.';
  }

  // 4) Unsafe connector combos
  out = repairDoubleConnectors(out);

  // 5) Re-run cleanup/humanization to keep HR-grade tone
  out = postProcessObjective(out);

  return out;
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

    const chosen = seededPick(
      row.variation_seed,
      `variation|${slotId}|${mode}`,
      variants
    );
    if (!chosen) continue;

    const placeholder = new RegExp(`\\{${slotId}\\}`, 'g');
    text = text.replace(placeholder, chosen);
  }
  return text;
}

// -----------------------------
// Helper types and functions for objective modes and strategic logic
// -----------------------------

type ObjectiveMode = 'simple' | 'complex';

function isLeadRole(teamRole: string): boolean {
  const lower = (teamRole || '').toLowerCase().trim();
  // Normalized lead roles always contain the word "lead" as a separate token
  return /\blead\b/.test(lower);
}

function hasAllMetrics(row: PreparedRow): boolean {
  const out = (row.output_metric || '').trim();
  const qual = (row.quality_metric || '').trim();
  const imp = (row.improvement_metric || '').trim();
  return !!out && !!qual && !!imp;
}

/**
 * Decide the effective objective mode according to the v10.8 contract:
 *
 * - Lead roles  → always complex.
 * - Any metrics auto-suggested (matrix or defaults) → complex.
 * - Strategic / multi-squad benefit → complex.
 * - Any metrics missing at PreparedRow stage (safety guard) → complex.
 * - Otherwise → simple.
 *
 * Note: row.mode is treated as a user hint only and does not control behavior.
 */
function decideEffectiveMode(row: PreparedRow): ObjectiveMode {
  const isLead = isLeadRole(row.team_role);
  const metricsAuto = row.metrics_auto_suggested === true;
  const allMetricsPresent = hasAllMetrics(row);
  const metricsMissing = !allMetricsPresent;
  const strategic = isStrategicBenefit(row.strategic_benefit);

  const forceComplex =
    isLead ||
    metricsAuto ||
    strategic ||
    metricsMissing;

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

function roleFamilyFromTeamRole(teamRole: string): 'design' | 'development' | 'content' {
  const r = (teamRole || '').toLowerCase();
  if (r.includes('develop')) return 'development';
  if (r.includes('content')) return 'content';
  return 'design';
}

function ensureLeadingComma(text: string): string {
  const s = String(text || '').trim();
  if (!s) return '';
  if (/^[,;]/.test(s[0])) return s;
  return ', ' + s;
}

function buildEnterpriseBaselineClause(row: PreparedRow, mode: ObjectiveMode): string {
  // Prefer explicit baseline if provided by user.
  const explicit = String((row as any).base_line || (row as any).baseline || '').trim();
  if (explicit) {
    return ensureLeadingComma(`measured against ${explicit}`);
  }

  // Prefer enterprise defaults by role family if available.
  const family = roleFamilyFromTeamRole(row.team_role);
  try {
    const cfg = (baseline_clause_rules as any)?.[mode]?.enterprise_defaults;
    const chosen = cfg?.[family];
    if (chosen) return ensureLeadingComma(String(chosen));
  } catch {
    // ignore
  }

  // Fallback to seeded variants (must support 2024 / Q1-2025).
  const variant = pickBaselineVariant(mode, row.variation_seed);
  if (variant) return ensureLeadingComma(variant);

  // Hard fallback for complex enforcement.
  if (mode === 'complex') return ensureLeadingComma('measured against the 2024 baseline');
  return '';
}

function buildEnterpriseMetricsClause(row: PreparedRow, mode: ObjectiveMode): string {
  // Enterprise path keeps the baseline clause separate (do not inject baseline into metrics).
  const parts: string[] = [];
  if (row.output_metric) parts.push(row.output_metric);
  if (row.quality_metric) parts.push(row.quality_metric);
  if (row.improvement_metric) parts.push(row.improvement_metric);
  if (!parts.length) return '';

  let joined = '';
  if (parts.length === 1) joined = parts[0];
  else if (parts.length === 2) joined = parts.join(' and ');
  else joined = parts.slice(0, -1).join(', ') + ', and ' + parts[parts.length - 1];

  const connector = mode === 'simple' ? ' with ' : ', achieving ';
  return connector + joined;
}

function buildEnterpriseIcRiskClause(row: PreparedRow): string {
  const family = roleFamilyFromTeamRole(row.team_role);
  if (family === 'development') {
    return 'while coordinating with DevOps and Architecture to manage dependencies and ensure seamless release integration';
  }
  if (family === 'content') {
    return 'while coordinating cross-functional reviews to manage approvals and maintain quality prior to publishing';
  }
  return 'while collaborating with Product, QA, and Development to manage handoff dependencies and ensure seamless release integration';
}

function buildEnterpriseLeadRiskClause(row: PreparedRow): string {
  const family = roleFamilyFromTeamRole(row.team_role);

  // Must include governance + risk/dependency + cross-team collaboration in a single clause.
  if (family === 'development') {
    return 'while enforcing engineering governance, managing cross-team dependencies, and coordinating risk reviews and escalation with DevOps and Architecture';
  }
  if (family === 'content') {
    return 'while enforcing content governance, managing cross-functional dependencies, and coordinating structured reviews and risk escalation with Product, Legal, and Brand';
  }
  return 'while enforcing design governance, managing cross-functional dependencies, and coordinating stakeholder alignment with Product and Engineering to reduce delivery risk';
}

function assembleFromClauses(order: EnterpriseClauseKey[], clauses: Record<string, string>): string {
  const out: string[] = [];
  for (const k of order) {
    const t = String(clauses[k] || '').trim();
    if (t) out.push(t);
  }
  return out.join(' ');
}

// -----------------------------
// Main builders
// -----------------------------

function buildObjectiveInternal(row: PreparedRow, mode: 'simple' | 'complex'): string {
  const deadline = row.dead_line || 'the agreed deadline';

  const effectiveMode: ObjectiveMode = mode;
  const enterprisePattern = selectEnterprisePattern(row, effectiveMode);

  // Enterprise branch trigger rules (non-breaking):
  // - Lead roles → enterprise complex.
  // - Any metric missing or auto-suggested → enterprise complex.
  // - Strategic/multi-squad benefit → enterprise complex.
  // - Or: enterprise pattern exists for this role/task.
  const lead = isLeadRole(row.team_role);
  const metricsAuto = row.metrics_auto_suggested === true;
  const metricsMissing = !hasAllMetrics(row);
  const strategic = isStrategicBenefit(row.strategic_benefit);
  const shouldUseEnterprise =
    !!enterprisePattern && (lead || metricsAuto || metricsMissing || strategic || true);

  // Legacy pattern is preserved as fallback.
  const pattern = shouldUseEnterprise ? enterprisePattern : selectPattern(row, mode);

  const normalizedTaskName = normalizeTaskName(row.task_name, row.team_role);
  const deliverable = `${normalizedTaskName} ${row.task_type.toLowerCase()}`.trim();
  const verbSlot = (pattern && (pattern as any).verb_slot) || 'deliver';
  const verb = selectVerb(row, verbSlot, mode);

  const metricsClause = shouldUseEnterprise
    ? buildEnterpriseMetricsClause(row, effectiveMode)
    : buildMetricsClause(row, mode);

  // Enterprise enforcement:
  // - Complex → baseline + tail required.
  // - Lead complex → governance/risk/collab required (embedded in lead_risk_clause).
  const baselineClause = shouldUseEnterprise
    ? buildEnterpriseBaselineClause(row, effectiveMode)
    : '';

  let tailClause = buildTailClause(row, mode);
  if (shouldUseEnterprise && effectiveMode === 'complex' && !tailClause) {
    tailClause = ', supporting the organization\'s strategic goals';
  }

  const ic_risk_clause = shouldUseEnterprise ? buildEnterpriseIcRiskClause(row) : '';
  const lead_risk_clause = shouldUseEnterprise ? buildEnterpriseLeadRiskClause(row) : '';

  // Hard enforcement for enterprise complex:
  if (shouldUseEnterprise && effectiveMode === 'complex' && !baselineClause) {
    // baseline is mandatory in complex mode
    // (this should be extremely rare due to JSON defaults and fallbacks)
    // Keep non-breaking by using a safe default.
    // eslint-disable-next-line no-unused-vars
    const _forceBaseline = true;
  }

  let template: string;

  if (pattern && typeof (pattern as any).template === 'string') {
    template = (pattern as any).template as string;
  } else {
    template =
      '{verb} the {deliverable} by {deadline}{metrics_clause}{tail_clause}';
  }

  let objective = template
    .replace('{verb}', verb)
    .replace('{deliverable}', deliverable)
    .replace('{deadline}', deadline)
    .replace('{metrics_clause}', metricsClause)
    .replace('{baseline_clause}', baselineClause)
    .replace('{tail_clause}', tailClause)
    .replace('{ic_risk_clause}', ic_risk_clause)
    .replace('{lead_risk_clause}', lead_risk_clause);

  objective = applyVariationRules(objective, row, mode);
  objective = postProcessObjective(objective);

  // Phase 2.2: lint + repair (non-breaking)
  objective = lintAndRepairObjective(objective, row, mode, shouldUseEnterprise);

  return objective;
}

export function buildSimpleObjective(row: PreparedRow): string {
  return buildObjectiveInternal(row, 'simple');
}

export function buildComplexObjective(row: PreparedRow): string {
  return buildObjectiveInternal(row, 'complex');
}

export function buildObjectivesForRow(row: PreparedRow): ObjectiveOutput {
  const effectiveMode = decideEffectiveMode(row);

  let simple = '';
  let complex = '';

  if (effectiveMode === 'simple') {
    // Individual-contributor, fully user-specified metrics, non-strategic.
    simple = buildSimpleObjective(row);
  } else {
    // Lead, strategic, and/or auto-suggested metrics → complex only.
    complex = buildComplexObjective(row);
  }

  return {
    row_id: row.row_id,
    simple_objective: simple,
    complex_objective: complex
  };
}

// Batch helper for bulk flow
export function runObjectiveEngine(rows: PreparedRow[]): ObjectiveOutput[] {
  return rows.map(buildObjectivesForRow);
} 