import type { Usage } from '../types.js';

/** Retain presence before adapter defaults turn missing telemetry into zero. */
export function markUsagePresence(usage: Usage, fields: Partial<Record<NonNullable<Usage['reportedFields']>[number], unknown>>): void {
  const known = new Set(usage.reportedFields ?? []);
  for (const [name, value] of Object.entries(fields)) {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) known.add(name as NonNullable<Usage['reportedFields']>[number]);
  }
  if (known.has('input') && known.has('output')) known.add('totalTokens');
  usage.reported = true;
  usage.reportedFields = [...known];
}
