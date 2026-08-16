import { and, desc, eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { aggregateSubTaskStatus } from '../lib/item-effective-status';
import { schema } from '../db';

type AutomationRules = {
  yellowLightDays: number;
  redLightHours: number;
  autoUrgeFrequency: number;
  autoUrgeEnabled?: boolean;
  autoRemindEnabled?: boolean;
};

type AutomationEvaluation = {
  itemUpdates: Record<string, unknown>;
  overdueOwners: Array<{ id: string; name: string }>;
  urgeOwners: Array<{ id: string; name: string }>;
  lightChanged: boolean;
  nextLightStatus: 'RED' | 'YELLOW' | null;
};

function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed as T[] : [];
    } catch {
      return [];
    }
  }
  return [];
}

function validDate(value: unknown): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value) : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function getDueDate(task: Record<string, any> | null, item: Record<string, any>): Date | null {
  return validDate(
    task?.plannedCompletionDate || task?.deadline || task?.requiredCompletionDate ||
    item.plannedCompletionDate || item.deadline || item.requiredCompletionDate,
  );
}

function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function uniqueOwners(owners: Array<{ id: string; name: string }>) {
  const seen = new Set<string>();
  return owners.filter((owner) => {
    if (!owner.id || seen.has(owner.id)) return false;
    seen.add(owner.id);
    return true;
  });
}

export function evaluateItemAutomation(
  item: Record<string, any>,
  rules: AutomationRules,
  now = new Date(),
): AutomationEvaluation {
  const today = startOfDay(now);
  const itemUpdates: Record<string, unknown> = {};
  const overdueOwners: Array<{ id: string; name: string }> = [];
  const urgeOwners: Array<{ id: string; name: string }> = [];
  const inactive = new Set(['COMPLETED', 'ARCHIVED', 'DELETED', 'DISABLED', 'SUSPENDED']);
  if (inactive.has(item.status)) {
    return { itemUpdates, overdueOwners, urgeOwners, lightChanged: false, nextLightStatus: item.lightStatus || null };
  }

  const subTasks = asArray<Record<string, any>>(item.subTasks);
  let effectiveDueDate = getDueDate(null, item);
  if (subTasks.length > 0) {
    const inactiveSubTaskStatuses = new Set(['COMPLETED', 'ARCHIVED', 'DELETED', 'DISABLED']);
    const nextSubTasks = subTasks.map((task) => {
      const dueDate = getDueDate(task, item);
      // 父事项亮灯只由仍需推进的子任务决定；已办结/归档/删除/废弃的历史日期不能长期压红父级。
      if (!inactiveSubTaskStatuses.has(String(task.status)) && dueDate && (!effectiveDueDate || dueDate < effectiveDueDate)) {
        effectiveDueDate = dueDate;
      }
      const daysUntil = dueDate ? (startOfDay(dueDate).getTime() - today.getTime()) / 86400000 : Number.POSITIVE_INFINITY;
      const owner = { id: String(task.assigneeId || ''), name: String(task.assigneeName || '') };
      if (daysUntil < 0 && ['PENDING', 'EXECUTING', 'DELAYED'].includes(task.status)) {
        overdueOwners.push(owner);
        urgeOwners.push(owner);
        return { ...task, status: 'OVERDUE' };
      }
      if (task.status === 'OVERDUE' || task.status === 'DELAYED' || (daysUntil >= 0 && daysUntil <= rules.yellowLightDays)) {
        urgeOwners.push(owner);
      }
      return task;
    });
    if (JSON.stringify(nextSubTasks) !== JSON.stringify(subTasks)) {
      itemUpdates.subTasks = nextSubTasks;
      itemUpdates.status = aggregateSubTaskStatus(nextSubTasks as any);
    }
  } else {
    const dueDate = getDueDate(null, item);
    const daysUntil = dueDate ? (startOfDay(dueDate).getTime() - today.getTime()) / 86400000 : Number.POSITIVE_INFINITY;
    const owner = { id: String(item.ownerId || asArray<string>(item.ownerIds)[0] || ''), name: String(item.ownerName || asArray<string>(item.ownerNames)[0] || '') };
    if (daysUntil < 0 && ['PENDING', 'EXECUTING', 'DELAYED'].includes(item.status)) {
      itemUpdates.status = 'OVERDUE';
      overdueOwners.push(owner);
      urgeOwners.push(owner);
    } else if (item.status === 'OVERDUE' || item.status === 'DELAYED' || (daysUntil >= 0 && daysUntil <= rules.yellowLightDays)) {
      urgeOwners.push(owner);
    }
  }

  let nextLightStatus: 'RED' | 'YELLOW' | null = null;
  if (effectiveDueDate) {
    const hoursUntil = (effectiveDueDate.getTime() - now.getTime()) / 3600000;
    if (hoursUntil < 0 || hoursUntil <= rules.redLightHours) nextLightStatus = 'RED';
    else if (hoursUntil <= rules.yellowLightDays * 24) nextLightStatus = 'YELLOW';
  }
  const currentLightStatus = item.lightStatus || null;
  const lightChanged = currentLightStatus !== nextLightStatus;
  if (lightChanged) itemUpdates.lightStatus = nextLightStatus;

  return {
    itemUpdates,
    overdueOwners: uniqueOwners(overdueOwners),
    urgeOwners: uniqueOwners(urgeOwners),
    lightChanged,
    nextLightStatus,
  };
}

