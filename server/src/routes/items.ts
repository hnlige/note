import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { Router, Request, Response } from 'express';
import { getDb } from '../db';
import { getItemIdentityBackfill } from './items.backfill';
import { AuthenticatedRequest } from './auth.middleware';
import { canManageItems, canUseItemAction, canUseSubTaskMutationAction, getActionForItemUpdate, getInvalidItemUpdateFields, getRequiredActionsForItemUpdate, hasFollowerSelectionPayload, isFollowerCandidateUser, isSubTaskOnlyUpdatePayload, mapTimelineNodeToAction, normalizeFollowerSelection, sanitizeItemUpdates, validateItemStatusTransition } from './items.policy';
import { computeSignOffStatus } from './sign-off';
import { aggregateSubTaskStatus, derivePersistedItemStatus, getEffectiveItemStatus, shouldStartPendingItemAfterOwnerActivity } from '../lib/item-effective-status';
import { buildItemAccessWhere, filterItemsByAccess, type AccessItemLike } from './access.policy';
import { ensureNotificationIdentityColumns } from './notification.schema';
import { buildCreateItemMessages, buildDelayMessages, buildFeedbackMessages, buildSuspendMessages, buildShareMessages } from './item-workflow';
import { validateCreateItemPayload } from './validation';
import { getCurrentAccessContext } from './access.context';

export const itemsRouter = Router();

const ITEM_PAGE_AUTHS = new Set([
  'MENU_ITEMS',
  'MENU_MY_ITEMS',
  'MENU_WORKBENCH',
  'MENU_AUDIT',
  'MENU_RECYCLE_BIN',
  'MENU_MONITORING',
  'MENU_MESSAGES',
]);

export function resolveItemPageAuth(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !ITEM_PAGE_AUTHS.has(value)) return null;
  return value;
}

function getDeclaredItemPageAuth(req: Request): string | null | undefined {
  return resolveItemPageAuth(req.headers['x-page-auth']);
}

type ItemActor = {
  id: string;
  name?: string | null;
  username?: string | null;
};

function normalizeIdentity(value?: string | null): string {
  return String(value || '').trim().toLowerCase();
}

function getActorIdentityKeys(actor: ItemActor): string[] {
  return [...new Set([actor.id, actor.name, actor.username].map(normalizeIdentity).filter(Boolean))];
}

function identityMatches(value: unknown, identities: string[]): boolean {
  const normalized = typeof value === 'string' ? normalizeIdentity(value) : '';
  return Boolean(normalized && identities.includes(normalized));
}

const SERVER_MANAGED_TIMELINE_TYPES = new Set(['APPROVE', 'REJECT', 'STATUS']);

type TrustedTimelineActor = { id: string; name?: string | null };

/**
 * 兼容旧客户端提交完整时间线，但只接收真实增量，并由服务端重建审计身份与时间。
 * 审批、驳回等服务端已生成的节点在这里忽略，避免重复记录和客户端伪造。
 */
export function buildTrustedTimelineNodes(
  incomingTimeline: unknown[],
  existingTimelineIds: ReadonlySet<string>,
  actor: TrustedTimelineActor,
  uuid: () => string,
  now: () => Date = () => new Date(),
  forceFollowerFeedback = false,
): Array<Record<string, unknown>> {
  const allocatedIds = new Set(existingTimelineIds);
  const nodes: Array<Record<string, unknown>> = [];

  for (const rawNode of incomingTimeline) {
    if (!rawNode || typeof rawNode !== 'object') throw new Error('时间线节点格式无效');
    const node = rawNode as Record<string, unknown>;
    const clientId = typeof node.id === 'string' ? node.id.trim() : '';
    if (!clientId) throw new Error('时间线节点缺少 ID');
    if (existingTimelineIds.has(clientId)) continue;

    const requestedType = typeof node.type === 'string' ? node.type : '';
    if (SERVER_MANAGED_TIMELINE_TYPES.has(requestedType)) continue;
    const type = forceFollowerFeedback && requestedType === 'FEEDBACK' ? 'FOLLOWER_FEEDBACK' : requestedType;
    if (!mapTimelineNodeToAction({ type })) throw new Error(`不支持的时间线事件类型: ${requestedType || '空'}`);

    let id = clientId.length <= 36 && !allocatedIds.has(clientId) ? clientId : uuid();
    while (allocatedIds.has(id)) id = uuid();
    allocatedIds.add(id);
    nodes.push({
      id,
      type,
      user: actor.name?.trim() || '系统',
      actorUserId: actor.id,
      content: typeof node.content === 'string' ? node.content : '',
      timestamp: now(),
      attachments: asArrayValue(node.attachments),
    });
  }

  return nodes;
}

/** 将日期值转为前端可读的字符串格式：YYYY-MM-DD HH:mm:ss */
function formatTimestamp(v: unknown): string {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v as any);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 将日期值转为 YYYY-MM-DD 格式 */
function formatDateOnly(v: unknown): string {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v as any);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function backfillItemUserIdentities(db: any, items: any[], knownUsers?: Array<{ id: string; name?: string | null; username?: string | null }>) {
  const { users: usersTable } = await import('../db/schema');
  const users = knownUsers || await db.select({
    id: usersTable.id,
    name: usersTable.name,
    username: usersTable.username,
  }).from(usersTable);

  return items.map((item) => {
    const updates = getItemIdentityBackfill(item, users);
    if (!updates) return item;
    // 回写逻辑移至启动迁移，列表/详情请求只做内存补全，消除 N+1 写
    return { ...item, ...updates };
  });
}

