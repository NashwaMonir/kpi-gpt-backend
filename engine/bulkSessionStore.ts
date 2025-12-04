// engine/bulkSessionStore.ts
// Simple in-memory store for bulk sessions.
// For production, replace with Redis/DB but keep the interface.

import type { ParsedRow, BulkPreparedRow, BulkInspectSummary } from './bulkTypes';

interface BulkSession {
  summary: BulkInspectSummary;
  parsedRows: ParsedRow[];
  preparedRows?: BulkPreparedRow[];
}

const sessions = new Map<string, BulkSession>();

export function saveBulkSession(session: BulkSession): void {
  sessions.set(session.summary.bulk_session_id, session);
}

export function getBulkSession(sessionId: string): BulkSession | undefined {
  return sessions.get(sessionId);
}

export function updateBulkPreparedRows(
  sessionId: string,
  preparedRows: BulkPreparedRow[]
): void {
  const existing = sessions.get(sessionId);
  if (!existing) return;
  sessions.set(sessionId, {
    ...existing,
    preparedRows
  });
}