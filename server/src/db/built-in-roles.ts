export interface BuiltInRoleDefinition {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  dataScope: string;
  followerDataScope: string | null;
  allowedActions: string[];
}

export const BUILT_IN_ROLES: BuiltInRoleDefinition[] = [
  {
    id: 'r1',
    name: '超级管理员',
    description: '全集团督办系统超级管理员，拥有全部权限',
    permissions: ['ALL'],
    dataScope: 'ALL',
    followerDataScope: 'ALL',
    allowedActions: ['READ', 'SEARCH', 'EXPORT', 'EDIT_ITEM', 'EDIT_SYSTEM', 'CREATE_ITEM', 'DELETE_ITEM', 'SIGN_ITEM', 'FEEDBACK_ITEM', 'DELAY_ITEM', 'URGE_ITEM', 'CHANGE_ITEM', 'SUSPEND_ITEM', 'RESTART_ITEM', 'DISABLE_ITEM', 'REJECT_ITEM', 'APPROVE_ITEM', 'APPLY_COMPLETE_ITEM', 'MARK_UNSATISFIED_ITEM', 'SHARE_ITEM'],
  },
  {
    id: 'r2',
    name: '督办跟进人',
    description: '跟进人角色，可处理本人相关督办并查看我的督办、催办、台账与消息模块',
    permissions: ['MENU_WORKBENCH', 'MENU_MY_ITEMS', 'MENU_ITEMS', 'MENU_MONITORING', 'MENU_STATISTICS', 'MENU_MESSAGES', 'MENU_RECYCLE_BIN'],
    dataScope: 'SELF',
    followerDataScope: 'SELF',
    // 变更(CHANGE_ITEM)按管理员口径默认不授予跟进人：跟进人反馈在数据层走 FEEDBACK_ITEM 兜底，
    // 不受影响；如需恢复可在「角色及数据权限」按页面单独勾选。
    allowedActions: ['READ', 'SEARCH', 'EXPORT', 'EDIT_ITEM', 'CREATE_ITEM', 'DELETE_ITEM', 'URGE_ITEM', 'SIGN_ITEM', 'FEEDBACK_ITEM', 'SUSPEND_ITEM', 'RESTART_ITEM', 'DISABLE_ITEM', 'REJECT_ITEM', 'APPROVE_ITEM', 'APPLY_COMPLETE_ITEM', 'MARK_UNSATISFIED_ITEM', 'SHARE_ITEM'],
  },
  {
    id: 'r3',
    name: '部门管理员',
    description: '部门负责人角色，可查看本部门范围内的督办事项，并进入我的督办、催办、统计与消息模块',
    permissions: ['MENU_WORKBENCH', 'MENU_MY_ITEMS', 'MENU_ITEMS', 'MENU_MONITORING', 'MENU_STATISTICS', 'MENU_MESSAGES'],
    dataScope: 'DEPT',
    followerDataScope: 'DEPT',
    allowedActions: ['READ', 'SEARCH', 'EXPORT'],
  },
  {
    id: 'r4dtsn6m',
    name: '督办管理员',
    description: '督办业务管理员，拥有全局督办业务管理权限',
    permissions: ['ALL'],
    dataScope: 'ALL',
    followerDataScope: 'ALL',
    allowedActions: ['READ', 'SEARCH', 'EXPORT', 'EDIT_ITEM', 'EDIT_SYSTEM', 'CREATE_ITEM', 'DELETE_ITEM', 'SIGN_ITEM', 'FEEDBACK_ITEM', 'DELAY_ITEM', 'URGE_ITEM', 'CHANGE_ITEM', 'SUSPEND_ITEM', 'RESTART_ITEM', 'DISABLE_ITEM', 'REJECT_ITEM', 'APPROVE_ITEM', 'APPLY_COMPLETE_ITEM', 'MARK_UNSATISFIED_ITEM', 'SHARE_ITEM'],
  },
  {
    id: 'r5',
    name: '组织管理员',
    description: '各组织负责人角色，可查看本组织范围内的督办事项，并进入我的督办、回收站等管理模块',
    permissions: ['MENU_WORKBENCH', 'MENU_MY_ITEMS', 'MENU_ITEMS', 'MENU_MESSAGES', 'MENU_MONITORING', 'MENU_STATISTICS', 'MENU_RECYCLE_BIN'],
    dataScope: 'MULTI_ORG',
    followerDataScope: 'MULTI_ORG',
    allowedActions: ['READ', 'SEARCH', 'EXPORT', 'CREATE_ITEM', 'DELETE_ITEM', 'URGE_ITEM', 'CHANGE_ITEM', 'SUSPEND_ITEM', 'RESTART_ITEM', 'DISABLE_ITEM', 'REJECT_ITEM', 'APPROVE_ITEM', 'APPLY_COMPLETE_ITEM', 'MARK_UNSATISFIED_ITEM', 'SHARE_ITEM'],
  },
  {
    id: 'r6',
    name: '责任人',
    description: '业务经办人角色，仅处理本人负责的督办事项',
    permissions: ['MENU_WORKBENCH', 'MENU_MY_ITEMS', 'MENU_ITEMS', 'MENU_MESSAGES'],
    dataScope: 'SELF',
    followerDataScope: null,
    allowedActions: ['READ', 'SEARCH', 'SIGN_ITEM', 'FEEDBACK_ITEM', 'DELAY_ITEM', 'APPLY_COMPLETE_ITEM', 'SHARE_ITEM'],
  },
];

export const BUILT_IN_ROLE_BY_ID = Object.fromEntries(
  BUILT_IN_ROLES.map((role) => [role.id, role]),
) as Record<string, BuiltInRoleDefinition>;
