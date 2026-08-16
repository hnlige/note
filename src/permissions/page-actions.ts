import { AllowedAction } from '../types';

export interface PermissionActionNode {
  label: string;
  value: AllowedAction;
  desc: string;
}

export interface PermissionPageNode {
  label: string;
  auth: string;
  actions: PermissionActionNode[];
}

export interface PermissionMenuNode {
  label: string;
  children: PermissionPageNode[];
}

export const ACTION_OPTIONS: Record<AllowedAction, PermissionActionNode> = {
  READ: { label: '只读', value: 'READ', desc: '查看页面与详情' },
  SEARCH: { label: '检索', value: 'SEARCH', desc: '搜索/筛选数据' },
  EXPORT: { label: '全量导出', value: 'EXPORT', desc: '导出全量列表数据' },
  CREATE_ITEM: { label: '发起督办', value: 'CREATE_ITEM', desc: '发起并创建督办事项' },
  EDIT_ITEM: { label: '编辑事项', value: 'EDIT_ITEM', desc: '编辑事项基础信息' },
  DELETE_ITEM: { label: '删除事项', value: 'DELETE_ITEM', desc: '删除或移入回收站' },
  SIGN_ITEM: { label: '签收', value: 'SIGN_ITEM', desc: '责任人签收事项' },
  FEEDBACK_ITEM: { label: '反馈进展', value: 'FEEDBACK_ITEM', desc: '提交事项反馈进展' },
  DELAY_ITEM: { label: '申请延期', value: 'DELAY_ITEM', desc: '申请或处理事项延期' },
  URGE_ITEM: { label: '催办', value: 'URGE_ITEM', desc: '发送催办提醒' },
  CHANGE_ITEM: { label: '变更', value: 'CHANGE_ITEM', desc: '变更事项跟进信息' },
  SUSPEND_ITEM: { label: '暂缓', value: 'SUSPEND_ITEM', desc: '暂缓执行事项' },
  RESTART_ITEM: { label: '重启', value: 'RESTART_ITEM', desc: '恢复执行事项' },
  DISABLE_ITEM: { label: '废弃', value: 'DISABLE_ITEM', desc: '废弃督办事项' },
  REJECT_ITEM: { label: '驳回', value: 'REJECT_ITEM', desc: '驳回申请或审核' },
  APPROVE_ITEM: { label: '审核通过', value: 'APPROVE_ITEM', desc: '审核通过事项' },
  APPLY_COMPLETE_ITEM: { label: '申请完成', value: 'APPLY_COMPLETE_ITEM', desc: '提交事项完成申请' },
  MARK_UNSATISFIED_ITEM: { label: '未按要求完成', value: 'MARK_UNSATISFIED_ITEM', desc: '标记为未按要求完成' },
  SHARE_ITEM: { label: '共享', value: 'SHARE_ITEM', desc: '共享事项给相关人' },
  EDIT_SYSTEM: { label: '系统设置', value: 'EDIT_SYSTEM', desc: '新增、编辑、删除系统配置' },
  DOWNLOAD_TEMPLATE: { label: '导入模板', value: 'DOWNLOAD_TEMPLATE', desc: '下载批量导入模板' },
  BATCH_IMPORT: { label: '批量导入', value: 'BATCH_IMPORT', desc: '批量导入督办事项' },
};

const actions = (...codes: AllowedAction[]): PermissionActionNode[] =>
  codes.map((code) => ACTION_OPTIONS[code]);

