export const STRATEGIC_KEYWORDS = [
  'strategic',
  'strategy',
  'transformation',
  'digital transformation',
  'platform',
  'portfolio',
  'okr',
  'okrs',
  'cross-functional',
  'multi-squad',
  'enterprise',
  'customer experience',
  'cx'
];
export function isStrategicBenefit(raw: string): boolean {
  const text = (raw || '').toLowerCase();
  return STRATEGIC_KEYWORDS.some(k => text.includes(k));
}