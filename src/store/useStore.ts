import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { User, UserRole, SupervisionItem, Activity, TimelineNode, UrgeRecord, Template, DeptNode, Message, Role, OperationLog, KnowledgeDoc, AsyncTask, AuditRecord, GlobalRules, DictionaryItem, LightRecord, OrgUser, DataScope, FollowerDataScope, AllowedAction, ItemStatus } from '../types';
import { getMissingRolesToCreate, mapRemoteRoleToRole } from './roles.sync';
import { normalizeMessagePayload, normalizeUrgePayload } from './notification-payload';
import { canAccessByAuthCodes, canUseAllowedAction, getRolesByUser, getStrictUserAuthCodes } from './role-access';
import { normalizeRemoteItem, resolveSyncedItems } from './item-sync';
import type { ItemPageAuth } from '../lib/api';
import { aggregateSubTaskStatus, getEffectiveStatusForUser, syncAllSubTasks, updateUserSubTaskForIdentity } from '../lib/item-format';
import { generateClientId } from '../lib/id';
import { PERMISSION_TREE } from '../permissions/page-actions';

export { normalizeRemoteItem } from './item-sync';

const anonymousUser: User = { id: '', name: '', role: '' as UserRole };

const ITEM_API_UPDATE_FIELDS = new Set([
  'serialNo',
  'title',
  'content',
  'deadline',
  'ownerId',
  'ownerName',
  'followerId',
  'followerName',
  'progress',
  'lightStatus',
  'lastFeedbackDate',
  'category',
  'campus',
  'meetingSource',
  'meetingName',
  'raiseDate',
  'requiredCompletionDate',
  'plannedCompletionDate',
  'actualCompletionDate',
  'status',
  'ownerIds',
  'ownerNames',
  'followerIds',
  'followerNames',
  'deptNames',
  'subTasks',
  'sharedWith',
  'attachments',
  'timeline',
]);

function getItemApiUpdates(updates: Partial<SupervisionItem>): Partial<SupervisionItem> {
  return Object.fromEntries(
    Object.entries(updates).filter(([field, value]) => ITEM_API_UPDATE_FIELDS.has(field) && value !== undefined)
  ) as Partial<SupervisionItem>;
}

function warnAndRollbackItems(error: unknown, setItems: (items: SupervisionItem[]) => void, previousItems: SupervisionItem[]) {
  console.warn('同步后端失败:', error);
  setItems(previousItems);
}

interface WorkbenchState {
  currentUser: User;
  items: SupervisionItem[];
  activities: Activity[];
  urgeRecords: UrgeRecord[];
  autoUrgedKeys: Record<string, string>;
  templates: Template[];
  departments: DeptNode[];
  messages: Message[];
  roles: Role[];
  pendingRoleUpdates: Record<string, boolean>;
  logs: OperationLog[];
  knowledge: KnowledgeDoc[];
  asyncTasks: AsyncTask[];
  auditRecords: AuditRecord[];
  orgUsers: OrgUser[];
  searchTerm: string;
  globalRules: GlobalRules;
  dictionaries: DictionaryItem[];
  setSearchTerm: (term: string) => void;
  setUserRole: (role: UserRole, userId?: string, userName?: string, roleId?: string, roleIds?: string[], deptId?: string, orgId?: string, adminOrgIds?: string[], username?: string) => void;
  logout: () => void;
  setItems: (items: SupervisionItem[]) => void;
  addItem: (item: Partial<SupervisionItem>) => void;
  addItemToBackend: (item: Partial<SupervisionItem>, pageAuth?: ItemPageAuth) => Promise<{ id: string }>;
  updateItem: (id: string, updates: Partial<SupervisionItem>, pageAuth?: ItemPageAuth) => Promise<boolean>;
  addActivity: (activity: Omit<Activity, 'id' | 'timestamp'>) => Promise<void>;
  getItemById: (id: string) => SupervisionItem | undefined;
  updateTemplate: (template: Template) => Promise<void>;
  addTemplate: (template: Omit<Template, 'id'>) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;
  publishTemplate: (id: string) => Promise<void>;
  unpublishTemplate: (id: string) => Promise<void>;
  addUrgeRecord: (record: Omit<UrgeRecord, 'id' | 'timestamp'>) => Promise<void>;
  markAutoUrged: (key: string, dateStr: string) => void;
  clearStaleAutoUrged: (todayStr: string) => void;
  updateUrgeRecord: (id: string, updates: Partial<UrgeRecord>) => Promise<void>;
  addMessage: (message: Omit<Message, 'id' | 'timestamp' | 'read'>) => Promise<void>;
  markMessageRead: (id: string) => Promise<void>;
  deleteMessage: (id: string) => Promise<void>;
  deleteReadMessages: () => Promise<void>;
  addLog: (log: Omit<OperationLog, 'id' | 'timestamp' | 'ip'>) => Promise<void>;
  updateRole: (id: string, updates: Partial<Role>) => Promise<void>;
  addRole: (role: Role) => Promise<void>;
  deleteRole: (id: string) => Promise<void>;
  addAsyncTask: (task: Omit<AsyncTask, 'id' | 'startTime' | 'progress' | 'status'>) => Promise<void>;
  updateAsyncTask: (id: string, updates: Partial<AsyncTask>) => Promise<void>;
  addAuditRecord: (record: Omit<AuditRecord, 'id' | 'submitTime' | 'status'>) => Promise<void>;
  updateAuditRecord: (id: string, updates: Partial<AuditRecord>) => Promise<void>;
  addDepartment: (parentId: string, name: string, type?: string) => Promise<void>;
  updateDepartment: (id: string, name: string) => Promise<void>;
  deleteDepartment: (id: string) => Promise<void>;
  addOrgUser: (deptId: string, user: Partial<OrgUser>) => Promise<void>;
  batchAddOrgUsers: (deptId: string, users: Partial<OrgUser>[]) => Promise<void>;
  updateOrgUser: (id: string, user: Partial<OrgUser>) => Promise<void>;
  deleteOrgUser: (id: string) => Promise<void>;
  updateGlobalRules: (rules: Partial<GlobalRules>) => Promise<void>;
  addDictionaryItem: (item: Omit<DictionaryItem, 'id'>) => Promise<void>;
  updateDictionaryItem: (id: string, updates: Partial<DictionaryItem>) => Promise<void>;
  deleteDictionaryItem: (id: string) => Promise<void>;
  deleteItem: (id: string, pageAuth?: ItemPageAuth) => void;
  restoreItem: (id: string, pageAuth?: ItemPageAuth) => void;
  permanentlyDeleteItem: (id: string, pageAuth?: ItemPageAuth) => void;
  /** 废弃事项 */
  disableItem: (id: string, reason: string, pageAuth?: ItemPageAuth) => void;
  /** 撤销废弃 */
  undisableItem: (id: string, pageAuth?: ItemPageAuth) => void;
  /** 暂缓事项 */
  delayItem: (id: string, reason: string, newDeadline: string, pageAuth?: ItemPageAuth) => void;
  /** 责任人申请延期 */
  postponeItem: (id: string, reason: string, newDeadline: string, pageAuth?: ItemPageAuth) => void;
  /** 重启事项 */
  restartItem: (id: string, newDeadline: string, newContent?: string, pageAuth?: ItemPageAuth) => void;
  /** 责任人申请完成 */
  applyComplete: (id: string, note: string, pageAuth?: ItemPageAuth) => void;
  /** 跟进人未按要求完成 */
  applyUnsatisfied: (id: string, note: string, pageAuth?: ItemPageAuth) => void;
  /** 跟进人申请完成（给上级审批） */
  applyCompleteForApproval: (id: string, note: string, pageAuth?: ItemPageAuth) => void;
  /** 上级/跟进人审批完成 */
  approveComplete: (id: string, approved: boolean, reason?: string, pageAuth?: ItemPageAuth) => Promise<unknown>;
  /** 跟进人单独废弃某条子任务（不影响父级与其他子集） */
  disableSubTask: (id: string, subTaskId: string, reason: string, pageAuth?: ItemPageAuth) => void;
  /** 跟进人单独重启某条子任务 */
  restartSubTask: (id: string, subTaskId: string, pageAuth?: ItemPageAuth) => void;
  /** 跟进人单独催办某条子任务的指定责任人 */
  urgeSubTask: (itemId: string, itemTitle: string, subTask: import('../types').SubTask, content: string) => void;
  /** 跟进人驳回责任人 */
  rejectItem: (id: string, reason: string, pageAuth?: ItemPageAuth) => void;
  /** 共享事项 */
  shareItem: (id: string, sharedWith: import('../types').SharedUser[], pageAuth?: ItemPageAuth) => Promise<void>;
  /** 撤销共享 */
  revokeShareItem: (id: string, userId: string, pageAuth?: ItemPageAuth) => Promise<void>;
  lightRecords: LightRecord[];
  addLightRecord: (record: Omit<LightRecord, 'id' | 'createdAt'>) => Promise<void>;
  clearLightRecord: (itemId: string) => Promise<void>;
  // ─── 后端 API 同步方法 ───
  syncItems: (pageAuth?: ItemPageAuth) => Promise<void>;
  syncLightRecords: () => Promise<void>;
  syncMessages: () => Promise<void>;
  syncUrges: () => Promise<void>;
  syncDepartments: () => Promise<void>;
  syncOrgUsers: () => Promise<void>;
  syncRoles: () => Promise<void>;
  syncTemplates: () => Promise<void>;
  syncDictionaries: () => Promise<void>;
  syncGlobalRules: () => Promise<void>;
  syncAuditRecords: () => Promise<void>;
}

export const partializePersistedState = (state: WorkbenchState) => ({
  currentUser: state.currentUser,
  searchTerm: state.searchTerm,
});

export const migratePersistedState = (persistedState: unknown, version: number) => {
  if (version < 6) return undefined;
  return persistedState as WorkbenchState;
};


const generateTimeline = (itemId: string): TimelineNode[] => [
  { id: 't1', type: 'CREATE', user: '张管理', content: '发起了该督办事项', timestamp: '2026-05-01 10:00' },
  { id: 't2', type: 'SIGN', user: '李承办', content: '已签收该事项，并开始组织办理', timestamp: '2026-05-02 09:15' },
  { id: 't3', type: 'FEEDBACK', user: '李承办', content: '第一阶段调研工作已完成，正在汇总需求。', timestamp: '2026-05-15 16:30' },
  { id: 't4', type: 'URGE', user: '王跟进', content: '请加快进度，确保本月底前完成初步方案。', timestamp: '2026-06-01 11:00' },
  { id: 't5', type: 'FEEDBACK', user: '李承办', content: '初步方案已提交至院长办公室审核。', timestamp: '2026-06-10 14:20' },
];

