import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveItemAccessRows,
  buildActiveUserNameIndex,
  getItemAccessQueryMode,
  payloadTouchesItemRelations,
  ITEM_ACCESS_RELATIONS,
} from './item-access';

const USERS = [
  { id: 'u1', name: '张三', status: 'ACTIVE' },
  { id: 'u2', name: '李四', status: 'ACTIVE' },
  { id: 'u3', name: '张三', status: 'ACTIVE' }, // 与 u1 同名
  { id: 'u4', name: '王五', status: 'DISABLED' }, // 停用用户不参与姓名匹配
];

function relationsOf(rows: Array<{ userId: string; relation: string }>, userId: string): string[] {
  return rows.filter((row) => row.userId === userId).map((row) => row.relation).sort();
}

test('姓名索引：同名活跃用户全部入索引，停用用户排除', () => {
  const index = buildActiveUserNameIndex(USERS as any);
  assert.deepEqual(index.get('张三')?.sort(), ['u1', 'u3']);
  assert.equal(index.get('王五'), undefined);
});

test('deriveItemAccessRows：id 直配 + 姓名匹配展开 + SHARE 仅 userId', () => {
  const rows = deriveItemAccessRows({
    id: 'item-1',
    ownerId: 'u1',
    ownerName: '李四',       // 姓名匹配 → u2 也获得 OWNER（镜像旧 inArray 语义）
    followerIds: '["u2"]',   // TEXT 列 JSON 字符串兼容
    subTasks: [{ assigneeName: '张三' }],  // 无 id 仅姓名 → u1、u3 同获 ASSIGNEE
    sharedWith: [{ userId: 'u1', userName: '随便' }, { userName: '无userId' }],
  }, USERS as any);

  assert.deepEqual(relationsOf(rows, 'u1'), [ITEM_ACCESS_RELATIONS.ASSIGNEE, ITEM_ACCESS_RELATIONS.OWNER, ITEM_ACCESS_RELATIONS.SHARE]);
  assert.deepEqual(relationsOf(rows, 'u2'), [ITEM_ACCESS_RELATIONS.FOLLOWER, ITEM_ACCESS_RELATIONS.OWNER]);
  assert.deepEqual(relationsOf(rows, 'u3'), [ITEM_ACCESS_RELATIONS.ASSIGNEE]);
  assert.equal(relationsOf(rows, 'u4').length, 0);
});

test('deriveItemAccessRows：DELETED 子任务的责任人仍派生关系（与旧 JSON_SEARCH 同口径）', () => {
  const rows = deriveItemAccessRows({
    id: 'item-2',
    subTasks: [{ assigneeId: 'u2', status: 'DELETED' }],
  }, USERS as any);
  assert.deepEqual(relationsOf(rows, 'u2'), [ITEM_ACCESS_RELATIONS.ASSIGNEE]);
});

test('deriveItemAccessRows：同一用户多关系去重为多行三元组', () => {
  const rows = deriveItemAccessRows({
    id: 'item-3',
    ownerId: 'u1',
    followerId: 'u1',
    subTasks: [{ assigneeId: 'u1' }],
  }, USERS as any);
  const u1Rows = rows.filter((row) => row.userId === 'u1');
  assert.deepEqual(new Set(u1Rows.map((row) => row.relation)), new Set(['OWNER', 'FOLLOWER', 'ASSIGNEE']));
  // (item, user, relation) 三元组无重复
  const keys = u1Rows.map((row) => `${row.itemId}|${row.userId}|${row.relation}`);
  assert.equal(new Set(keys).size, keys.length);
});

test('deriveItemAccessRows：缺 id 事项返回空', () => {
  assert.deepEqual(deriveItemAccessRows({ ownerIds: ['u1'] }, USERS as any), []);
});

test('getItemAccessQueryMode：默认 json，显式 access 才切换', () => {
  assert.equal(getItemAccessQueryMode({}), 'json');
  assert.equal(getItemAccessQueryMode({ ITEM_ACCESS_QUERY_MODE: 'access' }), 'access');
  assert.equal(getItemAccessQueryMode({ ITEM_ACCESS_QUERY_MODE: 'json' }), 'json');
  assert.equal(getItemAccessQueryMode({ ITEM_ACCESS_QUERY_MODE: '乱写' }), 'json');
});

test('payloadTouchesItemRelations：仅关系字段触发重建', () => {
  assert.equal(payloadTouchesItemRelations({ status: 'EXECUTING', progress: 50 }), false);
  assert.equal(payloadTouchesItemRelations({ timeline: [] }), false);
  assert.equal(payloadTouchesItemRelations({ subTasks: [{ id: 'st1' }] }), true);
  assert.equal(payloadTouchesItemRelations({ sharedWith: [], ownerIds: [] }), true);
  assert.equal(payloadTouchesItemRelations(null), false);
});
