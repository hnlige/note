import {
  mysqlTable,
  varchar,
  text,
  datetime,
  int,
  boolean,
  json,
  index,
  primaryKey,
  uniqueIndex,
} from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';

// ─── 用户表 ───
export const users = mysqlTable('users', {
  id: varchar('id', { length: 36 }).primaryKey(),
  username: varchar('username', { length: 50 }).notNull().unique(),
  password: varchar('password', { length: 255 }).notNull(),
  name: varchar('name', { length: 50 }).notNull(),
  role: varchar('role', { length: 20 }).notNull().default('OWNER'),
  roleId: varchar('role_id', { length: 36 }),
  roleIds: json('role_ids'),
  email: varchar('email', { length: 100 }),
  phone: varchar('phone', { length: 20 }),
  deptId: varchar('dept_id', { length: 36 }),
  orgId: varchar('org_id', { length: 36 }),
  supervisorId: varchar('supervisor_id', { length: 36 }),
  adminOrgIds: json('admin_org_ids'),
  preferences: json('preferences'),
  status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
  sessionVersion: int('session_version').notNull().default(0),
  wecomUserId: varchar('wecom_user_id', { length: 64 }),
  createdAt: datetime('created_at').notNull().default(sql`now()`),
});

// ─── 督办事项表 ───
export const items = mysqlTable('items', {
  id: varchar('id', { length: 36 }).primaryKey(),
  serialNo: varchar('serial_no', { length: 50 }).notNull().unique(),
  title: varchar('title', { length: 200 }).notNull(),
  content: text('content'),
  status: varchar('status', { length: 20 }).notNull().default('PENDING'),
  deadline: datetime('deadline'),
  issuerId: varchar('issuer_id', { length: 36 }),
  issuerName: varchar('issuer_name', { length: 50 }),
  issuerAccount: varchar('issuer_account', { length: 50 }),
  ownerId: varchar('owner_id', { length: 36 }),
  ownerName: varchar('owner_name', { length: 50 }),
  followerId: varchar('follower_id', { length: 36 }),
  followerName: varchar('follower_name', { length: 50 }),
  progress: int('progress').default(0),
  lightStatus: varchar('light_status', { length: 10 }),
  lastFeedbackDate: datetime('last_feedback_date'),
  category: varchar('category', { length: 50 }),
  campus: varchar('campus', { length: 50 }),
  meetingSource: varchar('meeting_source', { length: 200 }),
  raiseDate: datetime('raise_date'),
  requiredCompletionDate: datetime('required_completion_date'),
  plannedCompletionDate: datetime('planned_completion_date'),
  actualCompletionDate: datetime('actual_completion_date'),
  ownerIds: json('owner_ids'),
  ownerNames: json('owner_names'),
  followerIds: json('follower_ids'),
  followerNames: json('follower_names'),
  deptNames: json('dept_names'),
  subTasks: json('sub_tasks'),
  sharedWith: json('shared_with'),
  attachments: json('attachments'),
  changeHistory: json('change_history'),
  originalStatus: varchar('original_status', { length: 20 }),
  deletedAt: datetime('deleted_at'),
  deletedById: varchar('deleted_by_id', { length: 36 }),
  createdAt: datetime('created_at').notNull().default(sql`now()`),
  updatedAt: datetime('updated_at').notNull().default(sql`now()`),
}, (table) => ({
  createdAtIdIdx: index('items_created_at_id_idx').on(table.createdAt, table.id),
  ownerCreatedAtIdx: index('items_owner_created_at_idx').on(table.ownerId, table.createdAt),
  followerCreatedAtIdx: index('items_follower_created_at_idx').on(table.followerId, table.createdAt),
}));

// ─── 时间轴节点 ───
export const timelineNodes = mysqlTable('timeline_nodes', {
  id: varchar('id', { length: 36 }).primaryKey(),
  itemId: varchar('item_id', { length: 36 }).notNull(),
  type: varchar('type', { length: 30 }).notNull(),
  user: varchar('user', { length: 50 }).notNull(),
  actorUserId: varchar('actor_user_id', { length: 36 }),
  content: text('content'),
  timestamp: datetime('timestamp').notNull(),
  attachments: json('attachments'),
}, (table) => ({
  itemTimestampIdx: index('timeline_nodes_item_timestamp_idx').on(table.itemId, table.timestamp, table.id),
}));