const initialItems: SupervisionItem[] = [
  {
    id: '1',
    serialNo: 'DB-2026-001',
    title: '关于2026年二季度安全生产大检查的通知',
    content: '落实集团安全生产会议精神，开展全覆盖检查。',
    status: 'EXECUTING',
    deadline: '2026-06-30',
    ownerId: '2',
    ownerName: '李承办',
    followerId: '3',
    followerName: '王跟进',
    progress: 45,
    lightStatus: 'GREEN',
    lastFeedbackDate: '2026-06-10',
    category: '行政管理',
    campus: '集团总部',
    meetingSource: '2026年第4次办公会',
    subTasks: [
      {
        id: '1-sub-1',
        parentItemId: '1',
        title: '安全生产大检查责任任务',
        deadline: '2026-06-30',
        status: 'OVERDUE',
        assigneeId: '2',
        assigneeName: '李承办',
        progress: 45,
      },
    ],
    timeline: generateTimeline('1'),
  },
  {
    id: '2',
    serialNo: 'DB-2026-002',
    title: '三院区扩建项目进度跟进',
    content: '加快推进三院区住院大楼装修进度，确保按期交付。',
    status: 'EXECUTING',
    deadline: '2026-06-15',
    ownerId: '2',
    ownerName: '李承办',
    followerId: '3',
    followerName: '王跟进',
    progress: 80,
    lightStatus: 'RED',
    lastFeedbackDate: '2026-06-08',
    category: '工程建设',
    campus: '第三院区',
    meetingSource: '专项基建调度会',
    subTasks: [
      {
        id: '2-sub-1',
        parentItemId: '2',
        title: '扩建项目阶段任务',
        deadline: '2026-06-25',
        status: 'SUSPENDED',
        assigneeId: '2',
        assigneeName: '李承办',
        progress: 80,
      },
    ],
    timeline: [
      ...generateTimeline('2'),
      { id: 't6', type: 'DELAY', user: '李承办', content: '因材料供应推迟，申请延期至6月25日', timestamp: '2026-06-15 08:00' }
    ],
  },
  {
    id: '3',
    serialNo: 'DB-2026-003',
    title: '2026年上半年科研成果汇总',
    content: '收集各科室上半年发表论文及专利情况。',
    status: 'PENDING',
    deadline: '2026-07-10',
    ownerId: '4',
    ownerName: '赵科室',
    followerId: '3',
    followerName: '王跟进',
    progress: 0,
    lightStatus: 'YELLOW',
    category: '科研教育',
    campus: '全集团',
    timeline: [
      { id: 't1', type: 'CREATE', user: '张管理', content: '发起了该督办事项', timestamp: '2026-06-10 16:00' }
    ],
  },
  {
    id: '4',
    serialNo: 'DB-2026-004',
    title: '智慧医院系统二期验收',
    content: '完成智慧医院系统二期所有功能模块的验收工作。',
    status: 'COMPLETED',
    deadline: '2026-06-01',
    ownerId: '2',
    ownerName: '李承办',
    followerId: '3',
    followerName: '王跟进',
    progress: 100,
    lightStatus: 'GREEN',
    lastFeedbackDate: '2026-06-01',
    category: '信息化建设',
    campus: '集团总部',
    timeline: [
      ...generateTimeline('4'),
      { id: 't6', type: 'STATUS', user: '张管理', content: '验收通过，事项结案归档', timestamp: '2026-06-01 17:00' }
    ],
  },
];

const initialActivities: Activity[] = [
  { id: '1', content: '李承办 提交了【安全生产大检查】的进度反馈', timestamp: '2026-06-11 09:30', type: 'FEEDBACK' },
  { id: '2', content: '收到来自 王跟进 的【三院区扩建项目】催办消息', timestamp: '2026-06-11 08:45', type: 'URGE' },
  { id: '3', content: '系统自动将【三院区扩建项目】状态变更为 已延期', timestamp: '2026-06-11 00:00', type: 'STATUS_CHANGE' },
  { id: '4', content: '您有一项新分配的督办任务：【科研成果汇总】', timestamp: '2026-06-10 16:20', type: 'SYSTEM' },
];

const CLEARED_URGE_RECORD_IDS = new Set(['u1', 'u2', 'u3']);

const initialUrgeRecords: UrgeRecord[] = [];

function cleanUrgeRecords(records: UrgeRecord[] = []): UrgeRecord[] {
  return records.filter(record =>
    record.id &&
    !CLEARED_URGE_RECORD_IDS.has(record.id) &&
    record.itemId &&
    record.itemTitle &&
    record.sender &&
    record.receiver &&
    record.status &&
    record.method
  );
}

const initialTemplates: Template[] = [
  {
    id: '1',
    name: '行政管理通用模板',
    category: '行政管理',
    description: '适用于办公会议、日常行政事务的督办。',
    defaultDeadlineDays: 7,
    defaultFollowerId: '3',
    defaultFollowerName: '王跟进',
    status: 'PUBLISHED',
    rules: { yellowLightDays: 3, redLightHours: 1 }
  },
  {
    id: '2',
    name: '工程建设专项模板',
    category: '工程建设',
    description: '适用于基建、装修等工程类事项的节点管控。',
    defaultDeadlineDays: 30,
    defaultFollowerId: '3',
    defaultFollowerName: '王跟进',
    status: 'PUBLISHED',
    rules: { yellowLightDays: 7, redLightHours: 24 }
  }
];

const initialDepartments: DeptNode[] = [
  {
    id: 'root',
    name: '集团总部',
    type: 'GROUP',
    sortOrder: 0,
    children: [
      {
        id: 'd1',
        name: '院长办公室',
        type: 'DEPARTMENT',
        sortOrder: 0,
        children: [
          { id: 'd1-1', name: '秘书处', type: 'OFFICE', sortOrder: 0 },
          { id: 'd1-2', name: '督查室', type: 'OFFICE', sortOrder: 1 }
        ]
      },
      { id: 'd2', name: '人力资源部', type: 'DEPARTMENT', sortOrder: 1 },
      { id: 'd3', name: '财务管理部', type: 'DEPARTMENT', sortOrder: 2 },
      {
        id: 'd4',
        name: '医学技术集团',
        type: 'COMPANY',
        sortOrder: 3,
        children: [
          { id: 'd4-1', name: '综合监管处', type: 'OFFICE', sortOrder: 0 },
        ]
      },
      {
        id: 'd5',
        name: '海南一龄医疗产业发展有限公司',
        type: 'COMPANY',
        sortOrder: 4,
        children: [
          { id: 'd5-1', name: '医务部', type: 'DEPARTMENT', sortOrder: 0 },
        ]
      },
    ]
  }
];

const findOrgIdByDeptId = (departments: DeptNode[], deptId?: string): string | undefined => {
  if (!deptId) return undefined;

  const walk = (nodes: DeptNode[], currentOrgId?: string): string | undefined => {
    for (const node of nodes) {
      // P2-5: orgId 只认 type=COMPANY 的祖先节点
      const nextOrgId = node.type === 'COMPANY' ? node.id : currentOrgId;
      if (node.id === deptId) return nextOrgId;
      if (node.children) {
        const found = walk(node.children, nextOrgId);
        if (found) return found;
      }
    }
    return undefined;
  };

  return walk(departments);
};

const normalizeStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  }
  if (typeof value === 'string') {
    try {
      return normalizeStringArray(JSON.parse(value));
    } catch {
      return value.length > 0 ? [value] : [];
    }
  }
  return [];
};

const normalizeOrgUser = (user: OrgUser, departments: DeptNode[]): OrgUser => ({
  ...user,
  roleIds: normalizeStringArray(user.roleIds).length > 0 ? normalizeStringArray(user.roleIds) : (user.roleId ? [user.roleId] : []),
  adminOrgIds: normalizeStringArray(user.adminOrgIds),
  orgId: user.orgId || findOrgIdByDeptId(departments, user.deptId),
});

const mapApiUserToOrgUser = (user: any, departments: DeptNode[]): OrgUser =>
  normalizeOrgUser({
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    roleId: user.roleId,
    roleIds: normalizeStringArray(user.roleIds).length > 0 ? normalizeStringArray(user.roleIds) : (user.roleId ? [user.roleId] : []),
    email: user.email || '',
    phone: user.phone || '',
    deptId: user.deptId,
    orgId: user.orgId,
    status: user.status,
    supervisorId: user.supervisorId,
    adminOrgIds: normalizeStringArray(user.adminOrgIds),
  }, departments);

const mergeOrgUsers = (localUsers: OrgUser[], remoteUsers: OrgUser[], departments: DeptNode[]): OrgUser[] => {
  const merged = new Map<string, OrgUser>();

  for (const user of localUsers) {
    const normalized = normalizeOrgUser(user, departments);
    merged.set(normalized.username || normalized.id, normalized);
  }

  for (const user of remoteUsers) {
    const normalized = normalizeOrgUser(user, departments);
    const key = normalized.username || normalized.id;
    const existing = merged.get(key);
    merged.set(key, existing ? { ...existing, ...normalized, orgId: normalized.orgId || existing.orgId } : normalized);
  }

  return Array.from(merged.values());
};

const groupUsersByDeptId = (users: OrgUser[]) =>
  users.reduce<Record<string, OrgUser[]>>((acc, user) => {
    if (!user.deptId) return acc;
    if (!acc[user.deptId]) acc[user.deptId] = [];
    acc[user.deptId].push(user);
    return acc;
  }, {});

const initialOrgUsers: OrgUser[] = ([
  { id: '1', name: '张管理', username: 'admin', role: '超级管理员', roleId: 'r1', email: 'zhang@hospital.com', phone: '13800000001', status: 'ACTIVE', deptId: 'd1-2' },
  { id: '2', name: '李承办', username: 'owner', role: '责任人', roleId: 'r6', email: 'li@hospital.com', phone: '13800000002', status: 'ACTIVE', deptId: 'd1-1' },
  { id: '3', name: '王跟进', username: 'follower', role: '督办专员', roleId: 'r2', email: 'wang@hospital.com', phone: '13800000003', status: 'ACTIVE', deptId: 'd1-2' },
  { id: '4', name: '赵科室', username: 'zhaodept', role: '部门管理员', roleId: 'r3', email: 'zhao@hospital.com', phone: '13800000004', status: 'INACTIVE', deptId: 'd1' },
  { id: '5', name: '李承办处室', username: 'lichengban', role: '责任人', roleId: 'r6', email: 'lichengban@hospital.com', phone: '13800000005', status: 'ACTIVE', deptId: 'd1-1' },
  { id: '6', name: '丁敏', username: 'dingmin', role: '部门管理员', roleId: 'r3', email: 'dingmin@hospital.com', phone: '13800000006', status: 'ACTIVE', deptId: 'd5-1' },
  { id: '7', name: '魏红义', username: 'weihongyi', role: '责任人', roleId: 'r6', email: 'weihongyi@hospital.com', phone: '13800000007', status: 'ACTIVE', deptId: 'd4-1', supervisorId: '6' },
] as OrgUser[]).map(user => normalizeOrgUser(user, initialDepartments));

const initialMessages: Message[] = [
  { id: 'm1', title: '待办提醒', content: '您有一项新的督办任务待签收：【科研成果汇总】', type: 'TODO', timestamp: '2026-06-11 16:20', read: false, link: '/items/3' },
  { id: 'm2', title: '催办通知', content: '【三院区扩建项目】收到一条紧急催办', type: 'URGE', timestamp: '2026-06-11 08:45', read: true, link: '/items/2' },
  { id: 'm3', title: '系统公告', content: '督办系统 V1.0 正式上线运行', type: 'NOTICE', timestamp: '2026-06-01 09:00', read: true }
];

const allPageActions = Object.fromEntries(
  PERMISSION_TREE.flatMap((group) =>
    group.children.map((page) => [page.auth, page.actions.map((action) => action.value)]),
  ),
);

