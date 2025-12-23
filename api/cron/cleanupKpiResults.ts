// api/cleanupKpiResults.ts
// Purpose: Delete KPI result XLSX blobs older than 2 hours.
// Schedule: every 1 hour (via Vercel Cron)
// Supports: dry-run mode (no deletions)

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { list, del } from '@vercel/blob';

type BlobListPage = {
  blobs: Array<{
    url?: string;
    pathname?: string;
    uploadedAt?: string | Date;
    createdAt?: string | Date;
    uploadTime?: string | Date;
  }>;
  cursor?: string;
};

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

function parseBool(v: unknown): boolean {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'y';
}

function safeDate(v: any): Date | null {
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Cron calls are GET by default
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const now = Date.now();

  // Dry-run can be controlled via query or env
  const dry_run =
    parseBool(req.query.dry_run) || parseBool(process.env.CLEANUP_DRY_RUN);

  // Optional safety: only delete KPI result exports by prefix
  // IMPORTANT: keep this aligned with whatever prefix you use when uploading blobs.
  // Example prefix: "kpi-results/"
  const prefix = String(req.query.prefix ?? process.env.KPI_RESULTS_PREFIX ?? 'kpi-results/');

  let scanned = 0;
  let eligible = 0;
  let deleted = 0;
  const sample_deleted: string[] = [];
  const sample_kept: string[] = [];

  try {
    let cursor: string | undefined = undefined;

    while (true) {
      const page: BlobListPage = await list({
        prefix,
        cursor,
        limit: 1000
      } as any);

      const blobs: any[] = Array.isArray((page as any).blobs) ? (page as any).blobs : [];
      scanned += blobs.length;

      for (const b of blobs) {
        // Vercel Blob metadata commonly includes uploadedAt; fall back safely.
        const uploadedAt =
          safeDate(b?.uploadedAt) || safeDate(b?.createdAt) || safeDate(b?.uploadTime);

        if (!uploadedAt) {
          // If we cannot timestamp it, keep it (never delete unknown-age).
          if (sample_kept.length < 5) sample_kept.push(String(b?.url ?? b?.pathname ?? 'unknown'));
          continue;
        }

        const ageMs = now - uploadedAt.getTime();
        if (ageMs <= TWO_HOURS_MS) {
          if (sample_kept.length < 5) sample_kept.push(String(b?.url ?? b?.pathname ?? 'unknown'));
          continue;
        }

        eligible += 1;

        const url = String(b?.url ?? '');
        if (!url) continue;

        if (!dry_run) {
          await del(url);
          deleted += 1;
          if (sample_deleted.length < 5) sample_deleted.push(url);
        } else {
          if (sample_deleted.length < 5) sample_deleted.push(url);
        }
      }

      cursor = (page as any).cursor;
      if (!cursor) break;
    }

    return res.status(200).json({
      ok: true,
      dry_run,
      prefix,
      scanned,
      eligible,
      deleted: dry_run ? 0 : deleted,
      would_delete: dry_run ? eligible : 0,
      sample_deleted,
      sample_kept
    });
  } catch (err) {
    console.error('[cleanupKpiResults] failed', err);
    return res.status(500).json({
      ok: false,
      error: 'Cleanup failed',
      dry_run,
      prefix
    });
  }
}