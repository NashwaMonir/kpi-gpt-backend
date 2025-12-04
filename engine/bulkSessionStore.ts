// engine/bulkSessionStore.ts
// Simple in-memory store for bulk sessions.
// For production, replace with Redis/DB but keep the interface.

import { randomUUID } from 'crypto';
import type { BulkPreparedRow, BulkSessionSnapshot } from './bulkTypes';

const BULK_SESSION_STORE = new Map<string, BulkSessionSnapshot>();

export function saveBulkSession(snapshot: BulkSessionSnapshot): string {
  const id = randomUUID();
  BULK_SESSION_STORE.set(id, snapshot);
  return id;
}

export function getBulkSession(id: string): BulkSessionSnapshot | undefined {
  return BULK_SESSION_STORE.get(id);
}

export function updateBulkPreparedRows(
  sessionId: string,
  preparedRows: BulkPreparedRow[]
): void {
  const existing = BULK_SESSION_STORE.get(sessionId);
  if (!existing) return;

  BULK_SESSION_STORE.set(sessionId, {
    ...existing,
    preparedRows
  });
}