const initialRoles: Role[] = [
  { id: 'r1', name: '超级管理员', authCodes: ['ALL'], dataScope: 'ALL', followerDataScope: 'ALL', allowedActions: ['READ', 'SEARCH', 'EXPORT', 'EDIT_ITEM', 'EDIT_SYSTEM', 'CREATE_ITEM', 'DELETE_ITEM', 'SIGN_ITEM', 'FEEDBACK_ITEM', 'DELAY_ITEM', 'URGE_ITEM', 'CHANGE_ITEM', 'SUSPEND_ITEM', 'RESTART_ITEM', 'DISABLE_ITEM', 'REJECT_ITEM', 'APPROVE_ITEM', 'APPLY_COMPLETE_ITEM', 'MARK_UNSATISFIED_ITEM', 'SHARE_ITEM'], allowedPageActions: allPageActions },
  { id: 'r2', name: '督办跟进人', authCodes: ['MENU_WORKBENCH', 'MENU_MY_ITEMS', 'MENU_ITEMS', 'MENU_MONITORING', 'MENU_STATISTICS', 'MENU_MESSAGES', 'MENU_RECYCLE_BIN'], dataScope: 'SELF', followerDataScope: 'SELF', allowedActions: ['READ', 'SEARCH', 'EXPORT', 'EDIT_ITEM', 'CREATE_ITEM', 'DELETE_ITEM', 'URGE_ITEM', 'SIGN_ITEM', 'FEEDBACK_ITEM', 'CHANGE_ITEM', 'SUSPEND_ITEM', 'RESTART_ITEM', 'DISABLE_ITEM', 'REJECT_ITEM', 'APPROVE_ITEM', 'APPLY_COMPLETE_ITEM', 'MARK_UNSATISFIED_ITEM', 'SHARE_ITEM'] },
  { id: 'r3', name: '部门管理员', authCodes: ['MENU_WORKBENCH', 'MENU_MY_ITEMS', 'MENU_ITEMS', 'MENU_MONITORING', 'MENU_STATISTICS', 'MENU_MESSAGES'], dataScope: 'DEPT', followerDataScope: 'DEPT', allowedActions: ['READ', 'SEARCH', 'EXPORT'], allowedPageActions: { MENU_WORKBENCH: ['READ', 'SEARCH', 'EXPORT'], MENU_MY_ITEMS: ['READ', 'SEARCH'], MENU_ITEMS: ['READ', 'SEARCH', 'EXPORT'], MENU_STATISTICS: ['READ', 'SEARCH', 'EXPORT'] } },
  { id: 'r4dtsn6m', name: '督办管理员', authCodes: ['ALL'], dataScope: 'ALL', followerDataScope: 'ALL', allowedActions: ['READ', 'SEARCH', 'EXPORT', 'EDIT_ITEM', 'EDIT_SYSTEM', 'CREATE_ITEM', 'DELETE_ITEM', 'SIGN_ITEM', 'FEEDBACK_ITEM', 'DELAY_ITEM', 'URGE_ITEM', 'CHANGE_ITEM', 'SUSPEND_ITEM', 'RESTART_ITEM', 'DISABLE_ITEM', 'REJECT_ITEM', 'APPROVE_ITEM', 'APPLY_COMPLETE_ITEM', 'MARK_UNSATISFIED_ITEM', 'SHARE_ITEM'], allowedPageActions: allPageActions },
  { id: 'r5', name: '组织管理员', authCodes: ['MENU_WORKBENCH', 'MENU_MY_ITEMS', 'MENU_ITEMS', 'MENU_MESSAGES', 'MENU_MONITORING', 'MENU_STATISTICS', 'MENU_RECYCLE_BIN'], dataScope: 'MULTI_ORG', followerDataScope: 'MULTI_ORG', allowedActions: ['READ', 'SEARCH', 'EXPORT', 'CREATE_ITEM', 'DELETE_ITEM', 'URGE_ITEM', 'CHANGE_ITEM', 'SUSPEND_ITEM', 'RESTART_ITEM', 'DISABLE_ITEM', 'REJECT_ITEM', 'APPROVE_ITEM', 'APPLY_COMPLETE_ITEM', 'MARK_UNSATISFIED_ITEM', 'SHARE_ITEM'] },
  { id: 'r6', name: '责任人', authCodes: ['MENU_WORKBENCH', 'MENU_MY_ITEMS', 'MENU_ITEMS', 'MENU_MESSAGES'], dataScope: 'SELF', allowedActions: ['READ', 'SEARCH', 'SIGN_ITEM', 'FEEDBACK_ITEM', 'DELAY_ITEM', 'APPLY_COMPLETE_ITEM', 'SHARE_ITEM'] },
];

const initialLogs: OperationLog[] = [
  { id: 'l1', userId: '1', userName: '张管理', action: '修改模板配置', module: '模板管理', timestamp: '2026-06-11 10:30', ip: '192.168.1.102' },
  { id: 'l2', userId: '1', userName: '张管理', action: '发起督办事项', module: '督办立项', timestamp: '2026-06-11 09:15', ip: '192.168.1.102' },
  { id: 'l3', userId: '3', userName: '王跟进', action: '执行一键催办', module: '跟踪催办', timestamp: '2026-06-11 08:50', ip: '192.168.1.105' }
];

const initialKnowledge: KnowledgeDoc[] = [
  { id: 'k1', title: '医院督办管理办法 (2026修订版)', category: '管理制度', updateDate: '2026-01-15', size: '2.4 MB', downloads: 156 },
  { id: 'k2', title: '督办事项反馈操作指南', category: '操作手册', updateDate: '2026-05-20', size: '1.8 MB', downloads: 890 },
  { id: 'k3', title: '办公会议督办流程图', category: '业务流程', updateDate: '2026-03-10', size: '0.5 MB', downloads: 432 }
];

