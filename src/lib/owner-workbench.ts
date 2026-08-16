import { SupervisionItem, User } from '../types';
import { getEffectiveStatusForUserIdentity, getUserSubTaskForIdentity, isItemOwnerForUser } from './item-format';

export type OwnerWorkbenchMetricKey =
  | 'myTodo'
  | 'myOverdue'
  | 'dueSoon'
  | 'onTimeCompleted';

export type OwnerWorkbenchMetric = {
  key: OwnerWorkbenchMetricKey;
  title: string;
  value: number;
  path: string;
  params: string;
};

type OwnerIdentity = Pick<User, 'id' | 'name' | 'username'>;

const OWNER_TODO_STATUSES = new Set(['PENDING', 'EXECUTING', 'OVERDUE', 'DELAYED', 'SUSPENDED']);

function normalizeDateOnly(value?: string | null): string | undefined {
  if (!value) return undefined;
  const raw = String(value).trim();
  if (!raw) return undefined;
  const matched = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (matched) {
    const [, year, month, day] = matched;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return undefined;
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${parsed.getFullYear()}-${month}-${day}`;
}

function addDays(dateOnly: string, days: number): string {
  const parsed = new Date(`${dateOnly}T00:00:00`);
  parsed.setDate(parsed.getDate() + days);
  return normalizeDateOnly(parsed.toISOString()) || dateOnly;
}

function getOwnerStatus(item: SupervisionItem, user: OwnerIdentity): string | undefined {
  return isItemOwnerForUser(item, user) ? getEffectiveStatusForUserIdentity(item, user) : undefined;
}

function getOwnerDueDate(item: SupervisionItem, user: OwnerIdentity): string | undefined {
  const subTask = getUserSubTaskForIdentity(item, user);
  return normalizeDateOnly(
    subTask?.plannedCompletionDate ||
    subTask?.requiredCompletionDate ||
    subTask?.deadline ||
    item.plannedCompletionDate ||
    item.requiredCompletionDate ||
    item.deadline,
  );
}

function getOwnerCompletionDate(item: SupervisionItem): string | undefined {
  const explicit = normalizeDateOnly(item.actualCompletionDate);
  if (explicit) return explicit;
  const completionNode = [...(item.timeline || [])].reverse().find((node) =>
    ['APPROVE', 'STATUS', 'SATISFIED'].includes(node.type) || /完成|结案|归档/.test(node.content || ''),
  );
  return normalizeDateOnly(completionNode?.timestamp);
}

export function isOwnerWorkbenchTodoItem(item: SupervisionItem, user: OwnerIdentity): boolean {
  const status = getOwnerStatus(item, user);
  return Boolean(status && OWNER_TODO_STATUSES.has(status));
}

export function isOwnerDueSoonItem(item: SupervisionItem, user: OwnerIdentity, today = normalizeDateOnly(new Date().toISOString()) || ''): boolean {
  const status = getOwnerStatus(item, user);
  if (!status || !['PENDING', 'EXECUTING', 'DELAYED'].includes(status)) return false;
  const dueDate = getOwnerDueDate(item, user);
  if (!dueDate) return false;
  return dueDate >= today && dueDate <= addDays(today, 3);
}

export function isOwnerOnTimeCompletedItem(item: SupervisionItem, user: OwnerIdentity): boolean {
  const status = getOwnerStatus(item, user);
  if (status !== 'COMPLETED') return false;
  const dueDate = getOwnerDueDate(item, user);
  const completionDate = getOwnerCompletionDate(item);
  if (!dueDate || !completionDate) return true;
  return completionDate <= dueDate;
}

export function buildOwnerWorkbenchTaskListItems(items: SupervisionItem[], user: OwnerIdentity, today = normalizeDateOnly(new Date().toISOString()) || ''): SupervisionItem[] {
  return items
    .filter((item) => isOwnerWorkbenchTodoItem(item, user))
    .sort((left, right) => {
      const leftStatus = getOwnerStatus(left, user);
      const rightStatus = getOwnerStatus(right, user);
      const leftPriority = leftStatus === 'OVERDUE' ? 0 : (isOwnerDueSoonItem(left, user, today) ? 1 : 2);
      const rightPriority = rightStatus === 'OVERDUE' ? 0 : (isOwnerDueSoonItem(right, user, today) ? 1 : 2);

      if (leftPriority !== rightPriority) return leftPriority - rightPriority;

      const leftDueDate = getOwnerDueDate(left, user) || '9999-12-31';
      const rightDueDate = getOwnerDueDate(right, user) || '9999-12-31';
      if (leftDueDate !== rightDueDate) return leftDueDate.localeCompare(rightDueDate);

      return left.serialNo.localeCompare(right.serialNo);
    });
}

export function buildOwnerWorkbenchMetrics(items: SupervisionItem[], user: OwnerIdentity, today = normalizeDateOnly(new Date().toISOString()) || ''): OwnerWorkbenchMetric[] {
  const ownedItems = items.filter((item) => isItemOwnerForUser(item, user));

  return [
    {
      key: 'myTodo',
      title: '我的待办',
      value: ownedItems.filter((item) => isOwnerWorkbenchTodoItem(item, user)).length,
      path: '/items',
      params: '?ownerId=me&status=PENDING,EXECUTING,OVERDUE,DELAYED',
    },
    {
      key: 'myOverdue',
      title: '我的超期',
      value: ownedItems.filter((item) => getOwnerStatus(item, user) === 'OVERDUE').length,
      path: '/items',
      params: '?ownerId=me&status=OVERDUE',
    },
    {
      key: 'dueSoon',
      title: '即将到期',
      value: ownedItems.filter((item) => isOwnerDueSoonItem(item, user, today)).length,
      path: '/items',
      params: '?ownerId=me&dueSoon=1',
    },
    {
      key: 'onTimeCompleted',
      title: '已按期完成',
      value: ownedItems.filter((item) => isOwnerOnTimeCompletedItem(item, user)).length,
      path: '/items',
      params: '?ownerId=me&onTimeCompleted=1',
    },
  ];
}
