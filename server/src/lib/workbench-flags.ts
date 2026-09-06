/**
 * 工作台五态指标所需的「责任人签收 / 反馈」权威标记。
 *
 * 关键背景（线上 bug 根因）：
 * 列表接口为了控制返回体积，只回传最近 5 条时间轴节点（slice(-5)）用于前端展示。
 * 但工作台「未反馈 / 待签收」此前在前端用被「截断」的时间轴重算各责任人的签收 / 反馈状态，
 * 当事项时间轴超过 5 条时，责任人的 SIGN / FEEDBACK 节点可能被截掉，
 * 导致：① 计数错误（已反馈仍被算作未反馈）；② 跨刷新不稳定（时间轴排序边界处的同秒 / 同名节点顺序不稳定，
 * 或 store 中该事项时间轴有时是列表的「截断版」、有时是详情页的「完整版」，计数随之在 1↔0 摆动）。
 *
 * 修复策略：在服务端用【完整时间轴】算好每个责任人的 signed / feedbackGiven 以及事项级 hasFeedback，
 * 随列表接口一并下发；前端工作台直接采用这些权威字段，彻底摆脱对被截断时间轴的依赖。
 */

export interface WorkbenchOwnerFlags {
  subTasks: Array<Record<string, unknown> & { signed: boolean; feedbackGiven: boolean }>;
  hasFeedback: boolean;
}

function asNodeArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
}

/**
 * 基于完整时间轴计算每个责任人的签收 / 反馈标记，以及事项级是否已有反馈。
 * @param item        已规范化（subTasks 为数组）的事项
 * @param fullTimeline 该事项的【完整】时间轴节点（未经 slice 截断）
 */
export function computeWorkbenchOwnerFlags(
  item: Record<string, unknown>,
  fullTimeline: Array<Record<string, unknown>>,
): WorkbenchOwnerFlags {
  const timeline = asNodeArray(fullTimeline);

  const signedNames = new Set<string>();
  const feedbackNames = new Set<string>();
  for (const node of timeline) {
    const type = node.type;
    const user = typeof node.user === 'string' ? node.user.trim() : '';
    if (type === 'SIGN' && user) {
      signedNames.add(user);
    } else if (type === 'FEEDBACK' && user) {
      feedbackNames.add(user);
    }
  }

  const rawSubTasks = asNodeArray(item.subTasks);
  const subTasks = rawSubTasks.map((st) => {
    const name = typeof st.assigneeName === 'string' ? (st.assigneeName as string).trim() : '';
    const status = st.status;
    const isDeleted = status === 'DELETED';
    // DELETED 子任务在前端会被过滤掉，其签收状态恒为 false（即便时间轴存在 SIGN 节点也不算），
    // 与前端 getPersonTasks 的 `st.status !== 'DELETED'` 过滤口径保持一致。
    const signedByStatus = typeof status === 'string' && status !== 'PENDING' && status !== 'DELETED';
    const signedByTimeline = Boolean(name && signedNames.has(name));
    // 正常签收以 SIGN 为准；历史数据缺少 SIGN 时，仅在已有计划完成日期的情况下
    // 兼容旧的已执行子任务。无 SIGN 且无计划日期的任务仍应显示待签收。
    const signed = isDeleted ? false : (signedByTimeline || (signedByStatus && Boolean(
      typeof st.plannedCompletionDate === 'string' && st.plannedCompletionDate.trim(),
    )));
    const feedbackGiven = name ? feedbackNames.has(name) : false;
    return { ...st, signed, feedbackGiven };
  });

  // 事项级是否已有反馈：以 lastFeedbackDate 为准，兼容时间轴中的 FEEDBACK / FOLLOWER_FEEDBACK 节点。
  const hasFeedback =
    Boolean(item.lastFeedbackDate) ||
    timeline.some((n) => n.type === 'FEEDBACK' || n.type === 'FOLLOWER_FEEDBACK');

  return { subTasks, hasFeedback };
}