export const useStore = create<WorkbenchState>()(
  persist(
    (set, get) => ({
  currentUser: anonymousUser,
  items: [],
  activities: [],
  urgeRecords: [],
  autoUrgedKeys: {},
  templates: [],
  departments: [],
  messages: [],
  roles: initialRoles,
  pendingRoleUpdates: {} as Record<string, boolean>,
  logs: [],
  knowledge: [],
  asyncTasks: [],
  auditRecords: [],
  lightRecords: [],
  orgUsers: [],
  searchTerm: '',
  globalRules: {
    yellowLightDays: 3,
    redLightHours: 24,
    autoUrgeFrequency: 1,
    autoRemindEnabled: true,
    autoUrgeEnabled: false,
    urgeChannels: ['SYSTEM'],
    serialRule: {
      prefix: 'DB',
      showYear: true,
      sequenceLength: 3,
      connector: '-'
    },
    notifTemplates: {
      urge: '【催办】您负责的督办事项 {title} 已接近截止日期，请尽快反馈进度。',
      warning: '【预警】事项 {title} 已进入亮灯预警状态，请注意。',
      audit: '【审核】事项 {title} 已提交结案申请，请及时审核。'
    },
    auditFlow: {
      enableMultiLevel: false,
      auditRoles: ['ADMIN']
    }
  },
  dictionaries: [
    { id: '1', label: '行政管理', type: 'CATEGORY' },
    { id: '2', label: '医疗业务', type: 'CATEGORY' },
    { id: '3', label: '集团总部', type: 'CAMPUS' },
    { id: '4', label: '院长办公会', type: 'MEETING_SOURCE' },
    { id: '5', label: '特急', type: 'URGENCY' },
    { id: '6', label: '加急', type: 'URGENCY' },
    { id: '7', label: '常规', type: 'URGENCY' },
    { id: '8', label: '响应迅速', type: 'EVAL_TAG' },
    { id: '9', label: '材料详实', type: 'EVAL_TAG' },
  ],
  setSearchTerm: (term) => set({ searchTerm: term }),
  setUserRole: (role: UserRole, userId?: string, userName?: string, roleId?: string, roleIds?: string[], deptId?: string, orgId?: string, adminOrgIds?: string[], username?: string) => {
    if (!userId || !userName) return;
    const user: User = { id: userId, name: userName, username, role, roleId, roleIds, deptId, orgId, adminOrgIds };
    set((state) => {
      const existing = state.orgUsers.find(orgUser => orgUser.id === userId);
      const currentOrgUser: OrgUser = {
        id: userId,
        name: userName,
        username: username || existing?.username || userName,
        role: existing?.role || role,
        roleId,
        roleIds,
        email: existing?.email || '',
        phone: existing?.phone || '',
        status: existing?.status || 'ACTIVE',
        deptId: deptId || existing?.deptId || '',
        orgId: orgId || existing?.orgId,
        supervisorId: existing?.supervisorId,
        adminOrgIds: adminOrgIds || existing?.adminOrgIds || [],
      };

      const orgUsers = existing
        ? state.orgUsers.map(orgUser => orgUser.id === userId ? { ...existing, ...currentOrgUser } : orgUser)
        : [...state.orgUsers, currentOrgUser];

      const isSwitchingUser = Boolean(state.currentUser?.id && state.currentUser.id !== userId);

      return {
        currentUser: user,
        orgUsers,
        items: isSwitchingUser ? [] : state.items,
        messages: isSwitchingUser ? [] : state.messages,
        urgeRecords: isSwitchingUser ? [] : state.urgeRecords,
      };
    });
  },
  logout: () => {
    set({
      currentUser: anonymousUser,
      items: [],
      activities: [],
      urgeRecords: [],
      messages: [],
      templates: [],
      departments: [],
      orgUsers: [],
      logs: [],
      asyncTasks: [],
      auditRecords: [],
      lightRecords: [],
      knowledge: [],
      autoUrgedKeys: {},
    });
    try { localStorage.removeItem('duban-auth-token'); } catch {}
    try { localStorage.removeItem('duban-storage'); } catch {}
  },
  setItems: (items) => set({ items }),
  addItem: (item) => {
    const newId = item.id || Math.random().toString(36).slice(2, 11);
    set((state) => {
      const defaults: SupervisionItem = {
        id: newId,
        serialNo: `DB-${new Date().getFullYear()}-${String(state.items.length + 1).padStart(3, '0')}`,
      title: '',
      content: '',
      status: 'PENDING',
      deadline: '',
      issuerId: state.currentUser?.id,
      issuerName: state.currentUser?.name,
      issuerAccount: state.currentUser?.username || state.currentUser?.id,
      ownerId: '',
      ownerName: '',
      followerId: '',
      followerName: '',
      progress: 0,
      lightStatus: 'GREEN',
      category: '行政管理',
      campus: '集团总部',
      timeline: [{
        id: 't' + Date.now(),
        type: 'CREATE',
        user: state.currentUser?.name || '系统',
        content: '发起了该督办事项',
        timestamp: new Date().toLocaleString()
      }],
    };
    // 只合并 item 中非 undefined 的字段，避免覆盖默认值
    const createdItem: SupervisionItem = {
      ...defaults,
      ...Object.fromEntries(
        Object.entries(item).filter(([_, v]) => v !== undefined && v !== '')
      )
    } as SupervisionItem;
    const ownerIds = createdItem.ownerIds?.length ? createdItem.ownerIds : (createdItem.ownerId ? [createdItem.ownerId] : []);
    const ownerNames = createdItem.ownerNames?.length ? createdItem.ownerNames : (createdItem.ownerName ? [createdItem.ownerName] : []);
    const itemWithSubTasks: SupervisionItem = {
      ...createdItem,
      subTasks: createdItem.subTasks?.length
        ? createdItem.subTasks
        : ownerIds.map((ownerId, index) => ({
            id: `${createdItem.id}-${ownerId}`,
            parentItemId: createdItem.id,
            title: `${createdItem.serialNo} - ${ownerNames[index] || ownerId}`,
            deadline: createdItem.deadline,
            status: 'PENDING' as ItemStatus,
            assigneeId: ownerId,
            assigneeName: ownerNames[index] || ownerId,
            progress: 0,
            requiredCompletionDate: createdItem.requiredCompletionDate,
            plannedCompletionDate: createdItem.plannedCompletionDate,
          })),
    };

    const msgs: Message[] = [];
    ownerIds.forEach((ownerId, index) => {
      const ownerName = ownerNames[index] || ownerId;
      msgs.push({
        id: Math.random().toString(36).slice(2, 11),
        title: '新的待办任务',
        content: `您有新的督办事项待签收：【${itemWithSubTasks.title}】`,
        type: 'TODO' as const,
        timestamp: new Date().toLocaleString(),
        read: false,
        link: `/items/${itemWithSubTasks.id}`,
        receiverId: ownerId,
        receiverName: ownerName,
        senderId: state.currentUser.id,
        senderName: state.currentUser.name,
      });
    });
    if (itemWithSubTasks.followerName) {
      msgs.push({
        id: Math.random().toString(36).slice(2, 11),
        title: '新的跟进任务',
        content: `【${itemWithSubTasks.title}】已下发，您作为跟进人请关注进展。`,
        type: 'TODO' as const,
        timestamp: new Date().toLocaleString(),
        read: false,
        link: `/items/${itemWithSubTasks.id}`,
        receiverId: itemWithSubTasks.followerId,
        receiverName: itemWithSubTasks.followerName,
        senderId: state.currentUser.id,
        senderName: state.currentUser.name,
      });
    }

    return { items: [itemWithSubTasks, ...state.items], messages: [...msgs, ...state.messages] };
    });
  },
  addItemToBackend: async (item: Partial<SupervisionItem>, pageAuth?: ItemPageAuth) => {
    try {
      const { api } = await import('../lib/api');
      return await api.items.create(item, pageAuth);
    } catch (e) {
      console.warn('addItem 同步后端失败:', e);
      throw e; // 重新抛出，让组件捕获
    }
  },
  updateItem: async (id, updates, pageAuth) => {
    const apiUpdates = getItemApiUpdates(updates);
    if (Object.keys(apiUpdates).length > 0) {
      try {
        const { api } = await import('../lib/api');
        await api.items.update(id, apiUpdates, pageAuth);
      } catch (e) {
        console.warn('同步后端失败:', e);
        return false;
      }
    }
    set((state) => ({
      items: state.items.map(item => item.id === id ? { ...item, ...updates } : item)
    }));
    return true;
  },
  addActivity: async (activity) => {
    const newActivity = {
      id: Math.random().toString(36).slice(2, 11),
      timestamp: new Date().toLocaleString(),
      ...activity
    };
    try {
      const { api } = await import('../lib/api');
      await api.activities.create(newActivity);
      set((state) => ({ activities: [newActivity, ...state.activities] }));
    } catch (e) {
      console.warn('同步后端失败:', e);
    }
  },
  getItemById: (id: string) => {
    const item = get().items.find(item => item.id === id);
    // 确保 timeline 始终为数组，防止后端同步的数据缺少此字段导致崩溃
    return item ? { ...item, timeline: item.timeline || [] } : undefined;
  },
  updateTemplate: async (template) => {
    try {
      const { api } = await import('../lib/api');
      await api.templates.update(template.id, template);
      set((state) => ({
        templates: state.templates.map(t => t.id === template.id ? template : t)
      }));
    } catch (e) {
      console.warn('同步后端失败:', e);
    }
  },
  addTemplate: async (template) => {
    const newTemplate = {
      id: Math.random().toString(36).slice(2, 11),
      ...template
    };
    try {
      const { api } = await import('../lib/api');
      await api.templates.create(newTemplate);
      set((state) => ({ templates: [...state.templates, newTemplate] }));
    } catch (e) {
      console.warn('同步后端失败:', e);
    }
  },
  deleteTemplate: async (id) => {
    try {
      const { api } = await import('../lib/api');
      await api.templates.delete(id);
      set((state) => ({ templates: state.templates.filter(t => t.id !== id) }));
    } catch (e) {
      console.warn('同步后端失败:', e);
    }
  },
  publishTemplate: async (id) => {
    try {
      const { api } = await import('../lib/api');
      await api.templates.update(id, { status: 'PUBLISHED' });
      set((state) => ({
        templates: state.templates.map(t => t.id === id ? { ...t, status: 'PUBLISHED' as const } : t)
      }));
    } catch (e) {
      console.warn('同步后端失败:', e);
    }
  },
  unpublishTemplate: async (id) => {
    try {
      const { api } = await import('../lib/api');
      await api.templates.update(id, { status: 'INACTIVE' });
      set((state) => ({
        templates: state.templates.map(t => t.id === id ? { ...t, status: 'INACTIVE' as const } : t)
      }));
    } catch (e) {
      console.warn('同步后端失败:', e);
    }
  },
  addUrgeRecord: async (record) => {
    const payload = normalizeUrgePayload(record);
    const newRecord = {
      id: Math.random().toString(36).slice(2, 11),
      timestamp: new Date().toLocaleString(),
      ...payload
    };
    try {
      const { api } = await import('../lib/api');
      await api.urges.create(newRecord);
      set((state) => ({ urgeRecords: [newRecord, ...state.urgeRecords] }));
    } catch (e) {
      console.warn('同步后端失败:', e);
    }
  },
  // 记录“某事项今日已自动催办/超期”，随 localStorage 持久化，刷新页面后不重复生成
  markAutoUrged: (key: string, dateStr: string) => set((state) => ({
    autoUrgedKeys: { ...state.autoUrgedKeys, [key]: dateStr },
  })),
  // 跨天时清理非今天的去重键，避免无限增长
  clearStaleAutoUrged: (todayStr: string) => set((state) => {
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(state.autoUrgedKeys)) {
      if (v === todayStr) next[k] = v;
    }
    return { autoUrgedKeys: next };
  }),
  updateUrgeRecord: async (id, updates) => {
    try {
      if (updates.responseContent) {
        const { api } = await import('../lib/api');
        await api.urges.reply(id, updates.responseContent);
      }
      set((state) => ({
        urgeRecords: state.urgeRecords.map(r => r.id === id ? { ...r, ...updates } : r)
      }));
    } catch (e) {
      console.warn('同步后端失败:', e);
    }
  },
  addMessage: async (message) => {
    const payload = normalizeMessagePayload(message);
    const newMessage = {
      id: Math.random().toString(36).slice(2, 11),
      timestamp: new Date().toLocaleString(),
      read: false,
      ...payload
    };
    try {
      const { api } = await import('../lib/api');
      await api.messages.create(newMessage);
      set((state) => ({ messages: [newMessage, ...state.messages] }));
    } catch (e) {
      console.warn('同步后端失败:', e);
    }
  },
  markMessageRead: async (id) => {
    try {
      const { api } = await import('../lib/api');
      await api.messages.markRead(id);
      set((state) => ({
        messages: state.messages.map(m => m.id === id ? { ...m, read: true } : m)
      }));
    } catch (e) {
      console.warn('同步后端失败:', e);
    }
  },
  deleteMessage: async (id) => {
    try {
      const { api } = await import('../lib/api');
      await api.messages.delete(id);
      set((state) => ({ messages: state.messages.filter(m => m.id !== id) }));
    } catch (e) {
      console.warn('同步后端删除失败:', e);
    }
  },
  deleteReadMessages: async () => {
    try {
      const { api } = await import('../lib/api');
      await api.messages.deleteRead();
      set((state) => ({ messages: state.messages.filter(m => !m.read) }));
    } catch (e) {
      console.warn('批量删除后端同步失败:', e);
    }
  },
  addLog: async (log) => {
    try {
      const { api } = await import('../lib/api');
      const result = await api.logs.create({ action: log.action, module: log.module });
      set((state) => ({ logs: [result.log, ...state.logs] }));
    } catch (e) {
      console.warn('同步后端失败:', e);
    }
  },
  updateRole: async (id, updates) => {
    const previousRoles = get().roles;
    // 乐观更新：先更新本地 store，再同步后端，确保离线/后端不可用时 UI 也能响应
    // 同时标记 pending，防止 syncRoles 在此期间用服务器旧数据覆盖本地修改
    set((state) => ({
      roles: state.roles.map(r => r.id === id ? { ...r, ...updates } : r),
      pendingRoleUpdates: { ...state.pendingRoleUpdates, [id]: true },
    }));
    // 映射前端的 authCodes 为后端 permissions 字段
    const backendUpdates: Record<string, unknown> = { ...updates };
    if ('authCodes' in backendUpdates) {
      backendUpdates.permissions = backendUpdates.authCodes;
      delete backendUpdates.authCodes;
    }
    if ('followerDataScope' in backendUpdates && backendUpdates.followerDataScope === undefined) {
      backendUpdates.followerDataScope = null;
    }
    try {
      const { api } = await import('../lib/api');
      await api.roles.update(id, backendUpdates);
    } catch (e) {
      console.warn('同步后端失败:', e);
      // 回滚本地角色状态，避免 UI 显示“改成功了”但服务端实际未落库
      set({ roles: previousRoles });
    } finally {
      // 清除 pending 标记，此后 syncRoles 可以用服务器最新数据
      set((state) => {
        const { [id]: _, ...rest } = state.pendingRoleUpdates;
        return { pendingRoleUpdates: rest };
      });
    }
  },
  addRole: async (role) => {
    const previousRoles = get().roles;
    // 乐观更新：先更新本地 store，再同步后端
    set((state) => ({ roles: [...state.roles, role] }));
    // 映射前端的 authCodes 为后端 permissions 字段
    const backendRole: Record<string, unknown> = { ...role };
    if ('authCodes' in backendRole) {
      backendRole.permissions = backendRole.authCodes;
      delete backendRole.authCodes;
    }
    try {
      const { api } = await import('../lib/api');
      await api.roles.create(backendRole);
    } catch (e) {
      console.warn('同步后端失败:', e);
      set({ roles: previousRoles });
      throw e;
    }
  },
  deleteRole: async (id) => {
    // 乐观更新：先更新本地 store，再同步后端
    set((state) => ({ roles: state.roles.filter(r => r.id !== id) }));
    try {
      const { api } = await import('../lib/api');
      await api.roles.delete(id);
    } catch (e) {
      console.warn('同步后端失败:', e);
    }
  },
  addAsyncTask: async (task) => {
    const newTask = {
      id: Math.random().toString(36).slice(2, 11),
      startTime: new Date().toLocaleString(),
      progress: 0,
      status: 'PROCESSING' as const,
      ...task
    };
    try {
      const { api } = await import('../lib/api');
      await api.asyncTasks.create(newTask);
      set((state) => ({ asyncTasks: [newTask, ...state.asyncTasks] }));
    } catch (e) {
      console.warn('同步后端失败:', e);
    }
  },
  updateAsyncTask: async (id, updates) => {
    try {
      const { api } = await import('../lib/api');
      await api.asyncTasks.update(id, updates);
      set((state) => ({
        asyncTasks: state.asyncTasks.map(t => t.id === id ? { ...t, ...updates } : t)
      }));
    } catch (e) {
      console.warn('同步后端失败:', e);
    }
  },
  addAuditRecord: async (record) => {
    const newRecord = {
      id: Math.random().toString(36).slice(2, 11),
      submitTime: new Date().toLocaleString(),
      status: 'PENDING' as const,
      ...record
    };
    try {
      const { api } = await import('../lib/api');
      await api.audit.create(newRecord);
      set((state) => ({ auditRecords: [newRecord, ...state.auditRecords] }));
    } catch (e) {
      console.warn('同步后端失败:', e);
    }
  },
  updateAuditRecord: async (id, updates) => {
    try {
      const { api } = await import('../lib/api');
      await api.audit.update(id, updates);
      set((state) => ({
        auditRecords: state.auditRecords.map(r => r.id === id ? { ...r, ...updates } : r)
      }));
    } catch (e) {
      console.warn('同步后端失败:', e);
    }
  },
  addDepartment: async (parentId, name, deptType) => {
    const newId = generateClientId();
    const { api } = await import('../lib/api');
    await api.departments.create(newId, name, parentId, deptType);
    set((state) => {
      const newNode = (siblingNodes: DeptNode[] = []) => {
        const maxSort = siblingNodes.reduce((max, n) => Math.max(max, n.sortOrder || 0), 0);
        return { id: newId, name, type: deptType || 'DEPARTMENT', sortOrder: maxSort + 1 };
      };
      if (parentId === '__TOP__') {
        return { departments: [...state.departments, newNode(state.departments)] };
      }
      const addNode = (nodes: DeptNode[]): DeptNode[] => nodes.map(node => {
        if (node.id === parentId) {
          return {
            ...node,
            children: [...(node.children || []), newNode(node.children)]
          };
        }
        if (node.children) {
          return { ...node, children: addNode(node.children) };
        }
        return node;
      });
      return { departments: addNode(state.departments) };
    });
  },
  updateDepartment: async (id, name) => {
    const { api } = await import('../lib/api');
    await api.departments.update(id, name);
    set((state) => {
      const updateNode = (nodes: DeptNode[]): DeptNode[] => nodes.map(node => {
        if (node.id === id) return { ...node, name };
        if (node.children) return { ...node, children: updateNode(node.children) };
        return node;
      });
      return { departments: updateNode(state.departments) };
    });
  },
  deleteDepartment: async (id) => {
    const { api } = await import('../lib/api');
    await api.departments.delete(id);
    set((state) => {
      const removeNode = (nodes: DeptNode[]): DeptNode[] => nodes.filter(node => node.id !== id).map(node => ({
        ...node,
        children: node.children ? removeNode(node.children) : undefined
      }));
      return { departments: removeNode(state.departments) };
    });
  },
  addOrgUser: async (deptId, user) => {
    const newId = generateClientId();
    const nextUser = normalizeOrgUser({
      id: newId,
      deptId,
      name: '',
      role: '普通员工',
      email: '',
      phone: '',
      status: 'ACTIVE' as const,
      ...user,
    } as OrgUser, get().departments);
    const { api } = await import('../lib/api');
    await api.users.create(nextUser);
    set((state) => {
      return { orgUsers: [...state.orgUsers, nextUser] };
    });
  },
  batchAddOrgUsers: async (deptId, users) => {
    const newUsers = users.map(u => normalizeOrgUser({
      id: generateClientId(),
      deptId,
      name: '',
      role: '普通员工',
      email: '',
      phone: '',
      status: 'ACTIVE' as const,
      ...u,
    } as OrgUser, get().departments));
    const { api } = await import('../lib/api');
    await api.users.batchCreate(deptId, newUsers.map(u => ({
      id: u.id,
      name: u.name,
      username: u.username,
      role: u.role,
      roleId: u.roleId,
      email: u.email,
      phone: u.phone,
      orgId: u.orgId,
      supervisorId: u.supervisorId,
      status: u.status,
    })));
    set((state) => {
      return {
        orgUsers: [...state.orgUsers, ...(newUsers.map(u => ({ ...u, _id: undefined })) as any)],
      };
    });
  },
  deleteOrgUser: async (id) => {
    const normalizedId = String(id ?? '').trim();
    if (!normalizedId) {
      throw new Error('成员ID无效，无法删除');
    }

    const { api } = await import('../lib/api');
    await api.users.delete(normalizedId);
    set((state) => ({
      orgUsers: state.orgUsers.filter(u => String(u.id) !== normalizedId)
    }));
  },
  updateOrgUser: async (id, user) => {
    const prevUser = get().orgUsers.find(u => u.id === id);
    const nextUser = prevUser ? normalizeOrgUser({ ...prevUser, ...user } as OrgUser, get().departments) : user;
    const { api } = await import('../lib/api');
    await api.users.update(id, nextUser);
    set((state) => ({
      orgUsers: state.orgUsers.map(u => u.id === id ? nextUser as OrgUser : u)
    }));
  },
  updateGlobalRules: async (rules) => {
    try {
      const { api } = await import('../lib/api');
      await api.globalRules.update(rules);
      set((state) => ({ globalRules: { ...state.globalRules, ...rules } }));
    } catch (e) {
      console.warn('同步后端失败:', e);
      throw e;
    }
  },
  addDictionaryItem: async (item) => {
    const newItem = { ...item, id: Math.random().toString(36).slice(2, 11) };
    const payload = { ...newItem, value: (newItem as unknown as { value?: string }).value || newItem.label };
    try {
      const { api } = await import('../lib/api');
      await api.dictionaries.create(payload);
      set((state) => ({ dictionaries: [...state.dictionaries, newItem] }));
    } catch (e) {
      console.warn('同步后端失败:', e);
    }
  },
  updateDictionaryItem: async (id, updates) => {
    try {
      const { api } = await import('../lib/api');
      await api.dictionaries.update(id, updates);
      set((state) => ({
        dictionaries: state.dictionaries.map(d => d.id === id ? { ...d, ...updates } : d)
      }));
    } catch (e) {
      console.warn('同步后端失败:', e);
    }
  },
  deleteDictionaryItem: async (id) => {
    try {
      const { api } = await import('../lib/api');
      await api.dictionaries.delete(id);
      set((state) => ({ dictionaries: state.dictionaries.filter(d => d.id !== id) }));
    } catch (e) {
      console.warn('同步后端失败:', e);
    }
  },
  deleteItem: (id, pageAuth) => {
    const previousItems = get().items;
    const item = previousItems.find((candidate) => candidate.id === id);
    if (!item || item.status === 'DELETED') return;

    // 删除元数据由服务端在同一事务内生成；前端只提交删除意图，成功后立即全量回读权威数据。
    import('../lib/api').then(async ({ api }) => {
      try {
        await api.items.update(id, { status: 'DELETED' }, pageAuth);
        await get().syncItems();
      } catch (e) {
        console.warn('删除事项失败:', e);
      }
    });
  },
  restoreItem: (id, pageAuth) => {
    const item = get().items.find((candidate) => candidate.id === id);
    if (!item || item.status !== 'DELETED') return;

    import('../lib/api').then(async ({ api }) => {
      try {
        // 服务端使用 originalStatus 恢复真实状态，前端仅表达恢复意图。
        await api.items.update(id, { status: 'EXECUTING' }, pageAuth);
        await get().syncItems();
      } catch (e) {
        console.warn('恢复事项失败:', e);
      }
    });
  },
  permanentlyDeleteItem: (id, pageAuth) => {
    const previousItems = get().items;
    set((state) => ({
      items: state.items.filter(item => item.id !== id)
    }));
    import('../lib/api').then(({ api }) =>
      api.items.delete(id, pageAuth).catch((e) => warnAndRollbackItems(e, (items) => set({ items }), previousItems))
    );
  },
  disableItem: (id, reason, pageAuth) => {
    const previousItems = get().items;
    let nextApiPayload: Partial<SupervisionItem> = { status: 'DISABLED' as ItemStatus, disableReason: reason };
    set((state) => {
      const item = state.items.find(i => i.id === id);
      if (!item) return state;
      // 跟进人废弃：父级操作对所有子任务生效
      const subTaskUpdate = syncAllSubTasks(item, { status: 'DISABLED' as ItemStatus });
      nextApiPayload = { ...nextApiPayload, ...subTaskUpdate };
      return {
        items: state.items.map(i => i.id === id ? { ...i, ...subTaskUpdate, status: subTaskUpdate.status || 'DISABLED' as ItemStatus, timeline: [...i.timeline, { id: 't' + Date.now(), type: 'DISABLE', user: state.currentUser.name, content: `废弃事项。原因：${reason}`, timestamp: new Date().toLocaleString() }] } : i),
        activities: [{ id: Math.random().toString(36).slice(2, 11), content: `${state.currentUser.name} 废弃了督办事项：【${item.title}】`, timestamp: new Date().toLocaleString(), type: 'STATUS_CHANGE' } as Activity, ...state.activities]
      };
    });
    import('../lib/api').then(({ api }) =>
      api.items.update(id, nextApiPayload, pageAuth).catch((e) => warnAndRollbackItems(e, (items) => set({ items }), previousItems))
    );
  },
  undisableItem: (id, pageAuth) => {
    const previousItems = get().items;
    let nextApiPayload: Partial<SupervisionItem> = { status: 'EXECUTING' as ItemStatus };
    set((state) => {
      const item = state.items.find(i => i.id === id);
      if (!item) return state;
      // 撤销废弃：仅被废弃的子任务回到执行中，已办结子任务保持不变
      let subTasks = item.subTasks;
      let nextStatus: ItemStatus = 'EXECUTING';
      if (item.subTasks?.length) {
        subTasks = item.subTasks.map(t => t.status === 'DISABLED' ? { ...t, status: 'EXECUTING' as ItemStatus } : t);
        nextStatus = aggregateSubTaskStatus(subTasks);
      }
      nextApiPayload = { status: nextStatus, ...(subTasks && subTasks.length ? { subTasks } : {}) } as Partial<SupervisionItem>;
      return {
        items: state.items.map(i => i.id === id ? { ...i, subTasks, status: nextStatus, timeline: [...i.timeline, { id: 't' + Date.now(), type: 'RESTART', user: state.currentUser.name, content: '撤销废弃，事项重新启动', timestamp: new Date().toLocaleString() }] } : i),
        activities: [{ id: Math.random().toString(36).slice(2, 11), content: `${state.currentUser.name} 撤销废弃了督办事项：【${item.title}】`, timestamp: new Date().toLocaleString(), type: 'STATUS_CHANGE' } as Activity, ...state.activities]
      };
    });
    import('../lib/api').then(({ api }) =>
      api.items.update(id, nextApiPayload, pageAuth).catch((e) => warnAndRollbackItems(e, (items) => set({ items }), previousItems))
    );
  },
  delayItem: (id, reason, newDeadline, pageAuth) => {
    const previousItems = get().items;
    const targetItem = previousItems.find(i => i.id === id);
    const isMultiOwner = (targetItem?.subTasks?.length || 0) > 1;
    let nextApiPayload: Partial<SupervisionItem> = isMultiOwner
      ? { status: 'SUSPENDED' as ItemStatus }
      : { status: 'SUSPENDED' as ItemStatus, deadline: newDeadline };
    set((state) => {
      const item = state.items.find(i => i.id === id);
      if (!item) return state;
      // 跟进人暂缓：父级操作对所有子任务生效
      const subTaskUpdate = syncAllSubTasks(item, { status: 'SUSPENDED' as ItemStatus });
      nextApiPayload = { ...nextApiPayload, ...subTaskUpdate };
      return {
        items: state.items.map(i => i.id === id ? {
          ...i,
          ...subTaskUpdate,
          status: subTaskUpdate.status || 'SUSPENDED' as ItemStatus,
          timeline: [...i.timeline, { id: 't' + Date.now(), type: 'SUSPEND', user: state.currentUser.name, content: `暂缓事项。原因：${reason}，计划恢复：${newDeadline}`, timestamp: new Date().toLocaleString() }],
        } : i),
        activities: [{ id: Math.random().toString(36).slice(2, 11), content: `${state.currentUser.name} 暂缓了督办事项：【${item.title}】`, timestamp: new Date().toLocaleString(), type: 'STATUS_CHANGE' } as Activity, ...state.activities]
      };
    });
    import('../lib/api').then(({ api }) =>
      api.items.update(id, nextApiPayload, pageAuth).catch((e) => warnAndRollbackItems(e, (items) => set({ items }), previousItems))
    );
  },
  postponeItem: (id, reason, newDeadline, pageAuth) => {
    const previousItems = get().items;
    const targetItem = previousItems.find(i => i.id === id);
    const currentUserId = get().currentUser.id;
    if (!targetItem) return;
    const isOwner = targetItem.ownerId === currentUserId || targetItem.ownerIds?.includes(currentUserId);
    const effectiveStatus = getEffectiveStatusForUser(targetItem, currentUserId);
    if (!isOwner || effectiveStatus !== 'OVERDUE') return;
    const isMultiOwner = (targetItem.subTasks?.length || 0) > 1;
    let nextApiPayload: Partial<SupervisionItem> = isMultiOwner
      ? { status: 'DELAYED' as ItemStatus }
      : { status: 'DELAYED' as ItemStatus, deadline: newDeadline, plannedCompletionDate: newDeadline };
    set((state) => {
      const item = state.items.find(i => i.id === id);
      if (!item) return state;
      // 多责任人：仅修改当前责任人子任务的计划完成日期，不动全局要求日期
      const subTaskUpdate = isMultiOwner
        ? updateUserSubTaskForIdentity(item, state.currentUser, { status: 'DELAYED' as ItemStatus, plannedCompletionDate: newDeadline, deadline: newDeadline })
        : {};
      nextApiPayload = { ...nextApiPayload, ...subTaskUpdate };
      return {
        items: state.items.map(i => i.id === id ? {
          ...i,
          ...subTaskUpdate,
          status: subTaskUpdate.status || (isMultiOwner ? i.status : 'DELAYED' as ItemStatus),
          ...(isMultiOwner ? {} : { plannedCompletionDate: newDeadline, deadline: newDeadline }),
          timeline: [...i.timeline, { id: 't' + Date.now(), type: 'DELAY', user: state.currentUser.name, content: `申请延期。原因：${reason}，新计划完成日期：${newDeadline}`, timestamp: new Date().toLocaleString() }],
        } : i),
        activities: [{ id: Math.random().toString(36).slice(2, 11), content: `${state.currentUser.name} 对【${item.title}】申请延期`, timestamp: new Date().toLocaleString(), type: 'STATUS_CHANGE' } as Activity, ...state.activities]
      };
    });
    import('../lib/api').then(({ api }) =>
      api.items.update(id, nextApiPayload, pageAuth).catch((e) => warnAndRollbackItems(e, (items) => set({ items }), previousItems))
    );
  },
  restartItem: (id, newDeadline, _newContent, pageAuth) => {
    const previousItems = get().items;
    let nextApiPayload: Partial<SupervisionItem> = { status: 'EXECUTING' as ItemStatus, deadline: newDeadline, plannedCompletionDate: newDeadline };
    set((state) => {
      const item = state.items.find(i => i.id === id);
      if (!item) return state;
      // 重启：已办结/已删除子任务保持不变，其余回到执行中
      const subTaskUpdate = syncAllSubTasks(item, { status: 'EXECUTING' as ItemStatus, plannedCompletionDate: newDeadline, deadline: newDeadline }, { preserveFinal: true });
      nextApiPayload = { ...nextApiPayload, ...subTaskUpdate };
      return {
        items: state.items.map(i => i.id === id ? {
          ...i,
          ...subTaskUpdate,
          status: subTaskUpdate.status || 'EXECUTING' as ItemStatus,
          restartDate: newDeadline,
          plannedCompletionDate: newDeadline,
          timeline: [...i.timeline, { id: 't' + Date.now(), type: 'RESTART', user: state.currentUser.name, content: `重启事项，新计划完成日期：${newDeadline}`, timestamp: new Date().toLocaleString() }],
        } : i),
        activities: [{ id: Math.random().toString(36).slice(2, 11), content: `${state.currentUser.name} 重启了督办事项：【${item.title}】`, timestamp: new Date().toLocaleString(), type: 'STATUS_CHANGE' } as Activity, ...state.activities]
      };
    });
    import('../lib/api').then(({ api }) =>
      api.items.update(id, nextApiPayload, pageAuth).catch((e) => warnAndRollbackItems(e, (items) => set({ items }), previousItems))
    );
  },
  disableSubTask: (id, subTaskId, reason, pageAuth) => {
    const previousItems = get().items;
    let nextApiPayload: Partial<SupervisionItem> = {};
    set((state) => {
      const item = state.items.find(i => i.id === id);
      if (!item || !item.subTasks) return state;
      const target = item.subTasks.find(t => t.id === subTaskId);
      const nextSubTasks = item.subTasks.map(t => t.id === subTaskId ? { ...t, status: 'DISABLED' as ItemStatus } : t);
      const nextStatus = aggregateSubTaskStatus(nextSubTasks);
      nextApiPayload = { status: nextStatus, subTasks: nextSubTasks } as Partial<SupervisionItem>;
      return {
        items: state.items.map(i => i.id === id ? {
          ...i,
          subTasks: nextSubTasks,
          status: nextStatus,
          timeline: [...i.timeline, { id: 't' + Date.now(), type: 'DISABLE', user: state.currentUser.name, content: `废弃子任务（责任人：${target?.assigneeName || ''}）。原因：${reason}`, timestamp: new Date().toLocaleString() }],
        } : i),
      };
    });
    import('../lib/api').then(({ api }) =>
      api.items.update(id, nextApiPayload, pageAuth).catch((e) => warnAndRollbackItems(e, (items) => set({ items }), previousItems))
    );
  },
  restartSubTask: (id, subTaskId, pageAuth) => {
    const previousItems = get().items;
    let nextApiPayload: Partial<SupervisionItem> = {};
    set((state) => {
      const item = state.items.find(i => i.id === id);
      if (!item || !item.subTasks) return state;
      const target = item.subTasks.find(t => t.id === subTaskId);
      const nextSubTasks = item.subTasks.map(t => t.id === subTaskId ? { ...t, status: 'EXECUTING' as ItemStatus } : t);
      const nextStatus = aggregateSubTaskStatus(nextSubTasks);
      nextApiPayload = { status: nextStatus, subTasks: nextSubTasks } as Partial<SupervisionItem>;
      return {
        items: state.items.map(i => i.id === id ? {
          ...i,
          subTasks: nextSubTasks,
          status: nextStatus,
          timeline: [...i.timeline, { id: 't' + Date.now(), type: 'RESTART', user: state.currentUser.name, content: `重启子任务（责任人：${target?.assigneeName || ''}）`, timestamp: new Date().toLocaleString() }],
        } : i),
      };
    });
    import('../lib/api').then(({ api }) =>
      api.items.update(id, nextApiPayload, pageAuth).catch((e) => warnAndRollbackItems(e, (items) => set({ items }), previousItems))
    );
  },
  urgeSubTask: (itemId, itemTitle, subTask, content) => {
    import('../lib/api').then(({ api }) =>
      api.urges.create({
        itemId,
        itemTitle,
        receiverId: subTask.assigneeId || undefined,
        receiver: subTask.assigneeName || undefined,
        subTaskId: subTask.id,
        sender: get().currentUser.name,
        content,
        method: 'MESSAGE',
      }).catch((e: unknown) => console.error('催办子任务失败', e))
    );
  },
  applyComplete: (id, note, pageAuth) => {
    const previousItems = get().items;
    let nextSubTasks: SupervisionItem['subTasks'];
    let nextTimeline: SupervisionItem['timeline'];
    set((state) => {
      const item = state.items.find(i => i.id === id);
      if (!item) return state;
      nextSubTasks = item.subTasks?.map(task =>
        task.assigneeId === state.currentUser.id
          ? { ...task, status: 'REVIEWING' as ItemStatus, progress: 100, followerApprovedBy: '', finalApprovedBy: '' }
          : task
      );
      nextTimeline = [...(item.timeline || []), { id: 't' + Date.now(), type: 'APPLY_COMPLETE', user: state.currentUser.name, content: `申请完成：${note}`, timestamp: new Date().toLocaleString() }];
      return {
        items: state.items.map(i => i.id === id ? { ...i, status: 'REVIEWING' as ItemStatus, subTasks: nextSubTasks || i.subTasks, timeline: nextTimeline } : i)
      };
    });
    import('../lib/api').then(({ api }) =>
      api.items.update(id, { status: 'REVIEWING', subTasks: nextSubTasks, timeline: nextTimeline }, pageAuth).catch((e) => warnAndRollbackItems(e, (items) => set({ items }), previousItems))
    );
  },
  applyUnsatisfied: (id, note, pageAuth) => {
    const previousItems = get().items;
    let nextTimeline: SupervisionItem['timeline'] | undefined;
    let nextSubTasks: SupervisionItem['subTasks'] | undefined;
    set((state) => {
      const item = state.items.find(i => i.id === id);
      if (!item) return state;
      const timelineNode = {
        id: 't' + Date.now(),
        type: 'SATISFIED' as const,
        user: state.currentUser.name,
        content: `未按要求完成：${note.trim() || '未提供说明'}`,
        timestamp: new Date().toLocaleString(),
      };
      nextTimeline = [...item.timeline, timelineNode];
      // 所有责任人子任务状态统一变更为「未按要求完成」，与督办状态保持一致
      nextSubTasks = item.subTasks?.map(task => task.status === 'DELETED' ? task : { ...task, status: 'NOT_SATISFIED' as ItemStatus });
      return {
        items: state.items.map(i => i.id === id ? { ...i, status: 'NOT_SATISFIED' as ItemStatus, subTasks: nextSubTasks || i.subTasks, timeline: nextTimeline || i.timeline } : i)
      };
    });
    import('../lib/api').then(({ api }) =>
      api.items.update(id, { status: 'NOT_SATISFIED', subTasks: nextSubTasks, timeline: nextTimeline }, pageAuth).catch((e) => warnAndRollbackItems(e, (items) => set({ items }), previousItems))
    );
  },
  applyCompleteForApproval: (id, note, pageAuth) => {
    const previousItems = get().items;
    let nextSubTasks: SupervisionItem['subTasks'];
    set((state) => {
      const item = state.items.find(i => i.id === id);
      if (!item) return state;
      nextSubTasks = item.subTasks?.map(task => ({ ...task, status: 'REVIEWING' as ItemStatus, progress: 100, followerApprovedBy: state.currentUser.name, finalApprovedBy: '' }));
      return {
        items: state.items.map(i => i.id === id ? { ...i, status: 'REVIEWING' as ItemStatus, subTasks: nextSubTasks || i.subTasks, timeline: [...i.timeline, { id: 't' + Date.now(), type: 'APPLY_COMPLETE', user: state.currentUser.name, content: `跟进人申请完成（待上级审批）：${note}`, timestamp: new Date().toLocaleString() }] } : i)
      };
    });
    import('../lib/api').then(({ api }) =>
      api.items.update(id, { status: 'REVIEWING', subTasks: nextSubTasks }, pageAuth).catch((e) => warnAndRollbackItems(e, (items) => set({ items }), previousItems))
    );
  },
  approveComplete: (id, approved, reason, pageAuth) => {
    const previousItems = get().items;
    let nextSubTasks: SupervisionItem['subTasks'];
    let nextStatus: ItemStatus = approved ? 'COMPLETED' : 'EXECUTING';
    let serverStatusForUpdate: ItemStatus = approved ? 'COMPLETED' : 'EXECUTING';
    set((state) => {
      const item = state.items.find(i => i.id === id);
      if (!item) return state;
      const followerIds = [item.followerId, ...(item.followerIds || [])].filter(Boolean);
      let followerSupervisorIds = [...new Set(followerIds.flatMap((followerId) => {
        const follower = state.orgUsers.find(user => user.id === followerId);
        const supervisorId = follower?.supervisorId;
        const supervisor = supervisorId ? state.orgUsers.find(user => user.id === supervisorId && user.status === 'ACTIVE') : undefined;
        return supervisor ? [supervisor.id] : [];
      }))];
      // 兜底：组织未配置跟进人上级时，由管理员（督办管理员）承担终审，与后端保持一致
      if (followerSupervisorIds.length === 0) {
        followerSupervisorIds = state.orgUsers
          .filter((user) => (user.status === undefined || user.status === null || user.status === 'ACTIVE')
            && (user.role === 'ADMIN' || (Array.isArray((user as any).permissions) && (user as any).permissions.includes('ALL'))))
          .map((user) => user.id);
      }
      const isFinalApprover = followerSupervisorIds.includes(state.currentUser.id);
        if (approved) {
          if (isFinalApprover) {
            // 终审办结：办结所有「已通过跟进人本级（followerApprovedBy 非空）」的子任务；其余子任务（其他责任人尚未走到终审）不受影响
            nextSubTasks = item.subTasks?.map((task) =>
              (task.status === 'REVIEWING' && task.followerApprovedBy)
                ? { ...task, status: 'COMPLETED' as ItemStatus, progress: 100, finalApprovedBy: state.currentUser.name }
                : task
            );
            nextStatus = (nextSubTasks && nextSubTasks.length)
              ? aggregateSubTaskStatus(nextSubTasks)
              : 'COMPLETED';
          } else {
            // 非终审（跟进人审批）：将尚无跟进人审批的子任务标记 followerApprovedBy；父级保持「待审批完成」，等待上级终审
            nextSubTasks = item.subTasks?.map((task) =>
              (task.status === 'REVIEWING' && !task.followerApprovedBy)
                ? { ...task, followerApprovedBy: state.currentUser.name }
                : task
            );
            nextStatus = 'REVIEWING';
          }
          // 始终向服务端发送 COMPLETED 以触发后端终审分支（后端按 isFinalApprover 决定实际状态）
          serverStatusForUpdate = 'COMPLETED';
          return {
            items: state.items.map(i => i.id === id ? { ...i, status: nextStatus, subTasks: nextSubTasks || i.subTasks, timeline: [...i.timeline, { id: 't' + Date.now(), type: 'APPROVE', user: state.currentUser.name, content: isFinalApprover ? '审批通过，事项已完成' : '审批通过，已提交上级领导终审', timestamp: new Date().toLocaleString() }] } : i),
            activities: [{ id: Math.random().toString(36).slice(2, 11), content: `${state.currentUser.name} 审批通过：【${item.title}】${isFinalApprover ? '已完成' : '已提交上级领导终审'}`, timestamp: new Date().toLocaleString(), type: 'STATUS_CHANGE' } as Activity, ...state.activities]
          };
        }
      nextSubTasks = item.subTasks?.map(task =>
        task.status === 'REVIEWING'
          ? { ...task, status: 'EXECUTING' as ItemStatus }
          : task
      );
      return {
        items: state.items.map(i => i.id === id ? { ...i, status: 'EXECUTING' as ItemStatus, subTasks: nextSubTasks || i.subTasks, rejectReason: reason || '审批未通过', timeline: [...i.timeline, { id: 't' + Date.now(), type: 'REJECT', user: state.currentUser.name, content: `审批驳回：${reason || '未满足完成条件'}`, timestamp: new Date().toLocaleString() }] } : i),
        activities: [{ id: Math.random().toString(36).slice(2, 11), content: `${state.currentUser.name} 驳回了【${item.title}】的完成申请：${reason || ''}`, timestamp: new Date().toLocaleString(), type: 'STATUS_CHANGE' } as Activity, ...state.activities]
      };
    });
    const rejectReason = approved ? undefined : reason?.trim();
    return import('../lib/api').then(({ api }) =>
      api.items.update(id, {
        status: serverStatusForUpdate,
        subTasks: nextSubTasks,
        ...(rejectReason ? { rejectReason } : {}),
      }, pageAuth).catch((e) => {
        warnAndRollbackItems(e, (items) => set({ items }), previousItems);
        throw e;
      })
    );
  },
  shareItem: async (id, sharedWith, pageAuth) => {
    const state = get();
    const item = state.items.find(i => i.id === id);
    if (!item) return;
    const existingUserIds = new Set((item.sharedWith || []).map(shared => shared.userId));
    const uniqueSharedWith = sharedWith.filter(shared => !existingUserIds.has(shared.userId));
    if (uniqueSharedWith.length === 0) return;
    const nextSharedWith = [...(item.sharedWith || []), ...uniqueSharedWith];
    const timelineNode: TimelineNode = {
      id: 't' + Date.now(),
      type: 'SHARE',
      user: state.currentUser.name,
      content: `共享给：${uniqueSharedWith.map(s => s.userName).join('、')}`,
      timestamp: new Date().toLocaleString()
    };
    const nextTimeline = [...item.timeline, timelineNode];
    try {
      const { api } = await import('../lib/api');
      await api.items.update(id, { sharedWith: nextSharedWith, timeline: nextTimeline }, pageAuth);
      set((current) => ({
        items: current.items.map(i => i.id === id ? {
          ...i,
          sharedWith: nextSharedWith,
          timeline: nextTimeline
        } : i)
      }));
    } catch (e) {
      console.warn('共享事项同步后端失败:', e);
    }
  },
  revokeShareItem: async (id, userId, pageAuth) => {
    const state = get();
    const item = state.items.find(i => i.id === id);
    if (!item) return;
    const revokedUser = item.sharedWith?.find(shared => shared.userId === userId);
    if (!revokedUser) return;
    const nextSharedWith = (item.sharedWith || []).filter(shared => shared.userId !== userId);
    const timelineNode: TimelineNode = {
      id: 't' + Date.now(),
      type: 'SHARE',
      user: state.currentUser.name,
      content: `撤销共享：${revokedUser.userName}`,
      timestamp: new Date().toLocaleString()
    };
    const nextTimeline = [...item.timeline, timelineNode];
    try {
      const { api } = await import('../lib/api');
      await api.items.update(id, { sharedWith: nextSharedWith, timeline: nextTimeline }, pageAuth);
      set((current) => ({
        items: current.items.map(i => i.id === id ? {
          ...i,
          sharedWith: nextSharedWith,
          timeline: nextTimeline
        } : i)
      }));
    } catch (e) {
      console.warn('撤销共享同步后端失败:', e);
    }
  },
  addLightRecord: async (record) => {
    const newRecord = {
      id: Math.random().toString(36).slice(2, 11),
      createdAt: new Date().toLocaleString(),
      ...record
    };
    try {
      const { api } = await import('../lib/api');
      await api.lightRecords.create(newRecord);
      await get().syncLightRecords();
      set((state) => ({
        items: state.items.map((item) => item.id === record.itemId ? { ...item, lightStatus: record.color } : item),
      }));
    } catch (e) {
      console.warn('同步后端失败:', e);
    }
  },
  clearLightRecord: async (itemId) => {
    try {
      const { api } = await import('../lib/api');
      await api.lightRecords.clearByItemId(itemId);
      await get().syncLightRecords();
      set((state) => ({
        items: state.items.map((item) => item.id === itemId ? { ...item, lightStatus: undefined } : item),
      }));
    } catch (e) {
      console.warn('同步后端失败:', e);
    }
  },
  rejectItem: (id, reason, pageAuth) => {
    const previousItems = get().items;
    const rejectReason = reason.trim();
    if (!rejectReason) return;
    let nextSubTasks: SupervisionItem['subTasks'];
    set((state) => {
      const item = state.items.find(i => i.id === id);
      if (!item) return state;
      nextSubTasks = item.subTasks?.map(task =>
        task.status === 'REVIEWING'
          ? { ...task, status: 'EXECUTING' as ItemStatus }
          : task
      );
      const newTimelineNode: TimelineNode = {
        id: 't' + Date.now(),
        type: 'REJECT',
        user: state.currentUser.name,
        content: `审批驳回：${rejectReason}`,
        timestamp: new Date().toLocaleString()
      };
      const newActivity: Activity = {
        id: Math.random().toString(36).slice(2, 11),
        content: `${state.currentUser.name} 驳回了【${item.title}】的完成申请：${rejectReason}`,
        timestamp: new Date().toLocaleString(),
        type: 'STATUS_CHANGE'
      };
      const newLog: OperationLog = {
        id: Math.random().toString(36).slice(2, 11),
        userId: state.currentUser.id,
        userName: state.currentUser.name,
        action: '审批驳回',
        module: '督办事项',
        timestamp: new Date().toLocaleString(),
        ip: '127.0.0.1'
      };
      return {
        items: state.items.map(i => i.id === id ? {
          ...i,
          status: 'EXECUTING',
          subTasks: nextSubTasks || i.subTasks,
          rejectReason,
          timeline: [...i.timeline, newTimelineNode]
        } : i),
        activities: [newActivity, ...state.activities],
        logs: [newLog, ...state.logs]
      };
    });
    import('../lib/api').then(({ api }) =>
      api.items.update(id, { status: 'EXECUTING', subTasks: nextSubTasks, rejectReason }, pageAuth).catch((e) => warnAndRollbackItems(e, (items) => set({ items }), previousItems))
    );
  },
  // ─── 后端 API 同步方法 ───
  syncItems: async (pageAuth) => {
    try {
      const { api } = await import('../lib/api');
      const firstPage = await api.items.list(1, 200, pageAuth);
      if (!Array.isArray(firstPage.data)) return;
      const pages = [firstPage.data];
      // 现有工作台/统计仍依赖全局事项集合；按页取数保证服务端不会再全表加载时间轴。
      // 后续页面筛选迁移为服务端条件后，可删除这段兼容聚合。
      for (let page = 2; page <= firstPage.pagination.totalPages; page += 1) {
        const response = await api.items.list(page, firstPage.pagination.pageSize, pageAuth);
        if (!Array.isArray(response.data)) break;
        pages.push(response.data);
      }
      set({
        items: resolveSyncedItems(pages.flat(), get().items, []),
      });
    } catch (e) {
      console.warn('syncItems 失败（后端可能未启动）:', e);
      set({ items: [] });
    }
  },
  syncLightRecords: async () => {
    try {
      const { api } = await import('../lib/api');
      const data = await api.lightRecords.list();
      if (Array.isArray(data)) {
        set({ lightRecords: data as LightRecord[] });
      }
    } catch (e) {
      console.warn('syncLightRecords 失败（后端可能未启动）:', e);
    }
  },
  syncMessages: async () => {
    try {
      const { api } = await import('../lib/api');
      const data = await api.messages.list();
      if (Array.isArray(data)) {
        set({ messages: data as Message[] });
      }
    } catch (e) {
      console.warn('syncMessages 失败（后端可能未启动）:', e);
    }
  },
  syncUrges: async () => {
    try {
      const { api } = await import('../lib/api');
      const data = await api.urges.list();
      if (Array.isArray(data)) {
        set({ urgeRecords: cleanUrgeRecords(data as UrgeRecord[]) });
      }
    } catch (e) {
      console.warn('syncUrges 失败（后端可能未启动）:', e);
    }
  },
  syncDepartments: async () => {
    try {
      const { api } = await import('../lib/api');
      const data = await api.departments.tree();
      if (Array.isArray(data)) {
        set({ departments: data as DeptNode[] });
      }
    } catch (e) {
      console.warn('syncDepartments 失败（后端可能未启动）:', e);
    }
  },
  syncOrgUsers: async () => {
    try {
      const { api } = await import('../lib/api');
      const departments = get().departments;
      const remoteData = await api.users.list();
      const finalUsers = Array.isArray(remoteData)
        ? remoteData.map((u: any) => mapApiUserToOrgUser(u, departments))
        : [];

      set({ orgUsers: finalUsers as any });
    } catch (e) {
      console.warn('syncOrgUsers 失败（后端可能未启动）:', e);
    }
  },
  syncRoles: async () => {
    try {
      const { api } = await import('../lib/api');
      const data = await api.roles.list();
      const remoteRoles = Array.isArray(data) ? data : [];
      const missingRoles = getMissingRolesToCreate(initialRoles, remoteRoles);
      const canManageBuiltinRoles = canAccessByAuthCodes(get().currentUser, get().roles, ['MENU_ROLES']);

      const mapApiRole = (r: any): Role => {
        const builtInRole = initialRoles.find(role => role.id === r.id);
        return mapRemoteRoleToRole(r, builtInRole);
      };

      /**
       * 合并本地 pending 修改：正在被 updateRole 异步更新的角色，
       * 服务器可能尚未返回最新值，优先使用本地数据避免 UI 回跳。
       */
      const mergePendingUpdates = (serverRoles: Role[]): Role[] => {
        const pending = get().pendingRoleUpdates || {};
        if (Object.keys(pending).length === 0) return serverRoles;
        const localRoles = get().roles;
        return serverRoles.map(sr => {
          if (pending[sr.id]) {
            const local = localRoles.find(lr => lr.id === sr.id);
            return local || sr;
          }
          return sr;
        });
      };

      if (missingRoles.length > 0 && canManageBuiltinRoles) {
        // 仅补齐缺失的系统内置角色；已存在的角色（包括被管理员自定义过的）不再强制覆盖。
        // getBuiltInRoleUpdates 会将管理员的自定义修改判定为"偏移"并回退到硬编码值，已移除。
        const createResults = await Promise.allSettled(missingRoles.map(role => {
          const backendRole: Record<string, unknown> = { ...role, permissions: role.authCodes };
          delete backendRole.authCodes;
          return api.roles.create(backendRole);
        }));

        const hasCreatedRoles = createResults.some(result => result.status === 'fulfilled');
        const finalRoles = hasCreatedRoles ? await api.roles.list().catch(() => remoteRoles) : remoteRoles;
        if (finalRoles && finalRoles.length > 0) {
          const mapped: Role[] = finalRoles.map(mapApiRole);
          set({ roles: mergePendingUpdates(mapped) });
        }
        return;
      }

      // 服务端返回的数据为权威来源，但正在更新的角色优先使用本地值
      const finalRoles = remoteRoles;
      if (finalRoles && finalRoles.length > 0) {
        const mapped: Role[] = finalRoles.map(mapApiRole);
        set({ roles: mergePendingUpdates(mapped) });
      }
    } catch (e) {
      console.warn('syncRoles 失败（后端可能未启动）:', e);
    }
  },
  syncTemplates: async () => {
    try {
      const { api } = await import('../lib/api');
      const data = await api.templates.list();
      if (Array.isArray(data)) {
        set({ templates: data as any });
      }
    } catch (e) {
      console.warn('syncTemplates 失败（后端可能未启动）:', e);
    }
  },
  syncDictionaries: async () => {
    try {
      const { api } = await import('../lib/api');
      const data = await api.dictionaries.list();
      if (Array.isArray(data)) {
        set({ dictionaries: data as any });
      }
    } catch (e) {
      console.warn('syncDictionaries 失败（后端可能未启动）:', e);
    }
  },
  syncGlobalRules: async () => {
    try {
      const { api } = await import('../lib/api');
      const data = await api.globalRules.get();
      // 仅当返回有效对象时才合并，避免空数据覆盖默认值导致页面崩溃
      if (data && typeof data === 'object' && !Array.isArray(data) && Object.keys(data as object).length > 0) {
        set((state) => ({ globalRules: { ...state.globalRules, ...(data as object) } }));
      }
    } catch (e) {
      console.warn('syncGlobalRules 失败（后端可能未启动）:', e);
    }
  },
  syncAuditRecords: async () => {
    try {
      const { api } = await import('../lib/api');
      const data = await api.audit.list();
      if (Array.isArray(data)) set({ auditRecords: data as AuditRecord[] });
    } catch (e) {
      console.warn('syncAuditRecords 失败:', e);
      throw e;
    }
  },
}),
  {
    name: 'duban-storage',
    version: 6,
    partialize: partializePersistedState,
    merge: (persistedState, currentState) => {
      const persisted = persistedState as Record<string, unknown>;
      const current = currentState as unknown as Record<string, unknown>;
      let hasToken = false;
      try { hasToken = Boolean(localStorage.getItem('duban-auth-token')); } catch {}
      return {
        ...current,
        currentUser: hasToken ? (persisted.currentUser as User | undefined) || anonymousUser : anonymousUser,
        searchTerm: typeof persisted.searchTerm === 'string' ? persisted.searchTerm : current.searchTerm,
      } as unknown as WorkbenchState;
    },
    migrate: migratePersistedState,
  }
)
);

