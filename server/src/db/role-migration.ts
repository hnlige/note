/**
 * 角色体系迁移脚本 v2
 *
 * 目标：从旧版 8 角色体系迁移到新版 5 角色体系
 *
 * 删除：
 *   - r4（部门管理员）—— 与部门负责人重复
 *   - rjqslf5z（责任人副本）—— 同步导入残留
 *   - r4dtsn6m（督办管理员）—— 与组织管理员重叠
 *
 * 更新：
 *   - r1: 系统管理员 → 超级管理员
 *   - r3: 部门负责人 → 部门管理员（DEPT → SELF_AND_DIRECT_SUBORDINATES）
 *   - r5: 组织管理员（ALL → MULTI_ORG）
 *
 * 运行: npx tsx src/db/role-migration.ts
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { BUILT_IN_ROLES } from './built-in-roles';

dotenv.config();

async function migrate() {
  const pool = mysql.createPool({
    uri: process.env.DATABASE_URL,
    connectionLimit: 5,
    waitForConnections: true,
    connectTimeout: 10000,
    enableKeepAlive: true,
  });

  console.log('=== 开始角色体系迁移 v2 ===\n');

  // ─── 1. 删除旧角色 ───

  // r4: 部门管理员（与部门负责人重复）
  const [r4Rows] = await pool.query(
    "SELECT id FROM roles WHERE id = 'r4'",
  ) as any[];
  if ((r4Rows as any[]).length > 0) {
    // 将引用了 r4 的用户迁移到 r3（部门管理员）
    await pool.query(
      "UPDATE users SET role_id = 'r3' WHERE role_id = 'r4'",
    );
    await pool.query(
      "DELETE FROM roles WHERE id = 'r4'",
    );
    console.log('  ✅ 删除角色 r4（部门管理员），用户已迁移到 r3');
  } else {
    console.log('  ⏭ 角色 r4（部门管理员）已不存在，跳过');
  }

  // rjqslf5z: 责任人副本
  const [rjqslf5zRows] = await pool.query(
    "SELECT id FROM roles WHERE id = 'rjqslf5z'",
  ) as any[];
  if ((rjqslf5zRows as any[]).length > 0) {
    // 将引用了 rjqslf5z 的用户迁移到 r6（责任人）
    await pool.query(
      "UPDATE users SET role_id = 'r6' WHERE role_id = 'rjqslf5z'",
    );
    await pool.query(
      "DELETE FROM roles WHERE id = 'rjqslf5z'",
    );
    console.log('  ✅ 删除角色 rjqslf5z（责任人副本），用户已迁移到 r6');
  } else {
    console.log('  ⏭ 角色 rjqslf5z（责任人副本）已不存在，跳过');
  }

  // r4dtsn6m: 督办管理员（与组织管理员重叠）
  const [r4dtsn6mRows] = await pool.query(
    "SELECT id FROM roles WHERE id = 'r4dtsn6m'",
  ) as any[];
  if ((r4dtsn6mRows as any[]).length > 0) {
    // 将引用了 r4dtsn6m 的用户迁移到 r5（组织管理员）
    await pool.query(
      "UPDATE users SET role_id = 'r5' WHERE role_id = 'r4dtsn6m'",
    );
    await pool.query(
      "DELETE FROM roles WHERE id = 'r4dtsn6m'",
    );
    console.log('  ✅ 删除角色 r4dtsn6m（督办管理员），用户已迁移到 r5');
  } else {
    console.log('  ⏭ 角色 r4dtsn6m（督办管理员）已不存在，跳过');
  }

  // ─── 2. 对齐内置角色基线 ───
  for (const role of BUILT_IN_ROLES) {
    await pool.query(
      `INSERT INTO roles (
        id,
        name,
        description,
        permissions,
        data_scope,
        follower_data_scope,
        allowed_actions,
        org_ids,
        owner_custom_user_ids,
        follower_custom_user_ids,
        custom_user_ids,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        permissions = VALUES(permissions),
        data_scope = VALUES(data_scope),
        follower_data_scope = VALUES(follower_data_scope),
        allowed_actions = VALUES(allowed_actions)`,
      [
        role.id,
        role.name,
        role.description,
        JSON.stringify(role.permissions),
        role.dataScope,
        role.followerDataScope,
        JSON.stringify(role.allowedActions),
        JSON.stringify([]),
        JSON.stringify([]),
        JSON.stringify([]),
        JSON.stringify([]),
      ],
    );
    console.log(`  ✅ 已对齐内置角色 ${role.id}（${role.name}）`);
  }

  // ─── 3. 验证结果 ───
  console.log('\n=== 验证迁移结果 ===');
  const [roles] = await pool.query(
    "SELECT id, name, data_scope, follower_data_scope, permissions, allowed_actions FROM roles ORDER BY id",
  ) as any[];
  console.table(roles);

  await pool.end();
  console.log('\n=== 角色体系迁移完成 ===');
}

migrate().catch(console.error);
