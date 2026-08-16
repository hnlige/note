import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const LOCAL_RELEASE_ID = 'local-development';
const LOCAL_RUNTIME_ID = 'local-runtime';
export const UNCONFIGURED_DATABASE_TARGET_ID = 'database-unconfigured';

type ReadReleaseFile = (filePath: string, encoding: BufferEncoding) => string;

export function loadReleaseId(
  filePath: string,
  readReleaseFile: ReadReleaseFile = readFileSync,
): string {
  try {
    return readReleaseFile(filePath, 'utf8').trim() || LOCAL_RELEASE_ID;
  } catch {
    return LOCAL_RELEASE_ID;
  }
}

export const RELEASE_ID = loadReleaseId(path.resolve(__dirname, 'release-id.txt'));

export function getDatabaseTargetId(databaseUrl: string | undefined): string {
  if (!databaseUrl) return UNCONFIGURED_DATABASE_TARGET_ID;

  try {
    const parsed = new URL(databaseUrl);
    const databaseName = decodeURIComponent(parsed.pathname).replace(/^\/+|\/+$/g, '');
    if (!parsed.protocol || !parsed.hostname || !databaseName) {
      return UNCONFIGURED_DATABASE_TARGET_ID;
    }

    const protocol = parsed.protocol.toLowerCase();
    const port = parsed.port || (protocol === 'mysql:' ? '3306' : '');
    const target = `${protocol}//${parsed.hostname.toLowerCase()}:${port}/${databaseName}`;
    return createHash('sha256').update(target).digest('hex');
  } catch {
    return UNCONFIGURED_DATABASE_TARGET_ID;
  }
}

export const DATABASE_TARGET_ID = getDatabaseTargetId(process.env.DATABASE_URL);
export const RUNTIME_ID = process.env.DEPLOY_RUNTIME_ID?.trim() || LOCAL_RUNTIME_ID;

export function matchesReleaseId(payload: unknown, expectedReleaseId: string): boolean {
  return Boolean(
    payload
      && typeof payload === 'object'
      && 'releaseId' in payload
      && (payload as { releaseId?: unknown }).releaseId === expectedReleaseId,
  );
}

export function matchesDeploymentIdentity(
  payload: unknown,
  expectedReleaseId: string,
  expectedDatabaseTargetId: string,
  expectedRuntimeId: string,
): boolean {
  return Boolean(
    matchesReleaseId(payload, expectedReleaseId)
      && payload
      && typeof payload === 'object'
      && 'databaseTargetId' in payload
      && (payload as { databaseTargetId?: unknown }).databaseTargetId === expectedDatabaseTargetId
      && 'runtimeId' in payload
      && (payload as { runtimeId?: unknown }).runtimeId === expectedRuntimeId,
  );
}

export function getHealthPayload() {
  return {
    status: 'ok',
    service: 'duban-server',
    releaseId: RELEASE_ID,
    databaseTargetId: DATABASE_TARGET_ID,
    runtimeId: RUNTIME_ID,
    timestamp: new Date().toISOString(),
  };
}