// ========== 数据权限工具函数 ==========

/**
 * 递归查找部门树中指定 ID 的部门节点
 */
export const findDeptNode = (nodes: DeptNode[], deptId: string): DeptNode | null => {
  for (const node of nodes) {
    if (node.id === deptId) return node;
    if (node.children) {
      const found = findDeptNode(node.children, deptId);
      if (found) return found;
    }
  }
  return null;
};

/**
 * 获取指定部门在部门树中的路径名称（从部门级别开始，跳过最顶层组织，用 · 分隔）
 * 如：院长办公室 · 督查室
 */
export const getDeptPath = (nodes: DeptNode[], deptId: string, separator: string = ' · '): string => {
  // 从顶层部门的 children 开始遍历，跳过根级组织
  const topChildren = nodes.flatMap(n => n.children || []);
  const walk = (items: DeptNode[], path: string[]): string[] | null => {
    for (const node of items) {
      if (node.id === deptId) return [...path, node.name];
      if (node.children) {
        const found = walk(node.children, [...path, node.name]);
        if (found) return found;
      }
    }
    return null;
  };
  const result = walk(topChildren, []);
  // 如果从子节点没找到，说明是顶层部门本身，直接返回其名称
  if (!result) {
    const topNode = nodes.find(n => n.id === deptId);
    return topNode?.name || '';
  }
  return result.join(separator);
};

