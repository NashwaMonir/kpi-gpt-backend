// engine/objectiveEngine.ts
//
// Seed-driven objective generation for SMART KPI Engine.

import objective_patterns from '../data/objective_patterns.json';
import verb_pool from '../data/verb_pool.json';
import connector_rules from '../data/connector_rules.json';
import variation_rules from '../data/variation_rules.json';
import cleanup_rules from '../data/cleanup_rules.json';
import humanization_rules from '../data/humanization_rules.json';
import baseline_clause_rules from '../data/baseline_clause_rules.json';
import regex_rules from '../data/regex_rules.json';
import performance_targets from '../data/performance_targets.json';
import company_tail_rules from '../data/company_tail_rules.json';
import role_metric_matrix from '../data/role_metric_matrix.json';
import error_map from '../data/error_map.json';

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
  const candidates = (objective_patterns as any[]).filter((p) => {
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

  return seededPick(row.variation_seed, `pattern|${mode}`, candidates);
}

function selectVerb(
  row: PreparedRow,
  verbSlot: string,
  mode: 'simple' | 'complex'
): string {
  const candidates = (verb_pool as any[]).filter((v) => {
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

  const chosen = seededPick(row.variation_seed, `verb|${verbSlot}|${mode}`, candidates);
  return (chosen as any)?.text || 'Deliver';
}

// -----------------------------
// Metrics + baseline + targets
// -----------------------------

function selectBaselineRule(
  row: PreparedRow,
  presentMetrics: string[],
  mode: 'simple' | 'complex'
): any | null {
  const rules = (baseline_clause_rules as any[]).filter((r) => {
    const ruleMode = (r.mode as string | undefined) || 'both';
    const okMode =
      ruleMode === 'both' ||
      ruleMode === mode;

    if (!okMode) return false;

    const scope = r.metric_scope as string[] | undefined;
    if (!scope || scope.length === 0) {
      return true;
    }

    if (scope.includes('any')) {
      return true;
    }

    return presentMetrics.length > 0;
  });

  if (!rules.length) return null;

  return seededPick(row.variation_seed, `baseline|${mode}`, rules);
}

function buildBaselineClause(
  row: PreparedRow,
  presentMetrics: string[],
  mode: 'simple' | 'complex'
): string {
  const rule = selectBaselineRule(row, presentMetrics, mode);
  if (!rule) return '';

  let template = String((rule as any).template || '').trim();
  if (!template) return '';

  const metricsString = presentMetrics.join(', and ');

  let targetText = '';
  const targetKey = (rule as any).target_key as string | undefined;
  if (targetKey) {
    const targetsDict = performance_targets as any;
    if (targetsDict && typeof targetsDict[targetKey] === 'string') {
      targetText = String(targetsDict[targetKey]);
    }
  }

  let clause = template;
  clause = clause.replace('{metrics}', metricsString);
  clause = clause.replace('{target}', targetText);

  clause = clause.trim();
  if (!clause) return '';

  return ' ' + clause;
}

function buildMetricsClause(row: PreparedRow, mode: 'simple' | 'complex'): string {
  const metrics: string[] = [];

  if (row.output_metric) metrics.push(row.output_metric);
  if (row.quality_metric) metrics.push(row.quality_metric);
  if (row.improvement_metric) metrics.push(row.improvement_metric);

  if (!metrics.length) return '';

  const baselineClause = buildBaselineClause(row, metrics, mode);
  const connector = mode === 'simple' ? ' with ' : ', achieving ';

  return connector + metrics.join(', and ') + baselineClause;
}

// -----------------------------
// Company tail + connectors
// -----------------------------

function selectTailRule(row: PreparedRow): any | null {
  const rules = (company_tail_rules as any[]).filter((r) => {
    const okCompany =
      !r.company ||
      !row.company ||
      r.company.toLowerCase() === row.company.toLowerCase();

    const okRole =
      !r.roles ||
      r.roles.length === 0 ||
      r.roles.includes(row.team_role);

    return okCompany && okRole;
  });

  return seededPick(row.variation_seed, 'tail_rule', rules);
}

function buildTailClause(row: PreparedRow): string {
  const tailRule = selectTailRule(row);
  if (!tailRule) {
    if (!row.strategic_benefit) return '';
    const companyName = row.company || 'the organization';
    return `, aligned with ${companyName}’s goal to ${row.strategic_benefit}`;
  }

  const companyName = row.company || 'the organization';
  const benefit = row.strategic_benefit || 'its strategic priorities';

  let tail = String(tailRule.template || '')
    .replace('{company}', companyName)
    .replace('{benefit}', benefit);

  const tailConnector = seededPick(
    row.variation_seed,
    'tail_connector',
    connector_rules as any[]
  );
  if (tailConnector && (tailConnector as any).prefix) {
    tail = (tailConnector as any).prefix + tail;
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
// Main builders
// -----------------------------

function buildObjectiveInternal(row: PreparedRow, mode: 'simple' | 'complex'): string {
  const deadline = row.dead_line || 'the agreed deadline';
  const pattern = selectPattern(row, mode);

  const deliverable = `${row.task_name} ${row.task_type.toLowerCase()}`.trim();
  const verbSlot = (pattern && (pattern as any).verb_slot) || 'deliver';
  const verb = selectVerb(row, verbSlot, mode);
  const metricsClause = buildMetricsClause(row, mode);
  const tailClause = buildTailClause(row);

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
    .replace('{tail_clause}', tailClause);

  objective = applyVariationRules(objective, row, mode);
  objective = postProcessObjective(objective);

  return objective;
}

export function buildSimpleObjective(row: PreparedRow): string {
  return buildObjectiveInternal(row, 'simple');
}

export function buildComplexObjective(row: PreparedRow): string {
  return buildObjectiveInternal(row, 'complex');
}

export function buildObjectivesForRow(row: PreparedRow): ObjectiveOutput {
  const simple =
    row.mode === 'complex'
      ? ''
      : buildSimpleObjective(row);

  const complex =
    row.mode === 'simple'
      ? ''
      : buildComplexObjective(row);

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