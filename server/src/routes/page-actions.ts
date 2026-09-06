export const PAGE_ACTION_CATALOG: ReadonlyMap<string, readonly string[]> = new Map([
  ['MENU_WORKBENCH', ['CREATE_ITEM', 'DOWNLOAD_TEMPLATE', 'BATCH_IMPORT', 'EXPORT', 'READ', 'SEARCH', 'SIGN_ITEM', 'FEEDBACK_ITEM', 'URGE_ITEM', 'DELAY_ITEM', 'APPLY_COMPLETE_ITEM', 'SHARE_ITEM', 'CHANGE_ITEM', 'SUSPEND_ITEM', 'RESTART_ITEM', 'DISABLE_ITEM', 'APPROVE_ITEM', 'REJECT_ITEM', 'MARK_UNSATISFIED_ITEM']],
  ['MENU_MY_ITEMS', ['READ', 'SEARCH', 'SIGN_ITEM', 'FEEDBACK_ITEM', 'DELAY_ITEM', 'APPLY_COMPLETE_ITEM', 'SHARE_ITEM', 'APPROVE_ITEM', 'REJECT_ITEM']],
  ['MENU_ITEMS', ['READ', 'SEARCH', 'EXPORT', 'CREATE_ITEM', 'EDIT_ITEM', 'DELETE_ITEM', 'URGE_ITEM', 'CHANGE_ITEM', 'SUSPEND_ITEM', 'RESTART_ITEM', 'DISABLE_ITEM', 'REJECT_ITEM', 'APPROVE_ITEM', 'SHARE_ITEM', 'SIGN_ITEM', 'FEEDBACK_ITEM', 'DELAY_ITEM', 'APPLY_COMPLETE_ITEM']],
  ['MENU_AUDIT', ['READ', 'SEARCH', 'APPROVE_ITEM', 'REJECT_ITEM', 'MARK_UNSATISFIED_ITEM']],
  ['MENU_ARCHIVES', ['READ', 'SEARCH', 'EXPORT']],
  ['MENU_RECYCLE_BIN', ['READ', 'SEARCH', 'DELETE_ITEM', 'RESTART_ITEM']],
  ['MENU_STATISTICS', ['READ', 'SEARCH', 'EXPORT']],
  ['MENU_MONITORING', ['READ', 'SEARCH', 'URGE_ITEM']],
  ['MENU_LIGHTS', ['READ', 'SEARCH', 'EDIT_SYSTEM']],
  ['MENU_MESSAGES', ['READ', 'SEARCH', 'FEEDBACK_ITEM', 'URGE_ITEM']],
  ['MENU_ORG', ['READ', 'SEARCH', 'EDIT_SYSTEM']],
  ['MENU_ROLES', ['READ', 'SEARCH', 'EDIT_SYSTEM']],
  ['MENU_TEMPLATES', ['READ', 'SEARCH', 'EDIT_SYSTEM']],
  ['MENU_RULES', ['READ', 'SEARCH', 'EDIT_SYSTEM']],
  ['MENU_SYSTEM', ['READ', 'SEARCH', 'EDIT_SYSTEM']],
  ['MENU_WECOM', ['READ', 'SEARCH', 'EDIT_SYSTEM']],
  ['MENU_LOGS', ['READ', 'SEARCH', 'EXPORT', 'EDIT_SYSTEM']],
  ['MENU_TASKS', ['READ', 'SEARCH', 'EDIT_SYSTEM']],
]);

type ParsedStringArray = {
  values: string[];
  valid: boolean;
};

function validateStringArray(value: unknown): ParsedStringArray {
  if (Array.isArray(value)) {
    if (!value.every((item) => typeof item === 'string' && item.length > 0)) {
      return { values: [], valid: false };
    }
    return { values: [...value] as string[], valid: true };
  }

  return { values: [], valid: false };
}

function parseStringArray(value: unknown): ParsedStringArray {
  if (value === undefined) return { values: [], valid: true };
  if (value === null) return { values: [], valid: false };
  if (Array.isArray(value)) return validateStringArray(value);
  if (typeof value !== 'string') return { values: [], valid: false };

  const trimmed = value.trim();
  if (!trimmed) return { values: [], valid: false };

  try {
    return validateStringArray(JSON.parse(trimmed));
  } catch {
    return { values: [], valid: false };
  }
}

export function asStringArray(value: unknown): string[] {
  const parsed = parseStringArray(value);
  return parsed.valid ? parsed.values : [];
}

export function parseAllowedActions(value: unknown): string[] | null {
  const parsed = parseStringArray(value);
  return parsed.valid ? parsed.values : null;
}

export function parseAllowedPageActions(value: unknown): Record<string, string[]> {
  if (value === undefined || value === null) return {};

  let parsedValue = value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return {};
    try {
      parsedValue = JSON.parse(trimmed);
    } catch {
      return {};
    }
  }

  if (typeof parsedValue !== 'object' || parsedValue === null || Array.isArray(parsedValue)) return {};

  const result: Record<string, string[]> = Object.create(null);
  Object.entries(parsedValue as Record<string, unknown>).forEach(([pageAuth, actions]) => {
    const parsedActions = parseStringArray(actions);
    const supportedActions = parsedActions.values.filter((action) => pageSupportsAction(pageAuth, action));
    if (parsedActions.valid && supportedActions.length > 0) {
      result[pageAuth] = supportedActions;
    }
  });
  return result;
}

export function pageSupportsAction(pageAuth: string, action: string): boolean {
  return Boolean(PAGE_ACTION_CATALOG.get(pageAuth)?.includes(action));
}

export function hasPageAction(
  role: { permissions?: unknown; authCodes?: unknown; allowedActions?: unknown; allowedPageActions?: unknown } | null | undefined,
  pageAuth: string,
  action: string,
): boolean {
  if (!pageSupportsAction(pageAuth, action)) return false;
  if (!role) return false;

  const permissions = [
    ...asStringArray(role?.permissions),
    ...asStringArray(role?.authCodes),
  ];
  if (permissions.includes('ALL')) return true;

  const allowedPageActions = parseAllowedPageActions(role?.allowedPageActions);
  // 页面级配置优先：角色对该页面显式配置过按钮列表时以该列表为准，不再回退全局
  // allowedActions。否则角色配置页取消某按钮后，旧全局授权仍会放行，与前端
  // canUsePageAction / isPageActionChecked 的“页面级优先”口径不一致。
  if (Array.isArray(allowedPageActions[pageAuth])) {
    return Boolean(allowedPageActions[pageAuth]?.includes(action));
  }

  const allowedActions = asStringArray(role?.allowedActions);
  return allowedActions.includes(action);
}