function getItemsPageRequest(req: Request): { page: number; pageSize: number } {
  const parsePositiveInt = (value: unknown, fallback: number, maximum: number) => {
    const parsed = Number.parseInt(String(value || ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
  };
  return {
    page: parsePositiveInt(req.query.page, 1, 1000000),
    pageSize: parsePositiveInt(req.query.pageSize, 50, 200),
  };
}

async function requireItemWritePermission(req: AuthenticatedRequest, res: Response, next: () => void) {
  try {
    if (!req.authUser) {
      res.status(401).json({ error: '请先登录' });
      return;
    }

    const db = await getDb();
    const accessContext = await getCurrentAccessContext(db, req.authUser.id);
    if (!accessContext?.currentUser || !accessContext.currentRole) {
      res.status(403).json({ error: '当前账号角色配置异常，请联系管理员' });
      return;
    }

    if (getDeclaredItemPageAuth(req) !== undefined) {
      next();
      return;
    }

    if (!canManageItems({ role: accessContext.currentUser.role, roleId: accessContext.currentUser.roleId, roleConfig: accessContext.currentRole })) {
      res.status(403).json({ error: '当前角色无写权限' });
      return;
    }

    next();
  } catch (error) {
    console.error('Check item write permission error:', error);
    res.status(500).json({ error: '校验事项写权限失败' });
  }
}

function ensureItemActionAllowed(
  accessContext: Awaited<ReturnType<typeof getCurrentAccessContext>>,
  action: string,
  res: Response,
  payload: Record<string, unknown> = {},
  pageAuth?: string | null,
): boolean {
  if (!accessContext?.currentUser || !accessContext.currentRole) {
    res.status(403).json({ error: '当前账号角色配置异常，请联系管理员' });
    return false;
  }
  if (action === 'CHANGE_ITEM' && isSubTaskOnlyUpdatePayload(payload)) {
    if (!canUseSubTaskMutationAction({ role: accessContext.currentUser.role, roleConfig: accessContext.currentRole, pageAuth })) {
      res.status(403).json({ error: '当前角色无分解任务操作权限' });
      return false;
    }
    return true;
  }
  if (!canUseItemAction({ role: accessContext.currentUser.role, roleConfig: accessContext.currentRole, pageAuth, action })) {
    res.status(403).json({ error: `当前角色无${action}操作权限` });
    return false;
  }
  return true;
}

export function ensureItemActionsAllowed(
  accessContext: Awaited<ReturnType<typeof getCurrentAccessContext>>,
  actions: readonly string[],
  res: Response,
  payload: Record<string, unknown> = {},
  pageAuth?: string | null,
): boolean {
  for (const action of actions) {
    if (!ensureItemActionAllowed(accessContext, action, res, payload, pageAuth)) return false;
  }
  return true;
}

/**
 * 状态流转前置校验：在持久化之前拦截非法/伪造的状态切换。
 * 合法返回 true；非法返回 false 并向响应写入 400。
 */
export function ensureValidItemStatusTransition(
  currentItem: Record<string, unknown>,
  payload: Record<string, unknown>,
  res: Response,
): boolean {
  const error = validateItemStatusTransition(payload, currentItem);
  if (error) {
    res.status(400).json({ error });
    return false;
  }
  return true;
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function splitMultiValue(value: string): string[] {
  return String(value || '')
    .split(/[、,，;；\n\r/]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function asStringList(value: unknown): string[] {
  const normalized = parseJsonValue(value);
  if (Array.isArray(normalized)) {
    return normalized
      .flatMap((item) => typeof item === 'string' ? splitMultiValue(item) : [])
      .filter((item): item is string => item.length > 0);
  }
  return typeof normalized === 'string' && normalized.length > 0 ? splitMultiValue(normalized) : [];
}

function asArrayValue<T = unknown>(value: unknown): T[] {
  const normalized = parseJsonValue(value);
  return Array.isArray(normalized) ? normalized as T[] : [];
}

function normalizeItemJsonFields<T extends Record<string, any>>(item: T): T {
  return {
    ...item,
    ownerIds: asStringList(item.ownerIds),
    ownerNames: asStringList(item.ownerNames),
    followerIds: asStringList(item.followerIds),
    followerNames: asStringList(item.followerNames),
    deptNames: asStringList(item.deptNames),
    subTasks: asArrayValue(item.subTasks),
    sharedWith: asArrayValue(item.sharedWith),
    attachments: asArrayValue(item.attachments),
  };
}

function normalizeItemsJsonFields<T extends Record<string, any>>(items: T[]): T[] {
  return items.map(item => normalizeItemJsonFields(item));
}

function getFollowerSupervisorIds(
  item: any,
  users: Array<{ id: string; supervisorId?: string | null; status?: string | null; role?: string | null; permissions?: unknown }>,
): string[] {
  const followerIds = [item.followerId, ...asStringList(item.followerIds)].filter(Boolean);
  const orgSupervisors = [...new Set(followerIds.flatMap((followerId) => {
    const follower = users.find((user) => user.id === followerId);
    if (!follower?.supervisorId) return [];
    const supervisor = users.find((user) => user.id === follower.supervisorId);
    return supervisor && (!supervisor.status || supervisor.status === 'ACTIVE') ? [supervisor.id] : [];
  }))];
  // 兜底：组织未配置跟进人上级时，由管理员（督办管理员）承担终审，避免审批流永久卡在「待审批完成」
  if (orgSupervisors.length > 0) return orgSupervisors;
  const fallback = users
    .filter((user) => (user.status === undefined || user.status === null || user.status === 'ACTIVE')
      && ((user as any).role === 'ADMIN' || (Array.isArray((user as any).permissions) && (user as any).permissions.includes('ALL'))))
    .map((user) => user.id);
  return [...new Set(fallback)];
}

function isFollowerSupervisor(
  accessContext: Awaited<ReturnType<typeof getCurrentAccessContext>>,
  item: any,
): boolean {
  if (!accessContext?.currentUser || !accessContext.users) return false;
  return getFollowerSupervisorIds(item, accessContext.users).includes(accessContext.currentUser.id);
}

function getItemFollowers(item: any): Array<{ id: string; name: string }> {
  const followerIds = [item.followerId, ...asStringList(item.followerIds)].filter(Boolean);
  const followerNames = [item.followerName, ...asStringList(item.followerNames)];
  const seen = new Set<string>();
  return followerIds.flatMap((id, index) => {
    const name = followerNames[index];
    if (!id || !name || seen.has(id)) return [];
    seen.add(id);
    return [{ id, name }];
  });
}

function getItemOwners(item: any): Array<{ id: string; name: string }> {
  const ownerIds = [item.ownerId, ...asStringList(item.ownerIds)].filter(Boolean);
  const ownerNames = [item.ownerName, ...asStringList(item.ownerNames)];
  const seen = new Set<string>();
  return ownerIds.flatMap((id, index) => {
    const name = ownerNames[index];
    if (!id || !name || seen.has(id)) return [];
    seen.add(id);
    return [{ id, name }];
  });
}

/**
 * 提取事项关联的全部责任人「id + name」配对（去重）。
 * 用于自动拆分多责任人子任务：每个责任人生成一条独立子任务。
 */
export function buildOwnerPairs(ownerIds: string[], ownerNames: string[]): Array<{ id: string; name: string }> {
  const ids = ownerIds.filter(Boolean);
  const names = ownerNames.filter(Boolean);
  const seen = new Set<string>();
  const pairs: Array<{ id: string; name: string }> = [];
  ids.forEach((id, index) => {
    if (seen.has(id)) return;
    seen.add(id);
    pairs.push({ id, name: names[index] || '' });
  });
  // 仅提供了姓名（无 id）时，按姓名配对
  if (pairs.length === 0) {
    names.forEach((name) => {
      if (seen.has(name)) return;
      seen.add(name);
      pairs.push({ id: '', name });
    });
  }
  return pairs;
}

/**
 * 多责任人自动拆分：每个责任人生成一条独立子任务。
 * 单责任人（≤1）不拆分，返回空数组（沿用原「父级即责任人」展示方式）。
 * 日期拆分：
 * - requiredCompletionDate：要求完成日期（跟进人统一填写，全事项通用，责任人不可修改）
 * - plannedCompletionDate：计划完成日期（责任人签收时填写；缺省回退到要求完成日期）
 * - actualCompletionDate：实际完成日期（办结审批后由跟进人回填，初始为空）
 */
export function buildAutoSubTasks(
  itemId: string,
  pairs: Array<{ id: string; name: string }>,
  opts: { title: string; requiredCompletionDate?: string | null; plannedCompletionDate?: string | null },
  uuid: () => string,
): any[] {
  if (pairs.length <= 1) return [];
  const required = opts.requiredCompletionDate || '';
  const planned = opts.plannedCompletionDate || required || '';
  return pairs.map((pair) => ({
    id: uuid(),
    title: opts.title,
    assigneeId: pair.id,
    assigneeName: pair.name,
    deadline: planned,
    plannedCompletionDate: planned,
    requiredCompletionDate: required,
    actualCompletionDate: '',
    status: 'PENDING',
    progress: 0,
    parentItemId: itemId,
  }));
}

function suspendOwnerSubTasks(item: any): any[] | undefined {
  const subTasks = asArrayValue<Record<string, unknown>>(item.subTasks);
  if (subTasks.length === 0) return undefined;
  const ownerIdentityKeys = new Set(
    [item.ownerId, item.ownerName, ...asStringList(item.ownerIds), ...asStringList(item.ownerNames)]
      .map(normalizeIdentity)
      .filter(Boolean),
  );
  if (ownerIdentityKeys.size === 0) return undefined;
  return subTasks.map((task) => {
    const assigneeId = normalizeIdentity(typeof task.assigneeId === 'string' ? task.assigneeId : '');
    const assigneeName = normalizeIdentity(typeof task.assigneeName === 'string' ? task.assigneeName : '');
    if (!ownerIdentityKeys.has(assigneeId) && !ownerIdentityKeys.has(assigneeName)) return task;
    return { ...task, status: 'SUSPENDED' };
  });
}

function syncParentStatusToSubTasks(item: any, targetStatus: 'DISABLED' | 'EXECUTING', payload: Record<string, unknown>): any[] | undefined {
  const subTasks = asArrayValue<Record<string, unknown>>(item.subTasks);
  if (subTasks.length === 0) return undefined;

  const resumeDate = typeof payload.plannedCompletionDate === 'string' && payload.plannedCompletionDate.trim()
    ? payload.plannedCompletionDate.trim()
    : typeof payload.deadline === 'string' && payload.deadline.trim()
      ? payload.deadline.trim()
      : '';
  const preservedOnRestart = new Set(['COMPLETED', 'ARCHIVED', 'DELETED']);

  return subTasks.map((task) => {
    if (targetStatus === 'DISABLED') {
      return task.status === 'DELETED' ? task : { ...task, status: 'DISABLED' };
    }
    if (preservedOnRestart.has(String(task.status))) return task;
    return {
      ...task,
      status: 'EXECUTING',
      ...(resumeDate ? { plannedCompletionDate: resumeDate, deadline: resumeDate } : {}),
    };
  });
}

function applyOwnerActivitySubTaskUpdate(item: any, actor: ItemActor, payload: Record<string, unknown>): any[] | undefined {
  const subTasks = asArrayValue<Record<string, unknown>>(item.subTasks);
  if (subTasks.length === 0) return undefined;

  const actorIdentityKeys = getActorIdentityKeys(actor);
  let changed = false;
  const plannedDate = typeof payload.plannedCompletionDate === 'string' && payload.plannedCompletionDate.trim()
    ? payload.plannedCompletionDate.trim()
    : typeof payload.deadline === 'string' && payload.deadline.trim()
      ? payload.deadline.trim()
      : '';

  const nextSubTasks = subTasks.map((task) => {
    const isActorTask = identityMatches(task.assigneeId, actorIdentityKeys) ||
      identityMatches(task.assigneeName, actorIdentityKeys);
    if (!isActorTask || task.status !== 'PENDING') return task;

    changed = true;
    return {
      ...task,
      status: 'EXECUTING',
      ...(plannedDate ? {
        plannedCompletionDate: plannedDate,
        deadline: plannedDate,
      } : {}),
    };
  });

  return changed ? nextSubTasks : undefined;
}

function getItemActorFlags(
  accessContext: Awaited<ReturnType<typeof getCurrentAccessContext>>,
  item: any,
): { isOwner: boolean; isFollower: boolean; isFinalApprover: boolean; hasGlobalPrivilege: boolean; isIssuer: boolean; hasDeleteFallbackPrivilege: boolean } {
  const permissions = Array.isArray(accessContext?.currentRole?.permissions) ? accessContext.currentRole.permissions : [];
  const userId = accessContext?.currentUser?.id || '';
  const actorIdentityKeys = accessContext?.currentUser ? getActorIdentityKeys(accessContext.currentUser) : [];
  const ownerIds = [item.ownerId, ...asStringList(item.ownerIds)].filter(Boolean);
  const ownerNames = [item.ownerName, ...asStringList(item.ownerNames)].filter(Boolean);
  const ownerSubTasks = asArrayValue(item.subTasks);
  const followerIds = [item.followerId, ...asStringList(item.followerIds)].filter(Boolean);
  const followerNames = [item.followerName, ...asStringList(item.followerNames)].filter(Boolean);
  const issuerIdentityCandidates = [item.issuerId, item.issuerName, item.issuerAccount].map(normalizeIdentity).filter(Boolean);
  const isOwner = ownerIds.includes(userId) ||
    ownerNames.some((name) => identityMatches(name, actorIdentityKeys)) ||
    ownerSubTasks.some((task: any) => identityMatches(task?.assigneeId, actorIdentityKeys) || identityMatches(task?.assigneeName, actorIdentityKeys));
  const isFollower = followerIds.includes(userId) || followerNames.some((name) => identityMatches(name, actorIdentityKeys));
  const hasGlobalPrivilege = accessContext?.currentUser?.role === 'ADMIN' || permissions.includes('ALL');
  const hasDeleteFallbackPrivilege = hasGlobalPrivilege || permissions.includes('DELETE_ITEM') || permissions.includes('EDIT_ITEM');
  return {
    isOwner,
    isFollower,
    isFinalApprover: isFollowerSupervisor(accessContext, item),
    hasGlobalPrivilege,
    isIssuer: actorIdentityKeys.some((identity) => issuerIdentityCandidates.includes(identity)),
    hasDeleteFallbackPrivilege,
  };
}

export function ensureItemActorAllowed(
  accessContext: Awaited<ReturnType<typeof getCurrentAccessContext>>,
  action: string,
  item: any,
  res: Response,
  payload: Record<string, unknown> = {},
): boolean {
  if (!accessContext?.currentUser || !accessContext.currentRole) {
    res.status(403).json({ error: '当前账号角色配置异常，请联系管理员' });
    return false;
  }

  const { isOwner, isFollower, isFinalApprover, hasGlobalPrivilege } = getItemActorFlags(accessContext, item);

  if (hasGlobalPrivilege && action !== 'APPROVE_ITEM') return true;

  if (['SIGN_ITEM', 'FEEDBACK_ITEM', 'DELAY_ITEM'].includes(action)) {
    if (!isOwner) {
      res.status(403).json({ error: '仅事项责任人可执行该操作' });
      return false;
    }
    // 子任务已超时：责任人在延期申请通过前不得提交反馈，需先申请延期。
    if (action === 'FEEDBACK_ITEM') {
      const actorIdentityKeys = accessContext.currentUser
        ? getActorIdentityKeys(accessContext.currentUser)
        : [];
      const ownerSubTask = asArrayValue<any>(item.subTasks).find((task: any) =>
        identityMatches(task?.assigneeId, actorIdentityKeys) ||
        identityMatches(task?.assigneeName, actorIdentityKeys),
      );
      if (ownerSubTask?.status === 'OVERDUE') {
        res.status(400).json({ error: '子任务已超时，请先申请延期后再反馈' });
        return false;
      }
    }
    return true;
  }

  if (action === 'CHANGE_ITEM' && isSubTaskOnlyUpdatePayload(payload)) {
    if (!isOwner && !isFollower) {
      res.status(403).json({ error: '仅事项相关人员可更新分解任务' });
      return false;
    }
    return true;
  }

  if (['URGE_ITEM', 'CHANGE_ITEM', 'SUSPEND_ITEM', 'RESTART_ITEM', 'DISABLE_ITEM', 'REJECT_ITEM', 'MARK_UNSATISFIED_ITEM', 'DELETE_ITEM'].includes(action)) {
    if (!isFollower) {
      res.status(403).json({ error: '仅事项跟进人可执行该操作' });
      return false;
    }
    return true;
  }

  if (action === 'APPROVE_ITEM') {
    if (!isFollower && !isFinalApprover) {
      res.status(403).json({ error: '仅事项跟进人或跟进人直属上级可执行该操作' });
      return false;
    }
    return true;
  }

  if (['APPLY_COMPLETE_ITEM', 'SHARE_ITEM'].includes(action)) {
    if (!isOwner && !isFollower) {
      res.status(403).json({ error: '仅事项相关人员可执行该操作' });
      return false;
    }
  }

  return true;
}

// 获取当前用户可见的事项（权限、分页和时间轴读取均在数据库侧下推）。
itemsRouter.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = await getDb();
    const { items: itemsTable, timelineNodes } = await import('../db/schema');
    const accessContext = await getCurrentAccessContext(db, req.authUser?.id);
    if (!accessContext?.currentUser || !accessContext.currentRole) {
      return res.status(403).json({ error: '当前账号角色配置异常，请联系管理员' });
    }

    const { page, pageSize } = getItemsPageRequest(req);
    const isRecycleBin = getDeclaredItemPageAuth(req) === 'MENU_RECYCLE_BIN';
    const includeDeleted = isRecycleBin;
    const accessWhere = buildItemAccessWhere(accessContext, {
      ownerId: itemsTable.ownerId,
      ownerIds: itemsTable.ownerIds,
      ownerName: itemsTable.ownerName,
      followerId: itemsTable.followerId,
      followerIds: itemsTable.followerIds,
      followerName: itemsTable.followerName,
      sharedWith: itemsTable.sharedWith,
      deletedAt: itemsTable.deletedAt,
    }, { includeDeleted, onlyDeleted: isRecycleBin });
    const [{ total }] = await db
      .select({ total: sql<number>`count(*)` })
      .from(itemsTable)
      .where(accessWhere);
    const items = await db
      .select()
      .from(itemsTable)
      .where(accessWhere)
      .orderBy(asc(itemsTable.createdAt), asc(itemsTable.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    // SQL 条件以现有权限策略生成；此处保留内存校验作为防御层，发生策略漂移时宁可少返回也不能越权。
    const normalizedItems = normalizeItemsJsonFields(await backfillItemUserIdentities(db, items, accessContext.users as any));
    const visibleItems = filterItemsByAccess(normalizedItems, accessContext, { includeDeleted, onlyDeleted: isRecycleBin });
    const itemIds = visibleItems.map((item) => item.id);
    const timelines = itemIds.length > 0
      ? await db.select().from(timelineNodes)
        .where(inArray(timelineNodes.itemId, itemIds))
        .orderBy(asc(timelineNodes.itemId), asc(timelineNodes.timestamp), asc(timelineNodes.id))
      : [];
    const timelinesByItemId = new Map<string, any[]>();
    for (const node of timelines) {
      const nodes = timelinesByItemId.get(node.itemId) || [];
      nodes.push(node);
      timelinesByItemId.set(node.itemId, nodes);
    }

    const result = visibleItems.map((item) => {
      const fullTimeline = timelinesByItemId.get(item.id) || [];
      const timeline = fullTimeline.slice(-5).map((n: any) => ({
        id: n.id,
        type: n.type,
        user: n.user,
        actorUserId: n.actorUserId || undefined,
        content: n.content,
        timestamp: formatTimestamp(n.timestamp),
        attachments: asArrayValue(n.attachments),
      }));
      const signOff = computeSignOffStatus(item, fullTimeline);
      return {
        ...item,
        meetingName: item.meetingSource || '',
        raiseDate: item.raiseDate ? formatDateOnly(item.raiseDate) : (item.createdAt ? formatDateOnly(item.createdAt) : ''),
        deadline: item.deadline ? formatDateOnly(item.deadline) : '',
        lastFeedbackDate: item.lastFeedbackDate ? formatDateOnly(item.lastFeedbackDate) : '',
        requiredCompletionDate: item.requiredCompletionDate ? formatDateOnly(item.requiredCompletionDate) : '',
        plannedCompletionDate: item.plannedCompletionDate ? formatDateOnly(item.plannedCompletionDate) : '',
        actualCompletionDate: item.actualCompletionDate ? formatDateOnly(item.actualCompletionDate) : '',
        timeline,
        effectiveStatus: getEffectiveItemStatus({ ...item, timeline: fullTimeline } as any),
        signOffStatus: signOff.status,
        signedOwnerCount: signOff.signedCount,
        totalOwnerCount: signOff.totalCount,
      };
    });

    return res.json({
      data: result,
      pagination: {
        page,
        pageSize,
        total: Number(total || 0),
        totalPages: Math.ceil(Number(total || 0) / pageSize),
      },
    });
  } catch (error) {
    console.error('Get items error:', error);
    return res.status(500).json({ error: '获取事项列表失败' });
  }
});

// 获取单个事项
itemsRouter.get('/:id', async (req: AuthenticatedRequest & Request<{ id: string }>, res: Response) => {
  try {
    const db = await getDb();
    const { items: itemsTable, timelineNodes } = await import('../db/schema');
    const { eq } = await import('drizzle-orm');
    const accessContext = await getCurrentAccessContext(db, req.authUser?.id);
    if (!accessContext?.currentUser || !accessContext.currentRole) {
      return res.status(403).json({ error: '当前账号角色配置异常，请联系管理员' });
    }

    const [item] = await db
      .select()
      .from(itemsTable)
      .where(eq(itemsTable.id, req.params.id as string))
      .limit(1);

    if (!item) return res.status(404).json({ error: '事项不存在' });

    const timeline = await db
      .select()
      .from(timelineNodes)
      .where(eq(timelineNodes.itemId, item.id))
      .orderBy(timelineNodes.timestamp);

    const [normalizedItem] = normalizeItemsJsonFields(await backfillItemUserIdentities(db, [item]));
    const isRecycleBin = getDeclaredItemPageAuth(req) === 'MENU_RECYCLE_BIN';
    // 回收站详情也只能读取已删除事项，不能借页面上下文绕过普通详情的软删除隔离。
    const [visibleItem] = filterItemsByAccess(
      [normalizedItem],
      accessContext,
      { includeDeleted: isRecycleBin, onlyDeleted: isRecycleBin },
    );
    if (!visibleItem) {
      return res.status(403).json({ error: '当前账号无权查看该事项' });
    }
    const signOff = computeSignOffStatus(visibleItem, timeline);
    return res.json({
      ...visibleItem,
      meetingName: visibleItem.meetingSource || '',
      raiseDate: visibleItem.raiseDate ? formatDateOnly(visibleItem.raiseDate) : (visibleItem.createdAt ? formatDateOnly(visibleItem.createdAt) : ''),
      deadline: visibleItem.deadline ? formatDateOnly(visibleItem.deadline) : '',
      lastFeedbackDate: visibleItem.lastFeedbackDate ? formatDateOnly(visibleItem.lastFeedbackDate) : '',
      requiredCompletionDate: visibleItem.requiredCompletionDate ? formatDateOnly(visibleItem.requiredCompletionDate) : '',
      plannedCompletionDate: visibleItem.plannedCompletionDate ? formatDateOnly(visibleItem.plannedCompletionDate) : '',
      actualCompletionDate: visibleItem.actualCompletionDate ? formatDateOnly(visibleItem.actualCompletionDate) : '',
      timeline: timeline.map((n: any) => ({
        id: n.id,
        type: n.type,
        user: n.user,
        actorUserId: n.actorUserId || undefined,
        content: n.content,
        timestamp: formatTimestamp(n.timestamp),
        attachments: asArrayValue(n.attachments),
      })),
      effectiveStatus: getEffectiveItemStatus({ ...visibleItem, timeline } as any),
      signOffStatus: signOff.status,
      signedOwnerCount: signOff.signedCount,
      totalOwnerCount: signOff.totalCount,
    });
  } catch (error) {
    console.error('Get item error:', error);
    return res.status(500).json({ error: '获取事项详情失败' });
  }
});

// 创建事项
itemsRouter.post('/', requireItemWritePermission, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const validation = validateCreateItemPayload(req.body);
    if (!validation.valid) return res.status(400).json({ error: validation.error });
    const db = await getDb();
    await ensureNotificationIdentityColumns(db);
    const { items: itemsTable, timelineNodes, messages: messagesTable } = await import('../db/schema');
    const { v4: uuid } = await import('uuid');
    const { eq } = await import('drizzle-orm');
    const accessContext = await getCurrentAccessContext(db, req.authUser?.id);
    if (!ensureItemActionAllowed(accessContext, 'CREATE_ITEM', res, {}, getDeclaredItemPageAuth(req))) return;

    const { id: clientId, serialNo, title, content, deadline, ownerName, ownerId, followerName, followerId, category, campus, meetingSource, meetingName, raiseDate, requiredCompletionDate, plannedCompletionDate, actualCompletionDate, ownerIds, ownerNames, followerIds, followerNames, deptNames, subTasks } = req.body;
    const issuerId = req.authUser?.id || null;
    const issuerName = req.authUser?.name || '系统';
    const issuerAccount = req.authUser?.username || req.authUser?.id || 'system';

    const id = clientId || uuid();
    const now = new Date();
    const normalizedSerialNo = String(serialNo || '').trim();
    if (!normalizedSerialNo) {
      return res.status(400).json({ error: '督办序号不能为空' });
    }

    const [existingItem] = await db
      .select({ id: itemsTable.id })
      .from(itemsTable)
      .where(eq(itemsTable.serialNo, normalizedSerialNo))
      .limit(1);
    if (existingItem) {
      return res.status(409).json({ error: `督办序号「${normalizedSerialNo}」已存在，不可重复添加` });
    }

    const normalizedOwnerIds = asStringList(ownerIds);
    const normalizedOwnerNames = asStringList(ownerNames);
    const followerSelection = normalizeFollowerSelection({ followerId, followerName, followerIds, followerNames }, accessContext?.users || [], { required: true });
    if (!followerSelection.valid) {
      return res.status(400).json({ error: 'error' in followerSelection ? followerSelection.error : '请选择有效的督办专员' });
    }
    const normalizedFollowerIds = followerSelection.updates.followerIds || [];
    const normalizedFollowerNames = followerSelection.updates.followerNames || [];
    const normalizedFollowerId = followerSelection.updates.followerId || '';
    const normalizedFollowerName = followerSelection.updates.followerName || '';
    const normalizedDeptNames = asStringList(deptNames);
    const normalizedSubTasks = asArrayValue(subTasks);
    const requestedOwnerIds = [...new Set([...normalizedOwnerIds, ...(ownerId ? [String(ownerId)] : [])])];
    const invalidOwner = requestedOwnerIds.find((requestedId) => {
      const user = accessContext?.users?.find((candidate) => candidate.id === requestedId);
      return !user || user.status !== 'ACTIVE';
    });
    if (invalidOwner) return res.status(400).json({ error: `责任人账号不存在或已停用：${invalidOwner}` });

    // 多责任人自动拆分：每位责任人生成一条独立子任务
    const ownerPairs = buildOwnerPairs(normalizedOwnerIds, normalizedOwnerNames);
    const autoSubTasks = buildAutoSubTasks(
      id,
      ownerPairs,
      {
        title: title || normalizedSerialNo,
        requiredCompletionDate: requiredCompletionDate ? String(requiredCompletionDate) : null,
        plannedCompletionDate: plannedCompletionDate ? String(plannedCompletionDate) : null,
      },
      uuid,
    );
    const finalSubTasks = autoSubTasks.length > 0 ? autoSubTasks : normalizedSubTasks;

    const timelineId = uuid();
    await db.transaction(async (tx: any) => {
      const db = tx;
      await db.insert(itemsTable).values({
      id,
      serialNo: normalizedSerialNo,
      title,
      content,
      status: 'PENDING',
      deadline: deadline ? new Date(deadline) : null,
      issuerId,
      issuerName,
      issuerAccount,
      ownerName,
      ownerId,
      followerName: normalizedFollowerName,
      followerId: normalizedFollowerId,
      meetingSource: meetingSource || meetingName || '',
      raiseDate: raiseDate ? new Date(raiseDate) : null,
      requiredCompletionDate: requiredCompletionDate ? new Date(requiredCompletionDate) : null,
      plannedCompletionDate: plannedCompletionDate ? new Date(plannedCompletionDate) : null,
      actualCompletionDate: actualCompletionDate ? new Date(actualCompletionDate) : null,
      ownerIds: normalizedOwnerIds,
      ownerNames: normalizedOwnerNames,
      followerIds: normalizedFollowerIds,
      followerNames: normalizedFollowerNames,
      deptNames: normalizedDeptNames,
      subTasks: finalSubTasks,
      category,
      campus,
      createdAt: now,
      updatedAt: now,
    } as any);

      await db.insert(timelineNodes).values({
      id: timelineId,
      itemId: id,
      type: 'CREATE',
      user: req.authUser?.name || '系统',
      content: '发起了该督办事项',
      timestamp: now,
    } as any);

    const createMessages = buildCreateItemMessages({
      itemId: id,
      serialNo: normalizedSerialNo,
      title: title || normalizedSerialNo,
      ownerIds: normalizedOwnerIds.length > 0 ? normalizedOwnerIds : ownerId ? [ownerId] : [],
      ownerNames: normalizedOwnerNames.length > 0 ? normalizedOwnerNames : ownerName ? [ownerName] : [],
      followerIds: normalizedFollowerIds,
      followerNames: normalizedFollowerNames,
      senderId: req.authUser?.id || null,
      senderName: req.authUser?.name || '系统',
    });

      if (createMessages.length > 0) {
        await db.insert(messagesTable).values(
        createMessages.map((message) => ({
          id: uuid(),
          title: message.title,
          content: message.content,
          type: message.type,
          timestamp: now,
          link: message.link,
          receiverId: message.receiverId,
          receiverName: message.receiverName,
          senderId: message.senderId || null,
          senderName: message.senderName || null,
        })) as any,
        );
      }
    });

    return res.status(201).json({
      id,
      serialNo: normalizedSerialNo,
      title,
      content,
      status: 'PENDING',
      effectiveStatus: 'PENDING',
      deadline: deadline || '',
      issuerId: issuerId || undefined,
      issuerName,
      issuerAccount,
      ownerName,
      ownerId,
      followerName: normalizedFollowerName,
      followerId: normalizedFollowerId,
      meetingSource: meetingSource || meetingName || '',
      meetingName: meetingSource || meetingName || '',
      raiseDate: raiseDate || formatDateOnly(now),
      requiredCompletionDate: requiredCompletionDate || '',
      plannedCompletionDate: plannedCompletionDate || '',
      actualCompletionDate: actualCompletionDate || '',
      ownerIds: normalizedOwnerIds,
      ownerNames: normalizedOwnerNames,
      followerIds: normalizedFollowerIds,
      followerNames: normalizedFollowerNames,
      deptNames: normalizedDeptNames,
      subTasks: finalSubTasks,
      category,
      campus,
      progress: 0,
      timeline: [{
        id: timelineId,
        type: 'CREATE',
        user: req.authUser?.name || '系统',
        content: '发起了该督办事项',
        timestamp: formatTimestamp(now),
      }],
      createdAt: formatTimestamp(now),
      updatedAt: formatTimestamp(now),
    });
  } catch (error) {
    console.error('Create item error:', error);
    return res.status(500).json({ error: '创建事项失败' });
  }
});

// 批量创建事项
itemsRouter.post('/batch', requireItemWritePermission, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = await getDb();
    await ensureNotificationIdentityColumns(db);
    const { items: itemsTable, timelineNodes, messages: messagesTable } = await import('../db/schema');
    const { v4: uuid } = await import('uuid');
    const { eq, or, inArray } = await import('drizzle-orm');
    const accessContext = await getCurrentAccessContext(db, req.authUser?.id);
    if (!ensureItemActionAllowed(accessContext, 'CREATE_ITEM', res, {}, getDeclaredItemPageAuth(req))) return;
    const { departments: departmentsTable } = await import('../db/schema');
    const allDepartments = await db.select().from(departmentsTable);

    const payload = req.body;
    if (!payload || !Array.isArray(payload.items) || payload.items.length === 0) {
      return res.status(400).json({ error: '请提供有效的批量事项数据' });
    }

    const inputItems = payload.items as Record<string, unknown>[];
    const now = new Date();
    const results: { row: number; id?: string; serialNo: string; success: boolean; skipped?: boolean; error?: string }[] = [];

    // 预查所有序号是否已存在
    const serialNos = inputItems.map((item, _i) => String(item.serialNo || '').trim()).filter(Boolean);
    const existingSerials = new Set<string>();
    if (serialNos.length > 0) {
      const existing = await db
        .select({ serialNo: itemsTable.serialNo })
        .from(itemsTable)
        .where(inArray(itemsTable.serialNo, serialNos));
      existing.forEach((e) => existingSerials.add(e.serialNo));
    }

    // 收集所有需要查找的跟进人名
    const followerInputNames = [...new Set(inputItems.flatMap(item => asStringList(item.followerNames || item.followerName || item.followerId)))];
    const allUsers = accessContext?.users || [];
    const followerUsers = allUsers.filter(u => followerInputNames.some(name =>
      normalizeIdentity(name) === normalizeIdentity(u.name) ||
      normalizeIdentity(name) === normalizeIdentity(u.username || '')
    ));

    for (let i = 0; i < inputItems.length; i++) {
      const item = inputItems[i];
      const row = (item._row as number) || i + 2;

      try {
        const serialNo = String(item.serialNo || '').trim();
        const title = String(item.title || '').trim();
        const ownerNames = asStringList(item.ownerNames || item.ownerName);
        const ownerName = ownerNames[0] || '';
        const inputFollowerNames = asStringList(item.followerNames || item.followerName || item.followerId);
        const followerName = inputFollowerNames[0] || '';
        const meetingSource = String(item.meetingSource || '').trim();
        const raiseDate = String(item.raiseDate || '').trim();
        const deptNames = asStringList(item.deptNames || item.deptName);

        // 字段校验
        if (!serialNo) {
          results.push({ row, serialNo: '', success: false, error: '督办序号不能为空' });
          continue;
        }
        if (existingSerials.has(serialNo)) {
          results.push({ row, serialNo, success: false, error: `数据库中已存在该序号，请勿重复导入` });
          continue;
        }
        if (!title) {
          results.push({ row, serialNo, success: false, error: '督办事项不能为空' });
          continue;
        }
        if (!ownerName) {
          results.push({ row, serialNo, success: false, error: '责任人不能为空' });
          continue;
        }
        if (!followerName) {
          results.push({ row, serialNo, success: false, error: '督办跟进人不能为空' });
          continue;
        }
        if (!meetingSource) {
          results.push({ row, serialNo, success: false, error: '提出会议不能为空' });
          continue;
        }
        if (!raiseDate) {
          results.push({ row, serialNo, success: false, error: '提出时间不能为空' });
          continue;
        }

        const invalidDeptNames = deptNames.filter((name) =>
          !allDepartments.some((dept: any) => normalizeIdentity(dept.name) === normalizeIdentity(name))
        );
        if (invalidDeptNames.length > 0) {
          results.push({ row, serialNo, success: false, error: `系统中并无此部门：${invalidDeptNames.map(name => `「${name}」`).join('、')}` });
          continue;
        }

        const matchedDepartments = deptNames.map((name) =>
          allDepartments.find((dept: any) => normalizeIdentity(dept.name) === normalizeIdentity(name))
        ).filter(Boolean) as any[];
        const matchedOwners = ownerNames.map((name) =>
          allUsers.find((user: any) =>
            normalizeIdentity(user.name) === normalizeIdentity(name) ||
            normalizeIdentity(user.username || '') === normalizeIdentity(name)
          )
        );
        const invalidOwnerNames = ownerNames.filter((_, index) => !matchedOwners[index]);
        if (invalidOwnerNames.length > 0) {
          results.push({ row, serialNo, success: false, error: `系统中并无此成员姓名：${invalidOwnerNames.map(name => `「${name}」`).join('、')}` });
          continue;
        }

        if (deptNames.length > 1 || ownerNames.length > 1) {
          if (deptNames.length !== ownerNames.length) {
            results.push({
              row,
              serialNo,
              success: false,
              error: `责任部门与责任人数量不一致，无法一对一匹配：部门 ${deptNames.length} 个，责任人 ${ownerNames.length} 个`,
            });
            continue;
          }

          const ownerDeptPairMismatches = matchedOwners
            .map((owner, index) => ({ owner, index }))
            .filter(({ owner, index }) => {
              const dept = matchedDepartments[index];
              return !owner || !dept || !owner.deptId || String(owner.deptId) !== String(dept.id);
            });
          if (ownerDeptPairMismatches.length > 0) {
            const mismatchDetails = ownerDeptPairMismatches.map(({ owner, index }) => {
              const deptName = deptNames[index] || '未知部门';
              return `「${deptName}」中并无成员「${owner?.name || owner?.username || ownerNames[index]}」`;
            });
            results.push({ row, serialNo, success: false, error: mismatchDetails.join('；') });
            continue;
          }
        } else {
          const dept = matchedDepartments[0];
          const owner = (matchedOwners.filter(Boolean) as any[])[0];
          if (dept && owner && (!owner.deptId || String(owner.deptId) !== String(dept.id))) {
            results.push({ row, serialNo, success: false, error: `「${deptNames[0]}」中并无成员「${owner.name || owner.username}」` });
            continue;
          }
        }

        // 解析跟进人，支持多个督办专员
        const matchedFollowers: typeof allUsers = [];
        for (const name of inputFollowerNames) {
          const matchedFollower = followerUsers.find(u =>
            normalizeIdentity(u.name) === normalizeIdentity(name) ||
            normalizeIdentity(u.username || '') === normalizeIdentity(name)
          ) || allUsers.find(u =>
            normalizeIdentity(u.name) === normalizeIdentity(name) ||
            normalizeIdentity(u.username || '') === normalizeIdentity(name)
          );

          if (!matchedFollower) {
            results.push({ row, serialNo, success: false, error: `跟进人「${name}」在系统中不存在` });
            continue;
          }

          if (!isFollowerCandidateUser(matchedFollower)) {
            results.push({ row, serialNo, success: false, error: `「${name}」不是督办专员，不能作为跟进人` });
            continue;
          }

          matchedFollowers.push(matchedFollower);
        }
        if (matchedFollowers.length !== inputFollowerNames.length) continue;

        const id = uuid();
        const resolvedOwnerPairs = (matchedOwners.filter(Boolean) as any[])
          .map((owner: any) => ({ id: owner.id || owner.username || owner.name || '', name: owner.name || owner.username || '' }))
          .filter((pair: any) => pair.id);
        const resolvedOwnerIds = resolvedOwnerPairs.map((pair: any) => pair.id);
        const resolvedOwnerNames = resolvedOwnerPairs.map((pair: any) => pair.name);
        const resolvedOwnerId = resolvedOwnerIds[0] || ownerName;
        const resolvedOwnerName = resolvedOwnerNames[0] || ownerName;
        const followerPairs = matchedFollowers
          .map((u: any) => ({ id: u.id || u.username || u.name || '', name: u.name || u.username || '' }))
          .filter((pair: any) => pair.id);
        const followerIds = followerPairs.map((pair: any) => pair.id);
        const resolvedFollowerNames = followerPairs.map((pair: any) => pair.name);
        const followerId = followerIds[0] || followerName;
        const resolvedFollowerName = resolvedFollowerNames[0] || followerName;

        // 多责任人自动拆分：每位责任人生成一条独立子任务
        const batchOwnerPairs = buildOwnerPairs(resolvedOwnerIds, resolvedOwnerNames);
        const batchAutoSubTasks = buildAutoSubTasks(
          id,
          batchOwnerPairs,
          {
            title,
            requiredCompletionDate: item.requiredCompletionDate ? String(item.requiredCompletionDate) : null,
            plannedCompletionDate: item.plannedCompletionDate ? String(item.plannedCompletionDate) : null,
          },
          uuid,
        );

        // 保留逐行部分成功的导入语义，但每一行的事项、CREATE 时间轴和通知必须全成或全败。
        await db.transaction(async (tx: any) => {
          await tx.insert(itemsTable).values({
            id,
            serialNo,
            title,
            content: title,
            status: 'PENDING',
            deadline: item.requiredCompletionDate ? new Date(String(item.requiredCompletionDate)) : null,
            issuerId: req.authUser?.id || null,
            issuerName: req.authUser?.name || '系统',
            issuerAccount: req.authUser?.username || req.authUser?.id || 'system',
            ownerName: resolvedOwnerName,
            ownerId: resolvedOwnerId,
            followerName: resolvedFollowerName,
            followerId,
            meetingSource,
            raiseDate: raiseDate ? new Date(raiseDate) : null,
            requiredCompletionDate: item.requiredCompletionDate ? new Date(String(item.requiredCompletionDate)) : null,
            plannedCompletionDate: item.plannedCompletionDate ? new Date(String(item.plannedCompletionDate)) : null,
            actualCompletionDate: item.actualCompletionDate ? new Date(String(item.actualCompletionDate)) : null,
            deptNames,
            ownerIds: resolvedOwnerIds,
            ownerNames: resolvedOwnerNames,
            followerIds,
            followerNames: resolvedFollowerNames,
            category: '',
            campus: '',
            subTasks: batchAutoSubTasks,
            createdAt: now,
            updatedAt: now,
          } as any);

          await tx.insert(timelineNodes).values({
            id: uuid(),
            itemId: id,
            type: 'CREATE',
            user: req.authUser?.name || '系统',
            content: '批量导入该督办事项',
            timestamp: now,
          } as any);

          const createMessages = buildCreateItemMessages({
            itemId: id,
            serialNo,
            title,
            ownerIds: resolvedOwnerIds,
            ownerNames: resolvedOwnerNames,
            followerIds,
            followerNames: resolvedFollowerNames,
            senderId: req.authUser?.id || null,
            senderName: req.authUser?.name || '系统',
          });

          if (createMessages.length > 0) {
            await tx.insert(messagesTable).values(
              createMessages.map((message) => ({
                id: uuid(),
                title: message.title,
                content: message.content,
                type: message.type,
                timestamp: now,
                link: message.link,
                receiverId: message.receiverId,
                receiverName: message.receiverName,
                senderId: message.senderId || null,
                senderName: message.senderName || null,
              } as any)),
            );
          }
        });

        existingSerials.add(serialNo);
        results.push({ row, id, serialNo, success: true });
      } catch (error: any) {
        results.push({
          row,
          serialNo: String(item.serialNo || ''),
          success: false,
          error: error?.message || '创建失败',
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    return res.status(200).json({
      total: inputItems.length,
      successCount,
      failCount,
      results,
    });
  } catch (error) {
    console.error('Batch create items error:', error);
    return res.status(500).json({ error: '批量创建事项失败' });
  }
});

// 更新事项
itemsRouter.put('/:id', async (req: AuthenticatedRequest & Request<{ id: string }>, res: Response) => {
  try {
    if (!req.authUser) {
      return res.status(401).json({ error: '请先登录' });
    }

    const db = await getDb();
    await ensureNotificationIdentityColumns(db);
    const { items: itemsTable, auditRecords: auditTable, messages: messagesTable, timelineNodes } = await import('../db/schema');
    const { eq } = await import('drizzle-orm');
    const { v4: uuid } = await import('uuid');
    const accessContext = await getCurrentAccessContext(db, req.authUser?.id);
    return db.transaction(async (tx: any) => {
    const db = tx;
    const [currentItem] = await db
      .select()
      .from(itemsTable)
      .where(eq(itemsTable.id, req.params.id))
      .limit(1)
      .for('update');

    if (!currentItem) return res.status(404).json({ error: '事项不存在' });
    const normalizedCurrentItem = normalizeItemJsonFields(currentItem);

    // 数据权限隔离：正常事项按默认范围过滤；回收站恢复/彻底删除需显式纳入软删除数据。
    const isRecycleBinMutation = getDeclaredItemPageAuth(req) === 'MENU_RECYCLE_BIN';
    if (filterItemsByAccess(
      [normalizedCurrentItem as AccessItemLike],
      accessContext,
      { includeDeleted: isRecycleBinMutation, onlyDeleted: isRecycleBinMutation },
    ).length === 0) {
      return res.status(403).json({ error: '当前事项不在您的数据权限范围内' });
    }

    const invalidFields = getInvalidItemUpdateFields(req.body || {});
    if (invalidFields.length > 0) {
      return res.status(400).json({ error: `当前接口暂不支持更新字段: ${invalidFields.join(', ')}` });
    }

    // 状态流转前置校验：拦截非法/伪造的状态切换，避免绕过业务规则。
    if (!ensureValidItemStatusTransition(normalizedCurrentItem, req.body || {}, res)) return;

    const actorFlags = getItemActorFlags(accessContext, normalizedCurrentItem);
    const incomingTimeline = Array.isArray(req.body?.timeline) ? req.body.timeline : [];
    const isFollowerTimelineFeedback = incomingTimeline.length > 0 && actorFlags.isFollower && !actorFlags.isOwner && !actorFlags.hasGlobalPrivilege;
    const existingTimeline = incomingTimeline.length > 0
      ? await db.select({ id: timelineNodes.id }).from(timelineNodes).where(eq(timelineNodes.itemId, normalizedCurrentItem.id))
      : [];
    const existingTimelineIds = new Set<string>(existingTimeline.map((node: { id: string }) => node.id));
    let trustedTimelineNodes: Array<Record<string, unknown>> = [];
    try {
      trustedTimelineNodes = buildTrustedTimelineNodes(
        incomingTimeline,
        existingTimelineIds,
        {
          id: accessContext.currentUser?.id || req.authUser.id,
          name: accessContext.currentUser?.name || req.authUser.name,
        },
        uuid,
        () => new Date(),
        isFollowerTimelineFeedback,
      );
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : '时间线节点格式无效' });
    }
    const authorizationPayload = { ...(req.body || {}) };
    if (incomingTimeline.length > 0) {
      if (trustedTimelineNodes.length > 0) authorizationPayload.timeline = trustedTimelineNodes;
      else delete authorizationPayload.timeline;
    }
    const requestedActions = getRequiredActionsForItemUpdate(
      authorizationPayload,
      { status: normalizedCurrentItem.status, timeline: existingTimeline },
    );

    // ─── 单独操作某条子任务（跟进人专用）：仅废弃/重启单条子集，不影响父级与其他子集 ───
    if (req.body?.targetSubTaskId && Array.isArray(normalizedCurrentItem.subTasks) && normalizedCurrentItem.subTasks.length) {
      if (!actorFlags.isFollower && !actorFlags.hasGlobalPrivilege) {
        return res.status(403).json({ error: '仅事项跟进人可单独操作子任务' });
      }
      const targetId = String(req.body.targetSubTaskId);
      const target = normalizedCurrentItem.subTasks.find((t: any) => t.id === targetId);
      if (!target) {
        return res.status(404).json({ error: '子任务不存在' });
      }
      const desired = typeof req.body?.status === 'string' ? req.body.status : undefined;
      if (!['DISABLED', 'EXECUTING'].includes(desired || '')) {
        return res.status(400).json({ error: '该操作不支持单独对子任务执行' });
      }
      const nextSubTasks = normalizedCurrentItem.subTasks.map((t: any) => t.id === targetId ? { ...t, status: desired } : t);
      const nextParentStatus = aggregateSubTaskStatus(nextSubTasks as any);
      const timelineId = uuid();
      await db.insert(timelineNodes).values({
        id: timelineId,
        itemId: normalizedCurrentItem.id,
        type: desired === 'DISABLED' ? 'DISABLE' : 'RESTART',
        user: req.authUser?.name || '系统',
        content: desired === 'DISABLED'
          ? `单独废弃子任务（责任人：${target.assigneeName || ''}）`
          : `单独重启子任务（责任人：${target.assigneeName || ''}）`,
        timestamp: new Date(),
      } as any);
      await db
        .update(itemsTable)
        .set({ subTasks: nextSubTasks, status: nextParentStatus, updatedAt: new Date() } as any)
        .where(eq(itemsTable.id, req.params.id));
      return res.json({ success: true });
    }
    const actions = [...new Set(requestedActions.map((action) =>
      action === 'FEEDBACK_ITEM' && isFollowerTimelineFeedback ? 'CHANGE_ITEM' : action
    ))];
    if (!ensureItemActionsAllowed(accessContext, actions, res, req.body || {}, getDeclaredItemPageAuth(req))) return;
    for (const action of actions) {
      if (!ensureItemActorAllowed(accessContext, action, normalizedCurrentItem, res, req.body || {})) return;
    }

    // 回收站内的恢复/删除操作：非管理员仅可操作本人删除的事项，避免越权处置他人删除项。
    if (getDeclaredItemPageAuth(req) === 'MENU_RECYCLE_BIN') {
      const isRecycleAdmin = accessContext.currentUser?.role === 'ADMIN' || accessContext.currentRole?.permissions?.includes('ALL');
      if (!isRecycleAdmin && normalizedCurrentItem.deletedById !== accessContext.currentUser?.id) {
        return res.status(403).json({ error: '仅可操作本人删除的回收站事项' });
      }
    }

    if (actions.includes('DELAY_ITEM') && normalizedCurrentItem.status !== 'OVERDUE') {
      return res.status(400).json({ error: '仅已超时的事项允许申请延期' });
    }

    const updates = sanitizeItemUpdates(req.body || {});
    const nextStatus = typeof req.body?.status === 'string' ? req.body.status : undefined;

    // 软删除/恢复的不变量必须由服务端生成，不能信任客户端伪造 deletedAt/deletedById/originalStatus。
    // 删除时保留原状态；恢复时严格使用原状态，并清理回收站元数据。
    if (nextStatus === 'DELETED' && normalizedCurrentItem.status !== 'DELETED') {
      updates.status = 'DELETED';
      updates.originalStatus = normalizedCurrentItem.status;
      updates.deletedAt = new Date();
      updates.deletedById = accessContext.currentUser?.id || req.authUser.id;
    } else if (normalizedCurrentItem.status === 'DELETED' && nextStatus && nextStatus !== 'DELETED') {
      // 客户端只能发起 EXECUTING 恢复意图；实际恢复到删除前的服务端原状态。
      updates.status = normalizedCurrentItem.originalStatus || 'PENDING';
      updates.originalStatus = null;
      updates.deletedAt = null;
      updates.deletedById = null;
    } else {
      // 非回收站流转不得借统一更新接口篡改删除元数据。
      delete updates.originalStatus;
      delete updates.deletedAt;
      delete updates.deletedById;
    }

    const ownerActivityTimelineTypes = trustedTimelineNodes
      .filter((node) => node.type === 'SIGN' || node.type === 'FEEDBACK')
      .map((node) => typeof node.type === 'string' ? node.type : undefined);
    const shouldStartPendingItem = shouldStartPendingItemAfterOwnerActivity(
      normalizedCurrentItem.status,
      ownerActivityTimelineTypes,
    );
    if (shouldStartPendingItem) {
      const updatedSubTasks = applyOwnerActivitySubTaskUpdate(
        normalizedCurrentItem,
        accessContext.currentUser || req.authUser,
        req.body || {},
      );
      if (updatedSubTasks) {
        updates.subTasks = updatedSubTasks;
      }
      // 状态由服务端权威函数统一决定：多责任人聚合子任务，单责任人无子任务则落库 EXECUTING。
      updates.status = derivePersistedItemStatus({
        currentStatus: normalizedCurrentItem.status,
        requestedStatus: typeof updates.status === 'string' ? updates.status as any : undefined,
        subTasks: updatedSubTasks as any,
        ownerActivityTimelineTypes,
      });
    } else if (actions.includes('SIGN_ITEM') && typeof req.body?.status === 'string') {
      updates.status = req.body.status;
    }
    if (hasFollowerSelectionPayload(req.body || {})) {
      const followerSelection = normalizeFollowerSelection(req.body || {}, accessContext?.users || [], { required: true });
      if (!followerSelection.valid) {
        return res.status(400).json({ error: 'error' in followerSelection ? followerSelection.error : '请选择有效的督办专员' });
      }
      Object.assign(updates, followerSelection.updates);
    }
    if (isFollowerTimelineFeedback) {
      delete updates.status;
      delete updates.progress;
      delete updates.lastFeedbackDate;
    }
    if (Object.keys(updates).length === 1 && updates.updatedAt && incomingTimeline.length === 0) {
      return res.status(400).json({ error: '未提供可更新字段' });
    }

    const isFinalApprover = isFollowerSupervisor(accessContext, normalizedCurrentItem);

    if (nextStatus === 'REVIEWING' && normalizedCurrentItem.status !== 'REVIEWING') {
      const isOwnerApplicant = [...asStringList(normalizedCurrentItem.ownerIds), normalizedCurrentItem.ownerId]
        .filter(Boolean).includes(req.authUser?.id || '');
      // 申请人（责任人）子任务进入待审批完成；跟进人发起的整体完成则所有责任人子任务进入待审批
      const applySubTasks = Array.isArray(normalizedCurrentItem.subTasks)
        ? normalizedCurrentItem.subTasks.map((t: any) => {
            if (isOwnerApplicant) {
              const isApplicant = (req.authUser?.id && t.assigneeId === req.authUser.id)
                || (req.authUser?.name && t.assigneeName === req.authUser.name);
              return isApplicant ? { ...t, status: 'REVIEWING', followerApprovedBy: '', finalApprovedBy: '' } : t;
            }
            // 跟进人发起的整体完成申请：所有责任人子任务进入待审批，且视为已通过跟进人本级
            return { ...t, status: 'REVIEWING', followerApprovedBy: req.authUser?.name || '', finalApprovedBy: '' };
          })
        : undefined;
      if (applySubTasks) {
        updates.subTasks = applySubTasks;
      }
      updates.status = 'REVIEWING';

      // 历史审批记录：按申请人记录，不再因已有记录而跳过，避免多责任人各自申请完成时被 409 卡死
      await db.insert(auditTable).values({
        id: uuid(),
        itemId: normalizedCurrentItem.id,
        itemTitle: normalizedCurrentItem.title,
        applicantName: req.authUser?.name || normalizedCurrentItem.ownerName || '',
        reviewerName: null,
        status: 'PENDING',
        result: null,
        comment: '',
        submittedAt: new Date(),
      } as any);

      // 通知下一步审批人
      if (isOwnerApplicant) {
        // 责任人申请完成 → 通知督办跟进人审批
        const applyFollowerIds = [normalizedCurrentItem.followerId, ...asStringList(normalizedCurrentItem.followerIds)].filter(Boolean);
        const applyFollowerNames = [normalizedCurrentItem.followerName, ...asStringList(normalizedCurrentItem.followerNames)].filter(Boolean);
        if (applyFollowerIds.length > 0 && applyFollowerIds.some((id) => id !== req.authUser?.id)) {
          const followerMessages = applyFollowerIds
            .map((fid, idx) => ({
              id: uuid(),
              title: '待审批提醒',
              content: `【${normalizedCurrentItem.title || ''}】责任人已提交完成申请，请您审批。`,
              type: 'TODO',
              timestamp: new Date(),
              link: `/items/${normalizedCurrentItem.id}`,
              receiverId: fid,
              receiverName: applyFollowerNames[idx] || '',
              senderId: req.authUser?.id || null,
              senderName: req.authUser?.name || null,
            }))
            .filter((m) => m.receiverId);
          if (followerMessages.length > 0) {
            await db.insert(messagesTable).values(followerMessages as any);
          }
        }
      } else if (accessContext?.users) {
        // 跟进人发起的整体完成申请 → 通知其上级（督办管理员）终审
        const supervisorIds = getFollowerSupervisorIds(normalizedCurrentItem, accessContext.users);
        const leaderRecipients = accessContext.users.filter((user) =>
          user.id !== req.authUser?.id && supervisorIds.includes(user.id) && (user as any).status === 'ACTIVE');
        const leaderMessages = leaderRecipients.map((leader) => ({
          id: uuid(),
          title: '终审待办通知',
          content: `【${normalizedCurrentItem.title || ''}】跟进人已申请整体完成，请进行最终审批。`,
          type: 'TODO',
          timestamp: new Date(),
          link: `/items/${normalizedCurrentItem.id}`,
          receiverId: leader.id,
          receiverName: leader.name,
          senderId: req.authUser?.id || null,
          senderName: req.authUser?.name || null,
        }));
        if (leaderMessages.length > 0) {
          await db.insert(messagesTable).values(leaderMessages as any);
        }
      }
    }

    // 跟进人审批通过（非终审）：将待审批完成的子任务标记「已通过跟进人本级」，通知上级领导终审
    if (nextStatus === 'REVIEWING' && normalizedCurrentItem.status === 'REVIEWING') {
      const reviewSubTasks = Array.isArray(normalizedCurrentItem.subTasks) ? normalizedCurrentItem.subTasks : [];
      const pendingSubTasks = reviewSubTasks.filter((t: any) => t.status === 'REVIEWING' && !t.followerApprovedBy);
      if (pendingSubTasks.length === 0) {
        // 无待跟进人审批的子任务（可能已被其他跟进人审批）；非终审人视为已提交上级终审
        if (!isFinalApprover) return res.json({ success: true, claimed: true });
      } else {
        const nextSubTasks = reviewSubTasks.map((t: any) =>
          (t.status === 'REVIEWING' && !t.followerApprovedBy)
            ? { ...t, followerApprovedBy: req.authUser?.name || '' }
            : t,
        );
        updates.subTasks = nextSubTasks;
        updates.status = 'REVIEWING';
        if (!isFinalApprover && accessContext?.users) {
          const supervisorIds = getFollowerSupervisorIds(normalizedCurrentItem, accessContext.users);
          const leaderRecipients = accessContext.users.filter((user) =>
            user.id !== req.authUser?.id && supervisorIds.includes(user.id) && (user as any).status === 'ACTIVE');
          const leaderMessages = leaderRecipients.map((leader) => ({
            id: uuid(),
            title: '终审待办通知',
            content: `【${normalizedCurrentItem.title || ''}】已通过专员审批，请进行最终审批。`,
            type: 'TODO',
            timestamp: new Date(),
            link: `/items/${normalizedCurrentItem.id}`,
            receiverId: leader.id,
            receiverName: leader.name,
            senderId: req.authUser?.id || null,
            senderName: req.authUser?.name || null,
          }));
          if (leaderMessages.length > 0) {
            await db.insert(messagesTable).values(leaderMessages as any);
          }
        }
        await db.insert(timelineNodes).values({
          id: uuid(),
          itemId: normalizedCurrentItem.id,
          type: 'APPROVE',
          user: req.authUser?.name || '系统',
          content: '审批通过，已提交上级领导终审',
          timestamp: new Date(),
        } as any);
      }
    }

    // 审批通过 / 终审：依据 isFinalApprover + 子任务审批字段，逐子任务独立流转（各责任人审批流互不影响）
    if (nextStatus === 'COMPLETED' && normalizedCurrentItem.status === 'REVIEWING') {
      const reviewSubTasks = Array.isArray(normalizedCurrentItem.subTasks) ? normalizedCurrentItem.subTasks : [];
      const { v4: uuid } = await import('uuid');

      if (isFinalApprover) {
        // 上级终审：办结所有「已通过跟进人本级（followerApprovedBy 非空）」的子任务；其余子任务（其他责任人尚未走到终审）不受影响
        const completedSubTasks = reviewSubTasks.filter(
          (t: any) => t.status === 'REVIEWING' && t.followerApprovedBy,
        );
        const nextSubTasks = reviewSubTasks.map((t: any) =>
          (t.status === 'REVIEWING' && t.followerApprovedBy)
            ? { ...t, finalApprovedBy: req.authUser?.name || '', status: 'COMPLETED' as const }
            : t,
        );
        updates.subTasks = nextSubTasks;
        updates.status = aggregateSubTaskStatus(nextSubTasks as any);

        // 通知被办结的责任人
        const ownerMessages = completedSubTasks
          .filter((t: any) => t.assigneeId)
          .map((t: any) => ({
            id: uuid(),
            title: '完成通知',
            content: `【${normalizedCurrentItem.title || ''}】您负责的子任务已审批通过，事项已正常完成。`,
            type: 'TODO',
            timestamp: new Date(),
            link: `/items/${normalizedCurrentItem.id}`,
            receiverId: t.assigneeId,
            receiverName: t.assigneeName || '',
            senderId: req.authUser?.id || null,
            senderName: req.authUser?.name || null,
          }));
        if (ownerMessages.length > 0) {
          await db.insert(messagesTable).values(ownerMessages as any);
        }

        await db.insert(auditTable).values({
          id: uuid(),
          itemId: normalizedCurrentItem.id,
          itemTitle: normalizedCurrentItem.title,
          applicantName: completedSubTasks.map((t: any) => t.assigneeName).filter(Boolean).join('、') || normalizedCurrentItem.ownerName || '',
          reviewerName: req.authUser?.name || '',
          status: 'APPROVED',
          result: 'APPROVED',
          comment: '终审通过，事项已正常完成',
          submittedAt: new Date(),
          reviewedAt: new Date(),
        } as any);

        await db.insert(timelineNodes).values({
          id: uuid(),
          itemId: normalizedCurrentItem.id,
          type: 'APPROVE',
          user: req.authUser?.name || '系统',
          content: '审批通过，事项已正常完成',
          timestamp: new Date(),
        } as any);
      } else {
        // 跟进人（非终审）审批：将尚无跟进人审批的子任务标记 followerApprovedBy，父级保持「待审批完成」，通知上级终审
        const pendingSubTasks = reviewSubTasks.filter(
          (t: any) => t.status === 'REVIEWING' && !t.followerApprovedBy,
        );
        if (pendingSubTasks.length === 0) {
          // 无待本跟进人审批的子任务（可能已被其他跟进人审批），视为已提交上级终审
          return res.json({ success: true, claimed: true });
        }
        const nextSubTasks = reviewSubTasks.map((t: any) =>
          (t.status === 'REVIEWING' && !t.followerApprovedBy)
            ? { ...t, followerApprovedBy: req.authUser?.name || '' }
            : t,
        );
        updates.subTasks = nextSubTasks;
        updates.status = 'REVIEWING';

        if (accessContext?.users) {
          const supervisorIds = getFollowerSupervisorIds(normalizedCurrentItem, accessContext.users);
          const leaderRecipients = accessContext.users.filter((user) =>
            user.id !== req.authUser?.id && supervisorIds.includes(user.id) && (user as any).status === 'ACTIVE');
          const leaderMessages = leaderRecipients.map((leader) => ({
            id: uuid(),
            title: '终审待办通知',
            content: `【${normalizedCurrentItem.title || ''}】已通过专员审批，请进行最终审批。`,
            type: 'TODO',
            timestamp: new Date(),
            link: `/items/${normalizedCurrentItem.id}`,
            receiverId: leader.id,
            receiverName: leader.name,
            senderId: req.authUser?.id || null,
            senderName: req.authUser?.name || null,
          }));
          if (leaderMessages.length > 0) {
            await db.insert(messagesTable).values(leaderMessages as any);
          }
        }

        await db.insert(timelineNodes).values({
          id: uuid(),
          itemId: normalizedCurrentItem.id,
          type: 'APPROVE',
          user: req.authUser?.name || '系统',
          content: '审批通过，已提交上级领导终审',
          timestamp: new Date(),
        } as any);
      }
    }

    // 未按要求完成：督办状态与所有责任人子任务状态统一变更为「未按要求完成」（子任务状态跟随父级，互不拖累）
    if (nextStatus === 'NOT_SATISFIED' && normalizedCurrentItem.status !== 'NOT_SATISFIED') {
      const reviewSubTasks = Array.isArray(normalizedCurrentItem.subTasks) ? normalizedCurrentItem.subTasks : [];
      const nextSubTasks = reviewSubTasks.length
        ? reviewSubTasks.map((t: any) => (t.status === 'DELETED' ? t : { ...t, status: 'NOT_SATISFIED' as const }))
        : undefined;
      if (nextSubTasks) updates.subTasks = nextSubTasks;
      updates.status = 'NOT_SATISFIED';

      const owners = getItemOwners(normalizedCurrentItem);
      const { v4: uuid } = await import('uuid');
      const ownerMessages = owners
        .filter((o: any) => o.id)
        .map((o: any) => ({
          id: uuid(),
          title: '未按要求完成通知',
          content: `【${normalizedCurrentItem.title || ''}】被督办跟进人标记为未按要求完成。`,
          type: 'TODO',
          timestamp: new Date(),
          link: `/items/${normalizedCurrentItem.id}`,
          receiverId: o.id,
          receiverName: o.name || '',
          senderId: req.authUser?.id || null,
          senderName: req.authUser?.name || null,
        }));
      if (ownerMessages.length > 0) {
        await db.insert(messagesTable).values(ownerMessages as any);
      }
    }

    if (nextStatus === 'EXECUTING' && normalizedCurrentItem.status === 'REVIEWING') {
      const rejectReason = typeof req.body?.rejectReason === 'string' ? req.body.rejectReason.trim() : '';
      if (!rejectReason) {
        return res.status(400).json({ error: '驳回意见不能为空' });
      }

      // 事项整体退回执行中时，必须同步关闭同一事项所有进行中的申请记录；
      // 不能只驳回最新一条，否则审核台账会残留 PENDING/REVIEWING。
      const pendingAuditRecords = await db.select({ id: auditTable.id }).from(auditTable)
        .where(and(
          eq(auditTable.itemId, normalizedCurrentItem.id),
          inArray(auditTable.status, ['PENDING', 'REVIEWING']),
        ))
        .for('update');
      if (pendingAuditRecords.length > 0) {
        await db
          .update(auditTable)
          .set({
            reviewerName: req.authUser?.name || null,
            status: 'REJECTED',
            result: 'REJECTED',
            comment: rejectReason,
            reviewedAt: new Date(),
          } as any)
          .where(and(
            eq(auditTable.itemId, normalizedCurrentItem.id),
            inArray(auditTable.status, ['PENDING', 'REVIEWING']),
          ));
      }

      // 驳回：将申请完成的子任务（REVIEWING）回退为执行中，父级状态取最差状态
      const rejectSubTasks = Array.isArray(normalizedCurrentItem.subTasks)
        ? normalizedCurrentItem.subTasks.map((t: any) => (t.status === 'REVIEWING' ? { ...t, status: 'EXECUTING' } : t))
        : undefined;
      if (rejectSubTasks) {
        updates.subTasks = rejectSubTasks;
      }
      updates.status = rejectSubTasks && rejectSubTasks.length > 0
        ? aggregateSubTaskStatus(rejectSubTasks as any)
        : 'EXECUTING';

      // 驳回：写入审批驳回时间轴节点（服务器时间）
      const { v4: uuid } = await import('uuid');
      await db.insert(timelineNodes).values({
        id: uuid(),
        itemId: normalizedCurrentItem.id,
        type: 'REJECT',
        user: req.authUser?.name || '系统',
        content: `审批驳回：${rejectReason}`,
        timestamp: new Date(),
      } as any);
    }

    if (nextStatus === 'DELAYED' && normalizedCurrentItem.status !== 'DELAYED') {
      const rawPlannedCompletionDate = typeof req.body?.plannedCompletionDate === 'string'
        ? req.body.plannedCompletionDate.trim()
        : (typeof req.body?.deadline === 'string' ? req.body.deadline.trim() : '');
      const plannedCompletionDate = rawPlannedCompletionDate ? new Date(rawPlannedCompletionDate) : null;
      if (!plannedCompletionDate || Number.isNaN(plannedCompletionDate.getTime())) {
        return res.status(400).json({ error: '延期必须填写有效的新计划完成日期' });
      }
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const normalizedPlannedCompletionDate = new Date(plannedCompletionDate);
      normalizedPlannedCompletionDate.setHours(0, 0, 0, 0);
      if (normalizedPlannedCompletionDate <= today) {
        return res.status(400).json({ error: '延期后的计划完成日期必须晚于今天' });
      }

      // 自动引擎优先读取 plannedCompletionDate。同步兼容字段，避免下一轮被旧 deadline 覆盖为超期。
      updates.status = 'DELAYED';
      updates.plannedCompletionDate = plannedCompletionDate;
      updates.deadline = plannedCompletionDate;

      const delayReason = incomingTimeline
        .map((node: any) => typeof node?.content === 'string' ? node.content.trim() : '')
        .find(Boolean) || '';
      const plannedCompletionDateText = formatDateOnly(plannedCompletionDate);
      await db.insert(timelineNodes).values({
        id: uuid(),
        itemId: normalizedCurrentItem.id,
        type: 'DELAY',
        user: req.authUser?.name || '系统',
        actorUserId: req.authUser?.id || null,
        content: `申请延期${delayReason ? `。原因：${delayReason}` : ''}，新计划完成日期：${plannedCompletionDateText}`,
        timestamp: new Date(),
      } as any);

      const owners = getItemOwners(normalizedCurrentItem);
      const followers = getItemFollowers(normalizedCurrentItem);
      const delayMessages = buildDelayMessages({
        itemId: normalizedCurrentItem.id,
        itemTitle: normalizedCurrentItem.title,
        reason: delayReason,
        plannedCompletionDate: plannedCompletionDateText,
        ownerIds: owners.map((owner) => owner.id),
        ownerNames: owners.map((owner) => owner.name),
        followerIds: followers.map((follower) => follower.id),
        followerNames: followers.map((follower) => follower.name),
        senderId: req.authUser?.id || null,
        senderName: req.authUser?.name || null,
      });
      if (delayMessages.length > 0) {
        await db.insert(messagesTable).values(delayMessages.map((message) => ({
          id: uuid(),
          title: message.title,
          content: message.content,
          type: message.type,
          timestamp: new Date(),
          link: message.link,
          receiverId: message.receiverId,
          receiverName: message.receiverName,
          senderId: message.senderId || null,
          senderName: message.senderName || null,
        })) as any);
      }
    }

    if (nextStatus === 'SUSPENDED' && normalizedCurrentItem.status !== 'SUSPENDED') {
      const nextSubTasks = suspendOwnerSubTasks(normalizedCurrentItem);
      if (nextSubTasks) {
        updates.subTasks = nextSubTasks;
      }

      const owners = getItemOwners(normalizedCurrentItem);
      const suspendReason = incomingTimeline
        .map((node: any) => typeof node?.content === 'string' ? node.content : '')
        .find((content: string) => content.trim().length > 0) || '';
      const pendingMessages = buildSuspendMessages({
        itemId: normalizedCurrentItem.id,
        itemTitle: normalizedCurrentItem.title,
        reason: suspendReason,
        resumeDate: typeof req.body?.deadline === 'string' ? req.body.deadline : '',
        ownerIds: owners.map((owner) => owner.id),
        ownerNames: owners.map((owner) => owner.name),
        senderId: req.authUser?.id || null,
        senderName: req.authUser?.name || null,
      });

      if (pendingMessages.length > 0) {
        const { v4: uuid } = await import('uuid');
        await db.insert(messagesTable).values(
          pendingMessages.map((message) => ({
            id: uuid(),
            title: message.title,
            content: message.content,
            type: message.type,
            timestamp: new Date(),
            link: message.link,
            receiverId: message.receiverId,
            receiverName: message.receiverName,
            senderId: message.senderId || null,
            senderName: message.senderName || null,
          })) as any,
        );
      }
    }

    // 重启（已暂缓 / 已废弃 → 执行中）：父级操作必须由服务端同步所有可恢复子任务，
    // 不能依赖浏览器提交完整 subTasks，否则聚合会把父级重新覆盖为 SUSPENDED/DISABLED。
    if (nextStatus === 'EXECUTING' && (normalizedCurrentItem.status === 'SUSPENDED' || normalizedCurrentItem.status === 'DISABLED')) {
      const { v4: uuid } = await import('uuid');
      const resumeDate = typeof req.body?.deadline === 'string' ? req.body.deadline
        : (typeof req.body?.plannedCompletionDate === 'string' ? req.body.plannedCompletionDate : '');
      const nextSubTasks = syncParentStatusToSubTasks(normalizedCurrentItem, 'EXECUTING', req.body || {});
      if (nextSubTasks) updates.subTasks = nextSubTasks;
      updates.status = nextSubTasks && nextSubTasks.length > 0
        ? aggregateSubTaskStatus(nextSubTasks as any)
        : 'EXECUTING';
      await db.insert(timelineNodes).values({
        id: uuid(),
        itemId: normalizedCurrentItem.id,
        type: 'RESTART',
        user: req.authUser?.name || '系统',
        content: `重启事项${normalizedCurrentItem.status === 'DISABLED' ? '（撤销废弃）' : ''}${resumeDate ? `，新计划完成日期：${resumeDate}` : ''}，恢复执行中`,
        timestamp: new Date(),
      } as any);
    }

    // 废弃：父级操作必须由服务端同步子任务，避免聚合重新将父级写回执行中。
    if (nextStatus === 'DISABLED' && normalizedCurrentItem.status !== 'DISABLED') {
      const { v4: uuid } = await import('uuid');
      const disableReason = typeof req.body?.disableReason === 'string' ? req.body.disableReason.trim() : '';
      const nextSubTasks = syncParentStatusToSubTasks(normalizedCurrentItem, 'DISABLED', req.body || {});
      if (nextSubTasks) updates.subTasks = nextSubTasks;
      updates.status = 'DISABLED';
      await db.insert(timelineNodes).values({
        id: uuid(),
        itemId: normalizedCurrentItem.id,
        type: 'DISABLE',
        user: req.authUser?.name || '系统',
        content: `废弃事项${disableReason ? `。原因：${disableReason}` : ''}`,
        timestamp: new Date(),
      } as any);
    }

    // 共享：向新增的被共享人发送「待办提醒」消息，使其能在待办/事项中看到该事项
    if (Array.isArray(req.body?.sharedWith)) {
      const incomingShared = (req.body.sharedWith as Array<{ userId?: string; userName?: string }>).filter(Boolean);
      const existingSharedIds = new Set(
        asArrayValue(normalizedCurrentItem.sharedWith)
          .map((s: any) => (typeof s === 'string' ? s : s?.userId))
          .filter(Boolean),
      );
      const addedShared = incomingShared.filter((s) => s?.userId && !existingSharedIds.has(s.userId));
      if (addedShared.length > 0) {
        const { v4: uuid } = await import('uuid');
        const shareMessages = buildShareMessages({
          itemId: normalizedCurrentItem.id,
          itemTitle: normalizedCurrentItem.title,
          sharedBy: req.authUser?.name || '',
          targets: addedShared.map((s) => ({ userId: s.userId as string, userName: s.userName || '' })),
        });
        if (shareMessages.length > 0) {
          await db.insert(messagesTable).values(
            shareMessages.map((message) => ({
              id: uuid(),
              title: message.title,
              content: message.content,
              type: message.type,
              timestamp: new Date(),
              link: message.link,
              receiverId: message.receiverId,
              receiverName: message.receiverName,
              senderId: req.authUser?.id || null,
              senderName: req.authUser?.name || null,
            })) as any,
          );
        }
      }
    }

    if (incomingTimeline.length > 0) {
      const nodesToInsert: any[] = trustedTimelineNodes.map((node) => ({ ...node, itemId: normalizedCurrentItem.id }));

      if (nodesToInsert.length > 0) {
        await db.insert(timelineNodes).values(nodesToInsert as any);

        const feedbackNodes = nodesToInsert.filter((node: any) => (node.type === 'FEEDBACK' || node.type === 'FOLLOWER_FEEDBACK') && node.content.trim().length > 0);
        if (feedbackNodes.length > 0) {
          const followers = getItemFollowers(normalizedCurrentItem);
          const owners = getItemOwners(normalizedCurrentItem);
          const pendingMessages = feedbackNodes.flatMap((node) => buildFeedbackMessages({
            itemId: normalizedCurrentItem.id,
            itemTitle: normalizedCurrentItem.title,
            feedbackContent: node.content,
            followerIds: node.type === 'FEEDBACK' ? followers.map((follower) => follower.id) : [],
            followerNames: node.type === 'FEEDBACK' ? followers.map((follower) => follower.name) : [],
            ownerIds: node.type === 'FOLLOWER_FEEDBACK' ? owners.map((owner) => owner.id) : [],
            ownerNames: node.type === 'FOLLOWER_FEEDBACK' ? owners.map((owner) => owner.name) : [],
            senderId: req.authUser?.id || null,
            senderName: req.authUser?.name || node.user,
          }));

          if (pendingMessages.length > 0) {
            const { v4: uuid } = await import('uuid');
            await db.insert(messagesTable).values(
              pendingMessages.map((message) => ({
                id: uuid(),
                title: message.title,
                content: message.content,
                type: message.type,
                timestamp: new Date(),
                link: message.link,
                receiverId: message.receiverId,
                receiverName: message.receiverName,
                senderId: message.senderId || null,
                senderName: message.senderName || null,
              })) as any,
            );
          }
        }
      }
    }

    const persistedSubTasks = Array.isArray(updates.subTasks)
      ? updates.subTasks
      : normalizedCurrentItem.subTasks;
    // 软删除和从回收站恢复是父级状态操作，不能被子任务聚合重写。
    const isRecycleTransition = normalizedCurrentItem.status === 'DELETED' || nextStatus === 'DELETED';
    if (!isRecycleTransition && (
      (Array.isArray(persistedSubTasks) && persistedSubTasks.length > 0) ||
      shouldStartPendingItem
    )) {
      updates.status = derivePersistedItemStatus({
        currentStatus: normalizedCurrentItem.status,
        requestedStatus: typeof updates.status === 'string' ? updates.status as any : undefined,
        subTasks: persistedSubTasks as any,
        ownerActivityTimelineTypes,
      });
    }

    await db
      .update(itemsTable)
      .set(updates as any)
      .where(eq(itemsTable.id, req.params.id));

    return res.json({ success: true });
    });
  } catch (error) {
    console.error('Update item error:', error);
    return res.status(500).json({ error: '更新事项失败' });
  }
});

// 旧状态写接口已停用，所有状态流转必须进入 PUT /:id 的事务、审计和副作用流程。
itemsRouter.put('/:id/status', (_req: AuthenticatedRequest & Request<{ id: string }>, res: Response) => {
  return res.status(410).json({ error: '该接口已停用，请使用统一事项更新接口' });
/*
  try {
    const db = await getDb();
    const { items: itemsTable } = await import('../db/schema');
    const { eq } = await import('drizzle-orm');

    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ error: '缺少状态值' });
    }
    const accessContext = await getCurrentAccessContext(db, req.authUser?.id);
    const [currentItem] = await db
      .select()
      .from(itemsTable)
      .where(eq(itemsTable.id, req.params.id))
      .limit(1);
    if (!currentItem) return res.status(404).json({ error: '事项不存在' });
    const normalizedCurrentItem = normalizeItemJsonFields(currentItem);
    if (filterItemsByAccess([normalizedCurrentItem as AccessItemLike], accessContext).length === 0) {
      return res.status(403).json({ error: '当前事项不在您的数据权限范围内' });
    }
    if (!ensureValidItemStatusTransition(normalizedCurrentItem, { status }, res)) return;
    const action = getActionForItemUpdate({ status }, normalizedCurrentItem.status);
    if (!ensureItemActionAllowed(accessContext, action, res, {}, getDeclaredItemPageAuth(req))) return;
    if (!ensureItemActorAllowed(accessContext, action, normalizedCurrentItem, res)) return;

    const now = new Date();
    const statusUpdates: Record<string, unknown> = { status, updatedAt: now };
    if (status === 'DELETED' && normalizedCurrentItem.status !== 'DELETED') {
      statusUpdates.originalStatus = normalizedCurrentItem.status;
      statusUpdates.deletedAt = now;
      statusUpdates.deletedById = req.authUser?.id || null;
    }
    if (status !== 'DELETED') {
      statusUpdates.originalStatus = null;
      statusUpdates.deletedAt = null;
      statusUpdates.deletedById = null;
    }

    await db
      .update(itemsTable)
      .set(statusUpdates as any)
      .where(eq(itemsTable.id, req.params.id));

    return res.json({ success: true });
  } catch (error) {
    console.error('Update item status error:', error);
    return res.status(500).json({ error: '更新事项状态失败' });
  }
*/
});

// 永久删除事项（硬删除，同时清理关联数据）
itemsRouter.delete('/:id', requireItemWritePermission, async (req: AuthenticatedRequest & Request<{ id: string }>, res: Response) => {
  try {
    const db = await getDb();
    const { items: itemsTable, auditRecords: auditTable, messages: messagesTable, timelineNodes, urgeRecords: urgeTable, lightRecords: lightTable } = await import('../db/schema');
    const { eq } = await import('drizzle-orm');
    const itemId = req.params.id;
    const accessContext = await getCurrentAccessContext(db, req.authUser?.id);
    if (!ensureItemActionAllowed(accessContext, 'DELETE_ITEM', res, {}, getDeclaredItemPageAuth(req))) return;
    return db.transaction(async (tx: any) => {
    const db = tx;
    const [currentItem] = await db
      .select()
      .from(itemsTable)
      .where(eq(itemsTable.id, itemId))
      .limit(1)
      .for('update');
    if (!currentItem) return res.status(404).json({ error: '事项不存在' });
    const normalizedCurrentItem = normalizeItemJsonFields(currentItem);
    // 硬删除只允许从回收站发起，且目标必须已完成服务端软删除。
    const includeDeletedForPermanentDelete = getDeclaredItemPageAuth(req) === 'MENU_RECYCLE_BIN';
    if (!includeDeletedForPermanentDelete || normalizedCurrentItem.status !== 'DELETED' || !normalizedCurrentItem.deletedAt) {
      return res.status(400).json({ error: '仅回收站内的已删除事项允许永久删除' });
    }
    // 数据权限隔离：普通页面不可见软删除数据；仅回收站上下文可对软删除事项执行永久删除。
    if (
      filterItemsByAccess(
        [normalizedCurrentItem as AccessItemLike],
        accessContext,
        { includeDeleted: includeDeletedForPermanentDelete },
      ).length === 0
    ) {
      return res.status(403).json({ error: '当前事项不在您的数据权限范围内' });
    }
    if (!ensureItemActorAllowed(accessContext, 'DELETE_ITEM', normalizedCurrentItem, res)) return;
    // 回收站内的永久删除：非管理员仅可删除本人删除的事项，避免越权处置他人删除项。
    if (getDeclaredItemPageAuth(req) === 'MENU_RECYCLE_BIN') {
      const isRecycleAdmin = accessContext.currentUser?.role === 'ADMIN' || accessContext.currentRole?.permissions?.includes('ALL');
      if (!isRecycleAdmin && normalizedCurrentItem.deletedById !== accessContext.currentUser?.id) {
        return res.status(403).json({ error: '仅可永久删除本人删除的回收站事项' });
      }
    }

    // 级联清理关联表
    await db.delete(timelineNodes).where(eq(timelineNodes.itemId, itemId));
    await db.delete(urgeTable).where(eq(urgeTable.itemId, itemId));
    await db.delete(lightTable).where(eq(lightTable.itemId, itemId));
    await db.delete(auditTable).where(eq(auditTable.itemId, itemId));
    await db.delete(messagesTable).where(eq(messagesTable.link, `/items/${itemId}`));
    await db.delete(itemsTable).where(eq(itemsTable.id, itemId));

    return res.json({ success: true });
    });
  } catch (error) {
    console.error('Delete item error:', error);
    return res.status(500).json({ error: '删除事项失败' });
  }
});