export function getAutomationNotificationRecipients(
  evaluation: AutomationEvaluation,
  rules: AutomationRules,
): {
  reminderOwners: Array<{ id: string; name: string }>;
  autoUrgeOwners: Array<{ id: string; name: string }>;
} {
  return {
    // 默认发送超期提醒；仅显式关闭时停止。
    reminderOwners: rules.autoRemindEnabled === false ? [] : evaluation.overdueOwners,
    // 默认不自动催办；仅显式开启时生成。
    autoUrgeOwners: rules.autoUrgeEnabled === true ? evaluation.urgeOwners : [],
  };
}

async function shouldCreateAutoUrge(tx: any, itemId: string, receiverId: string, frequencyDays: number, now: Date) {
  const [latest] = await tx.select().from(schema.urgeRecords)
    .where(and(
      eq(schema.urgeRecords.itemId, itemId),
      eq(schema.urgeRecords.receiverId, receiverId),
      eq(schema.urgeRecords.senderId, 'system'),
    ))
    .orderBy(desc(schema.urgeRecords.timestamp), desc(schema.urgeRecords.id))
    .limit(1);
  if (!latest) return true;
  const latestTime = validDate(latest.timestamp);
  return !latestTime || now.getTime() - latestTime.getTime() >= Math.max(1, frequencyDays) * 86400000;
}

const AUTO_ENGINE_LOCK_NAME = 'duban:item-auto-engine';

function getRawDbClient(db: any) {
  const client = db?.$client || db?.session?.client;
  if (!client || typeof client.getConnection !== 'function') {
    throw new Error('数据库客户端不支持分布式锁');
  }
  return client;
}

async function withAutoEngineLock<T>(db: any, run: () => Promise<T>): Promise<T | undefined> {
  // MySQL named lock 绑定单一连接；不能用连接池上的普通 query，否则获取和释放可能落到不同连接。
  const connection = await getRawDbClient(db).getConnection();
  try {
    const [rows] = await connection.query('SELECT GET_LOCK(?, 0) AS acquired', [AUTO_ENGINE_LOCK_NAME]);
    if (Number((rows as Array<{ acquired?: number }>)[0]?.acquired || 0) !== 1) return undefined;
    try {
      return await run();
    } finally {
      await connection.query('DO RELEASE_LOCK(?)', [AUTO_ENGINE_LOCK_NAME]);
    }
  } finally {
    connection.release();
  }
}

export async function runItemAutoEngine(db: any, now = new Date()): Promise<void> {
  const [config] = await db.select().from(schema.globalRules).limit(1);
  const rules: AutomationRules = {
    yellowLightDays: config?.yellowLightDays ?? config?.lightWarningDays ?? 3,
    redLightHours: config?.redLightHours ?? 24,
    autoUrgeFrequency: config?.autoUrgeFrequency ?? config?.autoUrgeDays ?? 1,
    // 数据库默认 autoUrgeEnabled=false；仅明确开启时才创建自动催办，避免配置开关失效。
    autoUrgeEnabled: config?.autoUrgeEnabled === true,
    // 自动提醒默认启用；只有显式关闭才不发送超期提醒。
    autoRemindEnabled: config?.autoRemindEnabled !== false,
  };
  const candidates = await db.select({ id: schema.items.id }).from(schema.items);

  for (const candidate of candidates) {
    try {
      await db.transaction(async (tx: any) => {
        const [item] = await tx.select().from(schema.items)
          .where(eq(schema.items.id, candidate.id))
          .limit(1)
          .for('update');
        if (!item) return;
        const evaluation = evaluateItemAutomation(item, rules, now);
        if (Object.keys(evaluation.itemUpdates).length > 0) {
          await tx.update(schema.items).set({ ...evaluation.itemUpdates, updatedAt: now }).where(eq(schema.items.id, item.id));
        }
        if (evaluation.lightChanged) {
          await tx.insert(schema.lightRecords).values({
            id: uuid(), itemId: item.id, color: evaluation.nextLightStatus || 'GREEN',
            reason: evaluation.nextLightStatus
              ? (evaluation.nextLightStatus === 'RED' ? '系统按到期时间自动告警' : '系统按到期时间自动预警')
              : '系统按到期时间自动解除亮灯',
            triggerMode: 'AUTO', operatorName: '系统自动', createdAt: now,
          });
        }
        const notificationRecipients = getAutomationNotificationRecipients(evaluation, rules);
        for (const owner of notificationRecipients.reminderOwners) {
          if (!owner.id) continue;
          await tx.insert(schema.messages).values({
              id: uuid(), title: '超期提醒', content: `事项【${item.title}】已超过计划完成日期，请先申请延期后继续反馈。`,
              type: 'URGE', timestamp: now, link: `/items/${item.id}`,
              receiverId: owner.id, receiverName: owner.name, senderId: 'system', senderName: '系统自动',
          });
        }
        for (const owner of notificationRecipients.autoUrgeOwners) {
          if (!owner.id || !await shouldCreateAutoUrge(tx, item.id, owner.id, rules.autoUrgeFrequency, now)) continue;
          await tx.insert(schema.urgeRecords).values({
            id: uuid(), itemId: item.id, itemTitle: item.title, senderId: 'system', sender: '系统自动',
            receiverId: owner.id, receiver: owner.name || owner.id, timestamp: now,
            status: 'UNREAD', method: 'SYSTEM', content: '该任务已超期、延期或即将到期，请及时关注。',
          } as any);
        }
      });
    } catch (error) {
      console.error(`[AutoEngine] item ${candidate.id} failed:`, error);
    }
  }
}

export function startItemAutoEngine(db: any, intervalMs = Number(process.env.AUTO_ENGINE_INTERVAL_MS) || 60000) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await withAutoEngineLock(db, () => runItemAutoEngine(db));
    } catch (error) {
      console.error('[AutoEngine] execution failed:', error);
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(run, Math.max(10000, intervalMs));
  return () => clearInterval(timer);
}