/**
 * 获取指定部门及其所有下级部门的 ID 列表
 */
export const getDeptAndChildrenIds = (nodes: DeptNode[], deptId: string): string[] => {
  const node = findDeptNode(nodes, deptId);
  if (!node) return [];

  const collectIds = (n: DeptNode): string[] => {
    const ids = [n.id];
    if (n.children) {
      n.children.forEach(child => ids.push(...collectIds(child)));
    }
    return ids;
  };

  return collectIds(node);
};

/**
 * 获取指定用户的全部下级用户 ID（通过 supervisorId 建立的跨组织汇报关系）
 * 这是递归的，包含间接下级
 */
export const getCrossOrgSubordinateIds = (
  userId: string,
  orgUsers: OrgUser[]
): string[] => {
  // 找到所有 supervisorId === userId 的直接下级
  const directReports = orgUsers
    .filter(u => u.supervisorId === userId && u.status === 'ACTIVE')
    .map(u => u.id);

  // 递归找间接下级
  const allSubordinates: string[] = [];
  const collectReports = (ids: string[]) => {
    for (const id of ids) {
      if (!allSubordinates.includes(id)) {
        allSubordinates.push(id);
        const nextLevel = orgUsers
          .filter(u => u.supervisorId === id && u.status === 'ACTIVE')
          .map(u => u.id);
        if (nextLevel.length > 0) {
          collectReports(nextLevel);
        }
      }
    }
  };

  collectReports(directReports);
  return allSubordinates;
};