export const PERMISSION_TREE: PermissionMenuNode[] = [
  {
    label: '工作台',
    children: [
      { label: '工作台首页', auth: 'MENU_WORKBENCH', actions: actions('CREATE_ITEM', 'DOWNLOAD_TEMPLATE', 'BATCH_IMPORT', 'EXPORT', 'READ', 'SEARCH', 'SIGN_ITEM', 'FEEDBACK_ITEM', 'URGE_ITEM', 'DELAY_ITEM', 'APPLY_COMPLETE_ITEM', 'SHARE_ITEM', 'CHANGE_ITEM', 'SUSPEND_ITEM', 'RESTART_ITEM', 'DISABLE_ITEM', 'APPROVE_ITEM', 'REJECT_ITEM', 'MARK_UNSATISFIED_ITEM') },
    ],
  },
  {
    label: '督办事项',
    children: [
      { label: '我的督办', auth: 'MENU_MY_ITEMS', actions: actions('READ', 'SEARCH', 'SIGN_ITEM', 'FEEDBACK_ITEM', 'DELAY_ITEM', 'APPLY_COMPLETE_ITEM', 'SHARE_ITEM', 'APPROVE_ITEM', 'REJECT_ITEM') },
      { label: '事项列表', auth: 'MENU_ITEMS', actions: actions('READ', 'SEARCH', 'EXPORT', 'CREATE_ITEM', 'EDIT_ITEM', 'DELETE_ITEM', 'URGE_ITEM', 'CHANGE_ITEM', 'SUSPEND_ITEM', 'RESTART_ITEM', 'DISABLE_ITEM', 'REJECT_ITEM', 'APPROVE_ITEM', 'SHARE_ITEM', 'SIGN_ITEM', 'FEEDBACK_ITEM', 'DELAY_ITEM', 'APPLY_COMPLETE_ITEM') },
      { label: '办结审核', auth: 'MENU_AUDIT', actions: actions('READ', 'SEARCH', 'APPROVE_ITEM', 'REJECT_ITEM', 'MARK_UNSATISFIED_ITEM') },
      { label: '督办档案', auth: 'MENU_ARCHIVES', actions: actions('READ', 'SEARCH', 'EXPORT') },
      { label: '回收站', auth: 'MENU_RECYCLE_BIN', actions: actions('READ', 'SEARCH', 'DELETE_ITEM', 'RESTART_ITEM') },
      { label: '统一台账', auth: 'MENU_STATISTICS', actions: actions('READ', 'SEARCH', 'EXPORT') },
    ],
  },
  {
    label: '跟踪催办',
    children: [
      { label: '催办管理', auth: 'MENU_MONITORING', actions: actions('READ', 'SEARCH', 'URGE_ITEM') },
      { label: '亮灯管理', auth: 'MENU_LIGHTS', actions: actions('READ', 'SEARCH', 'EDIT_SYSTEM') },
      { label: '消息列表', auth: 'MENU_MESSAGES', actions: actions('READ', 'SEARCH', 'FEEDBACK_ITEM', 'URGE_ITEM') },
    ],
  },
  {
    label: '系统管理',
    children: [
      { label: '组织与账号', auth: 'MENU_ORG', actions: actions('READ', 'SEARCH', 'EDIT_SYSTEM') },
      { label: '角色与数据权限', auth: 'MENU_ROLES', actions: actions('READ', 'SEARCH', 'EDIT_SYSTEM') },
      { label: '模板管理', auth: 'MENU_TEMPLATES', actions: actions('READ', 'SEARCH', 'EDIT_SYSTEM') },
      { label: '提醒策略', auth: 'MENU_RULES', actions: actions('READ', 'SEARCH', 'EDIT_SYSTEM') },
      { label: '系统设置', auth: 'MENU_SYSTEM', actions: actions('READ', 'SEARCH', 'EDIT_SYSTEM') },
      { label: '企业微信配置', auth: 'MENU_WECOM', actions: actions('READ', 'SEARCH', 'EDIT_SYSTEM') },
      { label: '操作日志', auth: 'MENU_LOGS', actions: actions('READ', 'SEARCH', 'EXPORT', 'EDIT_SYSTEM') },
      { label: '任务监控', auth: 'MENU_TASKS', actions: actions('READ', 'SEARCH', 'EDIT_SYSTEM') },
    ],
  },
];

export function getAllPermissionCodes(tree: readonly PermissionMenuNode[] = PERMISSION_TREE): string[] {
  return tree.flatMap((group) => group.children.map((page) => page.auth));
}

export function getAllConfigurableActionCodes(tree: readonly PermissionMenuNode[] = PERMISSION_TREE): AllowedAction[] {
  const configuredCodes = new Set(tree.flatMap((group) => group.children.flatMap((page) => page.actions.map((action) => action.value))));
  return (Object.keys(ACTION_OPTIONS) as AllowedAction[]).filter((code) => configuredCodes.has(code));
}

export function getActionLabelsByCode(actions: readonly AllowedAction[]): string[] {
  return actions.map((action) => ACTION_OPTIONS[action]?.label || action);
}

export function getPageAuthCodesSupportingAction(
  action: AllowedAction,
  tree: readonly PermissionMenuNode[] = PERMISSION_TREE,
): string[] {
  return tree
    .flatMap((group) => group.children)
    .filter((page) => page.actions.some((candidate) => candidate.value === action))
    .map((page) => page.auth);
}

export function pageSupportsAction(
  pageAuth: string,
  action: AllowedAction,
  tree: readonly PermissionMenuNode[] = PERMISSION_TREE,
): boolean {
  return tree
    .flatMap((group) => group.children)
    .some((page) => page.auth === pageAuth && page.actions.some((candidate) => candidate.value === action));
}