// ─── 催办记录 ───
export const urgeRecords = mysqlTable('urge_records', {
  id: varchar('id', { length: 36 }).primaryKey(),
  itemId: varchar('item_id', { length: 36 }).notNull(),
  itemTitle: varchar('item_title', { length: 200 }).notNull(),
  senderId: varchar('sender_id', { length: 36 }),
  sender: varchar('sender', { length: 50 }).notNull(),
  receiverId: varchar('receiver_id', { length: 36 }),
  receiver: varchar('receiver', { length: 50 }).notNull(),
  timestamp: datetime('timestamp').notNull().default(sql`now()`),
  status: varchar('status', { length: 20 }).notNull().default('UNREAD'),
  responseContent: text('response_content'),
  content: text('content'),
  method: varchar('method', { length: 20 }).notNull().default('MESSAGE'),
  batchId: varchar('batch_id', { length: 36 }),
  subTaskId: varchar('sub_task_id', { length: 36 }),
  idempotencyKey: varchar('idempotency_key', { length: 64 }),
  scope: varchar('scope', { length: 20 }).notNull().default('SINGLE_ASSIGNEE'),
  source: varchar('source', { length: 20 }).notNull().default('MANUAL'),
  result: varchar('result', { length: 20 }).notNull().default('SUCCESS'),
}, (table) => ({
  autoUrgeLookupIdx: index('urge_records_auto_lookup_idx').on(table.itemId, table.receiverId, table.senderId, table.timestamp),
  batchItemReceiverIdx: index('urge_records_batch_item_receiver_idx').on(table.batchId, table.itemId, table.receiverId, table.subTaskId),
  idempotencyKeyUnique: uniqueIndex('urge_records_idempotency_key_unique').on(table.idempotencyKey),
  scopeSourceIdx: index('urge_records_scope_source_idx').on(table.scope, table.source, table.timestamp),
}));

// ─── 消息通知 ───
export const messages = mysqlTable('messages', {
  id: varchar('id', { length: 36 }).primaryKey(),
  title: varchar('title', { length: 100 }).notNull(),
  content: text('content'),
  type: varchar('type', { length: 20 }).notNull(),
  timestamp: datetime('timestamp').notNull().default(sql`now()`),
  read: boolean('read').notNull().default(false),
  link: varchar('link', { length: 200 }),
  receiverId: varchar('receiver_id', { length: 36 }),
  receiverName: varchar('receiver_name', { length: 50 }),
  senderId: varchar('sender_id', { length: 36 }),
  senderName: varchar('sender_name', { length: 50 }),
}, (table) => ({
  receiverTimestampIdx: index('messages_receiver_timestamp_id_idx').on(table.receiverId, table.timestamp, table.id),
  timestampIdx: index('messages_timestamp_id_idx').on(table.timestamp, table.id),
}));

// 广播消息也必须按用户分别维护已读/删除状态，避免一人操作影响所有接收者。
export const messageUserStates = mysqlTable('message_user_states', {
  messageId: varchar('message_id', { length: 36 }).notNull(),
  userId: varchar('user_id', { length: 36 }).notNull(),
  read: boolean('read').notNull().default(false),
  deleted: boolean('deleted').notNull().default(false),
  updatedAt: datetime('updated_at').notNull().default(sql`now()`),
}, (table) => ({
  pk: primaryKey({ columns: [table.messageId, table.userId] }),
}));

// ─── 动态记录 ───
export const activities = mysqlTable('activities', {
  id: varchar('id', { length: 36 }).primaryKey(),
  content: text('content'),
  timestamp: datetime('timestamp').notNull().default(sql`now()`),
  type: varchar('type', { length: 20 }).notNull(),
}, (table) => ({
  timestampIdx: index('activities_timestamp_id_idx').on(table.timestamp, table.id),
}));

// ─── 亮灯记录 ───
export const lightRecords = mysqlTable('light_records', {
  id: varchar('id', { length: 36 }).primaryKey(),
  itemId: varchar('item_id', { length: 36 }).notNull(),
  color: varchar('color', { length: 10 }).notNull(),
  reason: text('reason'),
  triggerMode: varchar('trigger_mode', { length: 10 }).notNull(),
  operatorName: varchar('operator_name', { length: 50 }).notNull(),
  createdAt: datetime('created_at').notNull().default(sql`now()`),
});

// ─── 部门表 ───
export const departments = mysqlTable('departments', {
  id: varchar('id', { length: 36 }).primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  parentId: varchar('parent_id', { length: 36 }),
  type: varchar('type', { length: 20 }).default('DEPARTMENT'),
  sortOrder: int('sort_order').default(0),
  wecomDeptId: varchar('wecom_dept_id', { length: 64 }),
});

// ─── 角色权限表 ───
export const roles = mysqlTable('roles', {
  id: varchar('id', { length: 36 }).primaryKey(),
  name: varchar('name', { length: 50 }).notNull(),
  description: text('description'),
  permissions: json('permissions').default([]),
  dataScope: varchar('data_scope', { length: 50 }).default('SELF'),
  followerDataScope: varchar('follower_data_scope', { length: 50 }),
  allowedActions: json('allowed_actions').default([]),
  allowedPageActions: json('allowed_page_actions').default({}),
  orgIds: json('org_ids').default([]),
  ownerCustomUserIds: json('owner_custom_user_ids').default([]),
  followerCustomUserIds: json('follower_custom_user_ids').default([]),
  customUserIds: json('custom_user_ids').default([]),
  createdAt: datetime('created_at').notNull().default(sql`now()`),
});