/**
 * 获取指定用户的直属下级用户 ID（仅 supervisorId 直接关联的一级）
 * 用于「逐级隔离」场景：中层领导仅看直属下级
 */
export const getDirectSubordinateIds = (
  userId: string,
  orgUsers: OrgUser[],
  /** P1-3: 可选的组织 ID 过滤，仅返回授权组织内的下属 */
  orgIds?: string[]
): string[] => {
  return orgUsers
    .filter(u => {
      if (u.supervisorId !== userId || u.status !== 'ACTIVE') return false;
      // P1-3: 如果指定了 orgIds，只返回在授权组织内的下属
      if (orgIds && orgIds.length > 0 && u.orgId && !orgIds.includes(u.orgId)) return false;
      return true;
    })
    .map(u => u.id);
};

/**
 * 获取指定用户的全部直属上级用户 ID（通过 supervisorId 建立的跨组织汇报关系）
 * 递归获取所有上级链
 */
export const getSupervisorIds = (
  userId: string,
  orgUsers: OrgUser[]
): string[] => {
  const user = orgUsers.find(u => u.id === userId);
  if (!user || !user.supervisorId) return [];

  // 递归获取所有上级链
  const chain: string[] = [];
  let current = user;
  while (current.supervisorId) {
    const supervisor = orgUsers.find(u => u.id === current.supervisorId);
    if (supervisor && !chain.includes(supervisor.id)) {
      chain.push(supervisor.id);
      current = supervisor;
    } else {
      break;
    }
  }
  return chain;
};

