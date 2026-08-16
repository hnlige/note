import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, test } from 'node:test';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const deployLocalScript = readFileSync(new URL('../../deploy/deploy-local.sh', import.meta.url), 'utf8');
const deployServerScript = readFileSync(new URL('../../deploy/deploy-server.sh', import.meta.url), 'utf8');
const deployServerLibPath = fileURLToPath(new URL('../../deploy/deploy-server-lib.sh', import.meta.url));

type PublicRuntimeSelection = {
  expectedReleaseId: string;
  publicReleaseId: string;
  publicDatabaseTargetId: string;
  publicRuntimeId: string;
  hostUpdated: boolean;
  hostDatabaseTargetId: string;
  hostRuntimeId: string;
  containerUpdated: boolean;
  containerDatabaseTargetId: string;
  containerRuntimeId: string;
};

function runPublicRuntimeSelection(input: PublicRuntimeSelection) {
  return spawnSync(
    'bash',
    [
      '-c',
      'source "$1"\nselect_public_runtime "$2" "$3" "$4" "$5" "$6" "$7" "$8" "$9" "${10}" "${11}"',
      'bash',
      deployServerLibPath,
      input.expectedReleaseId,
      input.publicReleaseId,
      input.publicDatabaseTargetId,
      input.publicRuntimeId,
      input.hostUpdated ? '1' : '0',
      input.hostDatabaseTargetId,
      input.hostRuntimeId,
      input.containerUpdated ? '1' : '0',
      input.containerDatabaseTargetId,
      input.containerRuntimeId,
    ],
    { encoding: 'utf8' },
  );
}