// ─── 模板表 ───
export const templates = mysqlTable('templates', {
  id: varchar('id', { length: 36 }).primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  content: text('content'),
  category: varchar('category', { length: 50 }),
  description: text('description'),
  defaultDeadlineDays: int('default_deadline_days').default(7),
  defaultFollowerId: varchar('default_follower_id', { length: 36 }),
  defaultFollowerName: varchar('default_follower_name', { length: 50 }),
  rules: json('rules').default({}),
  status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
  createdAt: datetime('created_at').notNull().default(sql`now()`),
});

// ─── 字典表 ───
export const dictionaries = mysqlTable('dictionaries', {
  id: varchar('id', { length: 36 }).primaryKey(),
  type: varchar('type', { length: 50 }).notNull(),
  label: varchar('label', { length: 100 }).notNull(),
  value: varchar('value', { length: 100 }).notNull(),
  sortOrder: int('sort_order').default(0),
  createdAt: datetime('created_at').notNull().default(sql`now()`),
});

// ─── 审核记录表 ───
export const auditRecords = mysqlTable('audit_records', {
  id: varchar('id', { length: 36 }).primaryKey(),
  itemId: varchar('item_id', { length: 36 }),
  itemTitle: varchar('item_title', { length: 200 }),
  applicantName: varchar('applicant_name', { length: 50 }),
  reviewerName: varchar('reviewer_name', { length: 50 }),
  status: varchar('status', { length: 20 }).notNull().default('PENDING'),
  result: varchar('result', { length: 20 }),
  comment: text('comment'),
  submittedAt: datetime('submitted_at').notNull().default(sql`now()`),
  reviewedAt: datetime('reviewed_at'),
  rating: int('rating'),
  evaluation: text('evaluation'),
}, (table) => ({
  submittedAtIdx: index('audit_records_submitted_at_id_idx').on(table.submittedAt, table.id),
}));

// ─── 异步任务表 ───
export const asyncTasks = mysqlTable('async_tasks', {
  id: varchar('id', { length: 36 }).primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  module: varchar('module', { length: 50 }),
  status: varchar('status', { length: 20 }).notNull().default('PROCESSING'),
  progress: int('progress').default(0),
  result: text('result'),
  startTime: datetime('start_time').notNull().default(sql`now()`),
  endTime: datetime('end_time'),
});

// ─── 全局规则配置表 ───
export const globalRules = mysqlTable('global_rules', {
  id: varchar('id', { length: 36 }).primaryKey().default('default'),
  autoRemindEnabled: boolean('auto_remind_enabled').default(true),
  autoRemindDays: int('auto_remind_days').default(3),
  autoUrgeEnabled: boolean('auto_urge_enabled').default(false),
  autoUrgeDays: int('auto_urge_days').default(7),
  lightDelayDays: int('light_delay_days').default(5),
  lightWarningDays: int('light_warning_days').default(3),
  yellowLightDays: int('yellow_light_days').default(3),
  redLightHours: int('red_light_hours').default(24),
  autoUrgeFrequency: int('auto_urge_frequency').default(1),
  urgeChannels: json('urge_channels').default(['SYSTEM']),
  serialRule: json('serial_rule').default({ prefix: 'DB', showYear: true, sequenceLength: 3, connector: '-' }),
  notifTemplates: json('notif_templates').default({}),
  auditFlow: json('audit_flow').default({ enableMultiLevel: false, auditRoles: ['ADMIN'] }),
  wecomCorpId: varchar('wecom_corp_id', { length: 100 }),
  wecomCorpSecret: varchar('wecom_corp_secret', { length: 512 }),
  wecomAgentId: varchar('wecom_agent_id', { length: 50 }),
  wecomToken: varchar('wecom_token', { length: 100 }),
  wecomEncodingAesKey: varchar('wecom_encoding_aes_key', { length: 100 }),
  wecomCallbackUrl: varchar('wecom_callback_url', { length: 300 }),
  wecomTemplates: json('wecom_templates'),
  updatedAt: datetime('updated_at').notNull().default(sql`now()`),
});

// ─── 操作日志表 ───
export const operationLogs = mysqlTable('operation_logs', {
  id: varchar('id', { length: 36 }).primaryKey(),
  userId: varchar('user_id', { length: 36 }),
  userName: varchar('user_name', { length: 50 }),
  action: varchar('action', { length: 200 }).notNull(),
  module: varchar('module', { length: 50 }),
  detail: text('detail'),
  ip: varchar('ip', { length: 50 }),
  timestamp: datetime('timestamp').notNull().default(sql`now()`),
}, (table) => ({
  timestampIdx: index('operation_logs_timestamp_id_idx').on(table.timestamp, table.id),
}));
