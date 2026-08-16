/**
 * 数据库初始化种子数据
 * 运行: npm run db:seed
 * 注意: 需要在 docker mysql 启动后执行
 */
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { v4 as uuid } from 'uuid';
import * as schema from './schema';
import { hashPassword } from '../routes/auth.password';
import { BUILT_IN_ROLES } from './built-in-roles';

dotenv.config();

async function seed() {
  const connection = await mysql.createConnection({
    uri: process.env.DATABASE_URL,
  });
  const db = drizzle(connection, { schema, mode: 'default' });
  const now = new Date();

  console.log('🌱 开始初始化数据...');

  const seedPassword = process.env.SEED_DEFAULT_PASSWORD;
  if (!seedPassword) {
    throw new Error('SEED_DEFAULT_PASSWORD environment variable is required');
  }

  // ─── 用户 ───
  const users = [
    { id: '1', username: 'admin', name: '张管理', role: 'ADMIN', roleId: 'r1', deptId: 'd1-2' },
    { id: '2', username: 'owner', name: '李承办', role: 'OWNER', roleId: 'r6', deptId: 'd1-1' },
    { id: '3', username: 'follower', name: '王跟进', role: 'FOLLOWER', roleId: 'r2', deptId: 'd1-2' },
    { id: '4', username: 'zhaodept', name: '赵科室', role: 'OWNER', roleId: 'r3', deptId: 'd1' },
    { id: '5', username: 'lichengban', name: '李承办处室', role: 'OWNER', roleId: 'r6', deptId: 'd1-1' },
    { id: '6', username: 'dingmin', name: '丁敏', role: 'OWNER', roleId: 'r3', deptId: 'd5-1' },
    { id: '7', username: 'weihongyi', name: '魏红义', role: 'OWNER', roleId: 'r6', deptId: 'd4-1', supervisorId: '6' },
  ];
  for (const u of users) {
    await db.insert(schema.users).values({ ...u, password: await hashPassword(seedPassword), createdAt: now, status: 'ACTIVE' } as never);
  }
  console.log('  ✅ 用户数据');

  // ─── 事项 ───
  const items = [
    { id: '1', serialNo: 'DB-2026-001', title: '关于2026年二季度安全生产大检查的通知', content: '落实集团安全生产会议精神，开展全覆盖检查。', status: 'EXECUTING', deadline: new Date('2026-06-30'), ownerName: '李承办', followerName: '王跟进', progress: 45, lightStatus: 'GREEN', category: '行政管理', campus: '集团总部' },
    { id: '2', serialNo: 'DB-2026-002', title: '三院区扩建项目进度跟进', content: '加快推进三院区住院大楼装修进度。', status: 'DELAYED', deadline: new Date('2026-06-15'), ownerName: '李承办', followerName: '王跟进', progress: 80, lightStatus: 'RED', category: '工程建设', campus: '第三院区' },
    { id: '3', serialNo: 'DB-2026-003', title: '2026年上半年科研成果汇总', content: '收集各科室上半年发表论文及专利情况。', status: 'PENDING', deadline: new Date('2026-07-10'), ownerName: '赵科室', followerName: '王跟进', progress: 0, lightStatus: 'YELLOW', category: '科研教育', campus: '全集团' },
  ];
  for (const item of items) {
    await db.insert(schema.items).values({ ...item, createdAt: now, updatedAt: now } as never);
  }
  console.log('  ✅ 事项数据');

  // ─── 时间轴 ───
  const timelines = [
    { id: uuid(), itemId: '1', type: 'CREATE', user: '张管理', content: '发起了该督办事项', timestamp: new Date('2026-05-01 10:00') },
    { id: uuid(), itemId: '1', type: 'SIGN', user: '李承办', content: '已签收该事项，并开始组织办理', timestamp: new Date('2026-05-02 09:15') },
    { id: uuid(), itemId: '1', type: 'URGE', user: '王跟进', content: '请加快进度，确保本月底前完成初步方案。', timestamp: new Date('2026-06-01 11:00') },
    { id: uuid(), itemId: '2', type: 'CREATE', user: '张管理', content: '发起了该督办事项', timestamp: new Date('2026-05-01 10:00') },
    { id: uuid(), itemId: '2', type: 'DELAY', user: '李承办', content: '因材料供应推迟，申请延期至6月25日', timestamp: new Date('2026-06-15 08:00') },
    { id: uuid(), itemId: '3', type: 'CREATE', user: '张管理', content: '发起了该督办事项', timestamp: new Date('2026-06-10 16:00') },
  ];
  for (const t of timelines) {
    await db.insert(schema.timelineNodes).values(t as never);
  }
  console.log('  ✅ 时间轴数据');

  // 催办记录不写入演示历史数据，避免催办管理页面出现无效流水。
  console.log('  ✅ 催办记录（空）');

  // ─── 消息 ───
  await db.insert(schema.messages).values([
    { id: 'm1', title: '待办提醒', content: '您有一项新的督办任务待签收：【科研成果汇总】', type: 'TODO', timestamp: new Date('2026-06-11 16:20'), read: false, link: '/items/3', receiverName: '赵科室' },
    { id: 'm2', title: '催办通知', content: '【三院区扩建项目】收到一条紧急催办', type: 'URGE', timestamp: new Date('2026-06-11 08:45'), read: true, link: '/items/2', receiverName: '李承办' },
    { id: 'm3', title: '系统公告', content: '督办系统 V1.0 正式上线运行', type: 'NOTICE', timestamp: new Date('2026-06-01 09:00'), read: true },
  ] as never);
  console.log('  ✅ 消息数据');

  // ─── 动态 ───
  await db.insert(schema.activities).values([
    { id: 'a1', content: '李承办 提交了【安全生产大检查】的进度反馈', type: 'FEEDBACK', timestamp: new Date('2026-06-11 09:30') },
    { id: 'a2', content: '收到来自 王跟进 的【三院区扩建项目】催办消息', type: 'URGE', timestamp: new Date('2026-06-11 08:45') },
    { id: 'a3', content: '系统自动将【三院区扩建项目】状态变更为 已延期', type: 'STATUS_CHANGE', timestamp: new Date('2026-06-11 00:00') },
  ] as never);
  console.log('  ✅ 动态数据');

  // ─── 部门 ───
  const depts = [
    { id: 'root', name: '集团总部', type: 'GROUP', sortOrder: 0 },
    { id: 'd1', name: '院长办公室', parentId: 'root', type: 'DEPARTMENT', sortOrder: 0 },
    { id: 'd1-1', name: '秘书处', parentId: 'd1', type: 'OFFICE', sortOrder: 0 },
    { id: 'd1-2', name: '督查室', parentId: 'd1', type: 'OFFICE', sortOrder: 1 },
    { id: 'd2', name: '人力资源部', parentId: 'root', type: 'DEPARTMENT', sortOrder: 1 },
    { id: 'd3', name: '财务管理部', parentId: 'root', type: 'DEPARTMENT', sortOrder: 2 },
    { id: 'd4', name: '医学技术集团', parentId: 'root', type: 'COMPANY', sortOrder: 3 },
    { id: 'd5', name: '海南一龄医疗产业发展有限公司', parentId: 'root', type: 'COMPANY', sortOrder: 4 },
  ];
  for (const d of depts) {
    await db.insert(schema.departments).values(d as never);
  }
  console.log('  ✅ 部门数据');

  // ─── 角色（5 个必要角色） ───
  await db.insert(schema.roles).values(
    BUILT_IN_ROLES.map((role) => ({
      ...role,
      orgIds: [],
      ownerCustomUserIds: [],
      followerCustomUserIds: [],
      customUserIds: [],
      createdAt: now,
    })) as never,
  );
  console.log('  ✅ 角色数据');

  console.log('🎉 初始化完成!');
  await connection.end();
}

seed().catch(console.error);