describe('deployment scripts', () => {
  test('local deploy script runs rsync and ssh directly', () => {
    assert.match(deployLocalScript, /rsync -az/);
    assert.match(deployLocalScript, /SSH_KEY="\$\{SSH_KEY:-\}"/);
    assert.match(deployLocalScript, /SERVER_INBOX="\$\{SERVER_INBOX:-\/opt\/duban\/incoming\}"/);
    assert.match(deployLocalScript, /\$\{SERVER_INBOX\}\/frontend\//);
    assert.match(deployLocalScript, /\$\{SERVER_INBOX\}\/backend\//);
    assert.match(deployLocalScript, /ssh "\$\{SSH_ARGS\[@\]\}" "\$\{REMOTE_TARGET\}"/);
    assert.doesNotMatch(deployLocalScript, /sc[pe]\s+-r\s+dist\/\s+\$\{SERVER_USER\}@\$\{SERVER_IP\}/);
  });

  test('server deploy script can skip git sync', () => {
    assert.match(deployServerScript, /SKIP_GIT_SYNC/);
  });

  test('server deploy delegates schema and role refresh to the compiled application entrypoint', () => {
    assert.match(deployServerScript, /dist\/db\/deploy-role-refresh\.js/);
    assert.doesNotMatch(deployServerScript, /\beval\b/);
    assert.doesNotMatch(deployServerScript, /\bmysql\b/);
    assert.doesNotMatch(deployServerScript, /DATABASE_URL=\(\.\+\)/);
    assert.doesNotMatch(deployServerScript, /START TRANSACTION|UPDATE users SET role_id|DELETE FROM roles|INSERT INTO roles/);
    assert.doesNotMatch(deployServerScript, /ensure_database_schema_with_new_backend|refresh_built_in_roles/);
  });

  test('server deploy writes a unique release fingerprint before updating either runtime', () => {
    assert.match(deployServerScript, /EXPECTED_RELEASE_ID=.*randomBytes/);

    const releaseWriteIndex = deployServerScript.indexOf('> "$BACKEND_RELEASE_DIR/release-id.txt"');
    const backendCopyIndex = deployServerScript.indexOf('cp -r "$BACKEND_SOURCE_DIR/"* "$BACKEND_TARGET/"');
    const hostReloadIndex = deployServerScript.indexOf(
      'if run_host_pm2 "$HOST_RUNTIME_ENV_FILE" "$HOST_RUNTIME_ID" startOrReload ecosystem.config.js --update-env',
    );
    const containerCopyIndex = deployServerScript.indexOf(
      'docker cp "$BACKEND_SOURCE_DIR/." "$APP_CONTAINER:/app/server/dist/"',
    );
    const containerReloadIndex = deployServerScript.indexOf('pm2 startOrReload /app/server/ecosystem.config.js --update-env');

    assert.ok(releaseWriteIndex >= 0 && releaseWriteIndex < backendCopyIndex);
    assert.ok(releaseWriteIndex < hostReloadIndex);
    assert.ok(releaseWriteIndex < containerCopyIndex);
    assert.ok(containerCopyIndex < containerReloadIndex);
  });

  test('server deploy requires a successful host or container runtime update', () => {
    assert.match(deployServerScript, /host_runtime_updated=0/);
    assert.match(deployServerScript, /container_runtime_updated=0/);
    assert.match(
      deployServerScript,
      /if run_host_pm2 "\$HOST_RUNTIME_ENV_FILE" "\$HOST_RUNTIME_ID" startOrReload ecosystem\.config\.js --update-env[\s\S]*?host_runtime_updated=1[\s\S]*?else[\s\S]*?if run_host_pm2 "\$HOST_RUNTIME_ENV_FILE" "\$HOST_RUNTIME_ID" start ecosystem\.config\.js --update-env[\s\S]*?host_runtime_updated=1/,
    );
    assert.doesNotMatch(deployServerScript, /run_host_pm2[^\n]*start ecosystem\.config\.js[^\n]*\|\|/);
    assert.match(
      deployServerScript,
      /if docker exec[\s\S]*?-e DEPLOY_RUNTIME_ID="\$CONTAINER_RUNTIME_ID"[\s\S]*?pm2 startOrReload \/app\/server\/ecosystem\.config\.js --update-env[\s\S]*?container_runtime_updated=1/,
    );

    const runtimeFailureGate = deployServerScript.match(
      /if \[ "\$host_runtime_updated" -ne 1 \] && \[ "\$container_runtime_updated" -ne 1 \]; then[\s\S]*?exit 1[\s\S]*?fi/,
    )?.[0];
    assert.ok(runtimeFailureGate);
  });

  test('server deploy resolves the serving runtime from the public loopback health identity', () => {
    const readinessFunctionIndex = deployServerScript.indexOf('wait_for_public_backend_ready()');
    const backendDeployIndex = deployServerScript.indexOf('# 4. 部署后端 + 重启服务');
    const readinessFunction = deployServerScript.slice(readinessFunctionIndex, backendDeployIndex);

    assert.match(readinessFunction, /local expected_release_id="\$1"/);
    assert.match(readinessFunction, /local max_attempts=30/);
    assert.match(readinessFunction, /http:\/\/127\.0\.0\.1\/api\/health/);
    assert.match(readinessFunction, /curl --fail --silent --show-error --max-time 2 "\$health_url"/);
    assert.match(readinessFunction, /capture_command_output health_body[\s\\]*curl/);
    assert.match(readinessFunction, /select_public_runtime/);
    assert.match(deployServerScript, /payload\.runtimeId/);
    assert.match(
      deployServerScript,
      /if ! wait_for_public_backend_ready "\$EXPECTED_RELEASE_ID"[\s\\]*"\$host_runtime_updated"[\s\\]*"\$HOST_DATABASE_TARGET_ID"[\s\\]*"\$HOST_RUNTIME_ID"[\s\\]*"\$container_runtime_updated"[\s\\]*"\$CONTAINER_DATABASE_TARGET_ID"[\s\\]*"\$CONTAINER_RUNTIME_ID"; then/,
    );
    assert.match(
      deployServerScript,
      /if ! wait_for_public_backend_ready[\s\S]*?exit 1[\s\S]*?fi/,
    );
  });

  test('public runtime selection supports host-only and container-only deployments', () => {
    const hostOnly = runPublicRuntimeSelection({
      expectedReleaseId: 'release-new',
      publicReleaseId: 'release-new',
      publicDatabaseTargetId: 'database-host',
      publicRuntimeId: 'runtime-host',
      hostUpdated: true,
      hostDatabaseTargetId: 'database-host',
      hostRuntimeId: 'runtime-host',
      containerUpdated: false,
      containerDatabaseTargetId: '',
      containerRuntimeId: 'runtime-container',
    });
    assert.equal(hostOnly.status, 0, hostOnly.stderr);
    assert.equal(hostOnly.stdout, 'host');

    const containerOnly = runPublicRuntimeSelection({
      expectedReleaseId: 'release-new',
      publicReleaseId: 'release-new',
      publicDatabaseTargetId: 'database-container',
      publicRuntimeId: 'runtime-container',
      hostUpdated: false,
      hostDatabaseTargetId: '',
      hostRuntimeId: 'runtime-host',
      containerUpdated: true,
      containerDatabaseTargetId: 'database-container',
      containerRuntimeId: 'runtime-container',
    });
    assert.equal(containerOnly.status, 0, containerOnly.stderr);
    assert.equal(containerOnly.stdout, 'container');
  });

  test('dual-runtime selection follows the runtime actually served by public loopback', () => {
    const shared = {
      expectedReleaseId: 'release-new',
      publicReleaseId: 'release-new',
      hostUpdated: true,
      hostDatabaseTargetId: 'database-host',
      hostRuntimeId: 'runtime-host',
      containerUpdated: true,
      containerDatabaseTargetId: 'database-container',
      containerRuntimeId: 'runtime-container',
    };

    const publicHost = runPublicRuntimeSelection({
      ...shared,
      publicDatabaseTargetId: 'database-host',
      publicRuntimeId: 'runtime-host',
    });
    assert.equal(publicHost.status, 0, publicHost.stderr);
    assert.equal(publicHost.stdout, 'host');

    const publicContainer = runPublicRuntimeSelection({
      ...shared,
      publicDatabaseTargetId: 'database-container',
      publicRuntimeId: 'runtime-container',
    });
    assert.equal(publicContainer.status, 0, publicContainer.stderr);
    assert.equal(publicContainer.stdout, 'container');
  });

  test('public runtime selection rejects ambiguous and mismatched identities', () => {
    const ambiguous = runPublicRuntimeSelection({
      expectedReleaseId: 'release-new',
      publicReleaseId: 'release-new',
      publicDatabaseTargetId: 'database-shared',
      publicRuntimeId: 'runtime-shared',
      hostUpdated: true,
      hostDatabaseTargetId: 'database-shared',
      hostRuntimeId: 'runtime-shared',
      containerUpdated: true,
      containerDatabaseTargetId: 'database-shared',
      containerRuntimeId: 'runtime-shared',
    });
    assert.notEqual(ambiguous.status, 0);

    for (const mismatch of [
      { publicReleaseId: 'release-stale', publicDatabaseTargetId: 'database-host', publicRuntimeId: 'runtime-host' },
      { publicReleaseId: 'release-new', publicDatabaseTargetId: 'database-wrong', publicRuntimeId: 'runtime-host' },
      { publicReleaseId: 'release-new', publicDatabaseTargetId: 'database-host', publicRuntimeId: 'runtime-wrong' },
    ]) {
      const result = runPublicRuntimeSelection({
        expectedReleaseId: 'release-new',
        ...mismatch,
        hostUpdated: true,
        hostDatabaseTargetId: 'database-host',
        hostRuntimeId: 'runtime-host',
        containerUpdated: false,
        containerDatabaseTargetId: '',
        containerRuntimeId: 'runtime-container',
      });
      assert.notEqual(result.status, 0, JSON.stringify(mismatch));
    }
  });

  test('host curl capture rejects a producer failure even when it emits matching JSON', () => {
    const result = spawnSync(
      'bash',
      [
        '-c',
        `set -e
source "$1"
producer() {
  printf '%s' '{"releaseId":"release-new","databaseTargetId":"database-new"}'
  return 22
}
health_body=''
if capture_command_output health_body producer; then
  exit 9
fi
test -z "$health_body"`,
        'bash',
        deployServerLibPath,
      ],
      { encoding: 'utf8' },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(deployServerScript, /capture_command_output health_body[\s\\]*curl/);
  });

  test('host runtime env selection falls back to the build dotenv when no verified runtime config exists', () => {
    const serverDir = mkdtempSync(path.join(tmpdir(), 'duban-host-env-'));
    mkdirSync(path.join(serverDir, 'dist'));
    writeFileSync(path.join(serverDir, '.env'), 'DATABASE_URL=mysql://local/wrong\n');
    writeFileSync(path.join(serverDir, '.env.production'), 'DATABASE_URL=mysql://production/fallback\n');
    writeFileSync(path.join(serverDir, 'dist/.env'), 'DATABASE_URL=mysql://production/selected\n');

    try {
      const result = spawnSync(
        'bash',
        ['-c', 'source "$1"; resolve_host_runtime_env_file "$2"', 'bash', deployServerLibPath, serverDir],
        { encoding: 'utf8' },
      );

      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, path.join(serverDir, 'dist/.env'));
    } finally {
      rmSync(serverDir, { recursive: true, force: true });
    }
  });

  test('server deploy runs the compiled refresh in the runtime selected from public identity', () => {
    assert.match(deployServerScript, /HOST_RUNTIME_ID=.*host/);
    assert.match(deployServerScript, /CONTAINER_RUNTIME_ID=.*container/);
    assert.match(deployServerScript, /DEPLOY_RUNTIME_ID="\$runtime_id"/);
    assert.match(deployServerScript, /docker exec[\s\\]*-e DEPLOY_RUNTIME_ID="\$CONTAINER_RUNTIME_ID"/);
    assert.match(deployServerScript, /selected_runtime="\$PUBLIC_RUNTIME_MODE"/);
    assert.match(
      deployServerScript,
      /docker exec[\s\S]*?"\$APP_CONTAINER"[\s\S]*?node \/app\/server\/dist\/db\/deploy-role-refresh\.js/,
    );
    assert.match(deployServerScript, /HOST_RUNTIME_ENV_FILE=.*resolve_host_runtime_env_file/);
    assert.match(deployServerScript, /DOTENV_CONFIG_OVERRIDE="true"/);
    assert.match(deployServerScript, /startOrReload ecosystem\.config\.js --update-env/);
    assert.match(
      deployServerScript,
      /DOTENV_CONFIG_PATH="\$HOST_RUNTIME_ENV_FILE"[\s\S]*?node -r dotenv\/config[\s\S]*?deploy-role-refresh\.js/,
    );
    assert.match(deployServerScript, /EXPECTED_DATABASE_TARGET_ID="\$expected_database_target_id"/);
    assert.match(deployServerScript, /EXPECTED_RUNTIME_ID="\$expected_runtime_id"/);
    assert.match(
      deployServerScript,
      /if ! run_deploy_role_refresh "\$selected_runtime" "\$selected_database_target_id" "\$selected_runtime_id"; then[\s\S]*?exit 1[\s\S]*?fi/,
    );
  });

  test('server deploy waits for the matching release, refreshes roles, then publishes the frontend', () => {
    const hostRuntimeFlagIndex = deployServerScript.indexOf('host_runtime_updated=0');
    const containerRuntimeFlagIndex = deployServerScript.indexOf('container_runtime_updated=0');
    const hostReloadIndex = deployServerScript.indexOf(
      'if run_host_pm2 "$HOST_RUNTIME_ENV_FILE" "$HOST_RUNTIME_ID" startOrReload ecosystem.config.js --update-env',
    );
    const containerReloadIndex = deployServerScript.indexOf('pm2 startOrReload /app/server/ecosystem.config.js --update-env');
    const runtimeFailureGateIndex = deployServerScript.indexOf(
      'if [ "$host_runtime_updated" -ne 1 ] && [ "$container_runtime_updated" -ne 1 ]; then',
    );
    const runtimeSelectionIndex = deployServerScript.indexOf('selected_runtime="$PUBLIC_RUNTIME_MODE"');
    const readinessWaitIndex = deployServerScript.indexOf(
      'if ! wait_for_public_backend_ready "$EXPECTED_RELEASE_ID"',
    );
    const roleRefreshIndex = deployServerScript.indexOf(
      'if ! run_deploy_role_refresh "$selected_runtime" "$selected_database_target_id" "$selected_runtime_id"; then',
    );
    const frontendPublishIndex = deployServerScript.indexOf('部署前端到 $FRONTEND_TARGET');

    assert.ok(hostRuntimeFlagIndex >= 0 && hostRuntimeFlagIndex < hostReloadIndex);
    assert.ok(containerRuntimeFlagIndex >= 0 && containerRuntimeFlagIndex < hostReloadIndex);
    assert.ok(hostReloadIndex < containerReloadIndex);
    assert.ok(containerReloadIndex < runtimeFailureGateIndex);
    assert.ok(runtimeFailureGateIndex < readinessWaitIndex);
    assert.ok(readinessWaitIndex < runtimeSelectionIndex);
    assert.ok(readinessWaitIndex < roleRefreshIndex);
    assert.ok(roleRefreshIndex < frontendPublishIndex);
  });

  test('final Nginx publication cannot switch a container-selected public API back to host PM2', () => {
    const nginxSection = deployServerScript.slice(deployServerScript.indexOf('# 7. 刷新 Nginx 配置'));

    assert.match(
      nginxSection,
      /if \[ "\$selected_runtime" = "host" \]; then[\s\S]*?proxy_pass http:\/\/127\.0\.0\.1:3001;[\s\S]*?else[\s\S]*?容器运行时/,
    );
    assert.doesNotMatch(
      nginxSection,
      /if \[ "\$selected_runtime" = "container" \]; then[\s\S]*?proxy_pass http:\/\/127\.0\.0\.1:3001;/,
    );
  });
});
