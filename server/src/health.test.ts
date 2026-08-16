import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DATABASE_TARGET_ID,
  getDatabaseTargetId,
  getHealthPayload,
  loadReleaseId,
  matchesDeploymentIdentity,
  matchesReleaseId,
  RELEASE_ID,
  RUNTIME_ID,
} from './health';

test('getHealthPayload returns an ok status with service metadata', () => {
  const payload = getHealthPayload();

  assert.equal(payload.status, 'ok');
  assert.equal(payload.service, 'duban-server');
  assert.equal(typeof payload.timestamp, 'string');
  assert.equal(payload.releaseId, RELEASE_ID);
  assert.equal(payload.databaseTargetId, DATABASE_TARGET_ID);
  assert.equal(payload.runtimeId, RUNTIME_ID);
  assert.equal(getHealthPayload().releaseId, payload.releaseId);
  assert.equal(getHealthPayload().runtimeId, payload.runtimeId);
});

test('database target fingerprint excludes credentials but distinguishes database targets', () => {
  const firstCredentials = getDatabaseTargetId('mysql://alice:secret-a@db.example.com:3306/duban?ssl=true');
  const secondCredentials = getDatabaseTargetId('mysql://bob:secret-b@db.example.com/duban?ssl=false');
  const otherDatabase = getDatabaseTargetId('mysql://alice:secret-a@db.example.com:3306/duban_test');

  assert.equal(firstCredentials, secondCredentials);
  assert.notEqual(firstCredentials, otherDatabase);
  assert.doesNotMatch(firstCredentials, /alice|secret|db\.example|duban/);
});

test('loadReleaseId trims a release fingerprint read from the compiled artifact', () => {
  const releaseId = loadReleaseId('/server/dist/release-id.txt', () => ' release-20260807-a1b2 \n');

  assert.equal(releaseId, 'release-20260807-a1b2');
});

test('loadReleaseId uses a deterministic safe fallback when the artifact is missing or empty', () => {
  assert.equal(
    loadReleaseId('/missing/release-id.txt', () => {
      throw new Error('missing');
    }),
    'local-development',
  );
  assert.equal(loadReleaseId('/empty/release-id.txt', () => '  \n'), 'local-development');
});

test('matchesReleaseId accepts the exact fingerprint and rejects stale or malformed payloads', () => {
  assert.equal(matchesReleaseId({ releaseId: 'release-new' }, 'release-new'), true);
  assert.equal(matchesReleaseId({ releaseId: 'release-old' }, 'release-new'), false);
  assert.equal(matchesReleaseId({ status: 'ok' }, 'release-new'), false);
  assert.equal(matchesReleaseId(null, 'release-new'), false);
});

test('deployment identity rejects a matching release served from the wrong database target', () => {
  const payload = { releaseId: 'release-new', databaseTargetId: 'database-old', runtimeId: 'runtime-host' };

  assert.equal(matchesDeploymentIdentity(payload, 'release-new', 'database-new', 'runtime-host'), false);
  assert.equal(
    matchesDeploymentIdentity(
      { releaseId: 'release-new', databaseTargetId: 'database-new', runtimeId: 'runtime-host' },
      'release-new',
      'database-new',
      'runtime-host',
    ),
    true,
  );
});

test('deployment identity rejects the wrong or missing runtime even when release and database match', () => {
  const expectedReleaseId = 'release-new';
  const expectedDatabaseTargetId = 'database-new';

  assert.equal(
    matchesDeploymentIdentity(
      { releaseId: expectedReleaseId, databaseTargetId: expectedDatabaseTargetId, runtimeId: 'runtime-container' },
      expectedReleaseId,
      expectedDatabaseTargetId,
      'runtime-host',
    ),
    false,
  );
  assert.equal(
    matchesDeploymentIdentity(
      { releaseId: expectedReleaseId, databaseTargetId: expectedDatabaseTargetId },
      expectedReleaseId,
      expectedDatabaseTargetId,
      'runtime-host',
    ),
    false,
  );
});