/**
 * 根据当前用户获取其下属用户 ID 列表
 * 包含两部分：
 *   1. 同部门及下级部门的所有 ACTIVE 用户（基于部门树）
 *   2. 跨组织直接/间接下级（基于 supervisorId 汇报关系）
 */
export const getSubordinateUserIds = (
  userId: string,
  orgUsers: OrgUser[],
  departments: DeptNode[]
): string[] => {
  const user = orgUsers.find(u => u.id === userId);
  if (!user) return [];

  const result: string[] = [];

  // 1. 部门树范围内的下属
  if (user.deptId) {
    const deptIds = getDeptAndChildrenIds(departments, user.deptId);
    const deptSubordinates = orgUsers
      .filter(u => u.deptId && deptIds.includes(u.deptId) && u.status === 'ACTIVE')
      .map(u => u.id);
    result.push(...deptSubordinates.filter(id => id !== userId));
  }

  // 2. 跨组织汇报关系的下属（即使在不同部门/公司）
  const crossOrgSubordinates = getCrossOrgSubordinateIds(userId, orgUsers);
  result.push(...crossOrgSubordinates.filter(id => !result.includes(id)));

  return result;
};

/**
 * 根据用户的中文角色名推断默认数据范围（责任人维度）
 * 需求说明：
 *  - 超级管理员 → ALL
 *  - 组织管理员 → MULTI_ORG（配合 adminOrgIds 做用户级隔离）
 *  - 部门管理员/部门负责人 → SELF_AND_DIRECT_SUBORDINATES（所有层级下级）
 *  - 督办专员 → SELF（仅本人跟进的事项）
 *  - 责任人 → SELF（仅本人负责的事项）
 */
const inferDataScopeFromRole = (role: string): DataScope => {
  const adminRoles = ['超级管理员', 'ADMIN'];
  const orgAdminRoles = ['组织管理员', 'ORG_ADMIN'];
  const deptAdminRoles = ['部门管理员', '部门负责人', 'DEPT_ADMIN'];
  const followerRoles = ['FOLLOWER', '督办专员'];
  const ownerRoles = ['OWNER', '责任人'];
  if (adminRoles.includes(role)) return 'ALL';
  if (orgAdminRoles.includes(role)) return 'MULTI_ORG';
  if (deptAdminRoles.includes(role)) return 'SELF_AND_DIRECT_SUBORDINATES';
  if (followerRoles.includes(role)) return 'SELF';
  if (ownerRoles.includes(role)) return 'SELF';
  return 'SELF';
};

/**
 * 根据用户的中文角色名推断默认跟进人维度数据范围
 * 需求说明：
 *  - 超级管理员 → ALL
 *  - 组织管理员 → MULTI_ORG
 *  - 部门管理员 → SELF_AND_DIRECT_SUBORDINATES（所有层级下级）
 *  - 督办专员 → SELF
 *  - 责任人 → 无跟进人维度
 */
const inferFollowerDataScopeFromRole = (role: string): FollowerDataScope | undefined => {
  const adminRoles = ['ADMIN', '超级管理员'];
  const orgAdminRoles = ['组织管理员', 'ORG_ADMIN'];
  const deptAdminRoles = ['部门管理员', '部门负责人', 'DEPT_ADMIN'];
  const followerRoles = ['FOLLOWER', '督办专员'];
  if (adminRoles.includes(role)) return 'ALL';
  if (orgAdminRoles.includes(role)) return 'MULTI_ORG';
  if (deptAdminRoles.includes(role)) return 'SELF_AND_DIRECT_SUBORDINATES';
  if (followerRoles.includes(role)) return 'SELF';
  return undefined;
};

/**
 * 获取用户的角色数据范围
 */
const DATA_SCOPE_WEIGHT: Record<DataScope, number> = {
  SELF: 1,
  SELF_AND_DIRECT_SUBORDINATES: 2,
  DEPT: 3,
  MULTI_ORG: 4,
  ALL: 5,
};

const FOLLOWER_DATA_SCOPE_WEIGHT: Record<FollowerDataScope, number> = {
  SELF: 1,
  SELF_AND_DIRECT_SUBORDINATES: 2,
  DEPT: 3,
  MULTI_ORG: 4,
  ALL: 5,
};

export const getUserDataScope = (
  userId: string,
  orgUsers: OrgUser[],
  roles: Role[]
): DataScope => {
  const user = orgUsers.find(u => u.id === userId);
  if (!user) return 'SELF';
  const assignedRoles = getRolesByUser({ roleId: user.roleId, roleIds: user.roleIds }, roles);
  const scopes = assignedRoles.map(role => role.dataScope).filter(Boolean) as DataScope[];
  return scopes.sort((a, b) => DATA_SCOPE_WEIGHT[b] - DATA_SCOPE_WEIGHT[a])[0] || 'SELF';
};

/**
 * 获取用户的跟进人维度数据范围
 * 返回 undefined 表示未配置跟进人维度过滤
 */
export const getUserFollowerDataScope = (
  userId: string,
  orgUsers: OrgUser[],
  roles: Role[]
): FollowerDataScope | undefined => {
  const user = orgUsers.find(u => u.id === userId);
  if (!user) return undefined;
  const assignedRoles = getRolesByUser({ roleId: user.roleId, roleIds: user.roleIds }, roles);
  const scopes = assignedRoles.map(role => role.followerDataScope).filter(Boolean) as FollowerDataScope[];
  return scopes.sort((a, b) => FOLLOWER_DATA_SCOPE_WEIGHT[b] - FOLLOWER_DATA_SCOPE_WEIGHT[a])[0];
};

/**
 * 获取用户的角色 authCodes
 */
export const getUserAuthCodes = (
  userId: string,
  orgUsers: OrgUser[],
  roles: Role[]
): string[] => {
  const user = orgUsers.find(u => u.id === userId);
  if (!user) return [];
  return getStrictUserAuthCodes({ roleId: user.roleId, roleIds: user.roleIds }, roles);
};

/**
 * 判断用户是否拥有指定操作权限
 * 通过角色的 allowedActions 约束判断（未配置或无限制则默认允许）
 * @param userId 用户 ID
 * @param orgUsers 组织用户列表
 * @param roles 角色列表
 * @param action 要检查的操作
 */
export const canUserPerformAction = (
  userId: string,
  orgUsers: OrgUser[],
  roles: Role[],
  action: AllowedAction
): boolean => {
  const user = orgUsers.find(u => u.id === userId);
  if (!user) return false;
  return canUseAllowedAction({ roleId: user.roleId, roleIds: user.roleIds }, roles, action);
};

// 消息可见性 helper — 统一前端消息过滤逻辑
export { isMessageVisibleToCurrentUser, getVisibleMessages, getUnreadVisibleMessageCount } from './message-visibility';
