import { DataScope, DeptNode, OrgUser, SupervisionItem } from '../../types';

export type DepartmentFilterOption = {
  value: string;
  label: string;
  deptId: string;
  deptName: string;
};

export type DepartmentFilterLookup = {
  options: DepartmentFilterOption[];
  pathIdsByDeptId: Record<string, string[]>;
  deptNameById: Record<string, string>;
  ownerDeptIdByUserId: Record<string, string>;
};

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

export function buildDepartmentFilterLookup(departments: DeptNode[], orgUsers: OrgUser[]): DepartmentFilterLookup {
  const options: DepartmentFilterOption[] = [];
  const pathIdsByDeptId: Record<string, string[]> = {};
  const deptNameById: Record<string, string> = {};

  const walk = (nodes: DeptNode[], path: DeptNode[] = []) => {
    nodes.forEach((node) => {
      const nextPath = [...path, node];
      pathIdsByDeptId[node.id] = nextPath.map((entry) => entry.id);
      deptNameById[node.id] = node.name;

      if (!(path.length === 0 && node.type === 'GROUP')) {
        options.push({
          value: node.id,
          deptId: node.id,
          deptName: node.name,
          label: nextPath.map((entry) => entry.name).join(' / '),
        });
      }

      if (node.children?.length) {
        walk(node.children, nextPath);
      }
    });
  };

  walk(departments);

  const ownerDeptIdByUserId = Object.fromEntries(
    orgUsers
      .filter((user) => typeof user.deptId === 'string' && user.deptId.length > 0)
      .map((user) => [user.id, user.deptId as string]),
  );

  return {
    options,
    pathIdsByDeptId,
    deptNameById,
    ownerDeptIdByUserId,
  };
}

export function filterDepartmentOptions(options: DepartmentFilterOption[], keyword: string): DepartmentFilterOption[] {
  const query = keyword.trim().toLowerCase();
  if (!query) return options;

  return options.filter((option) => {
    const label = option.label.toLowerCase();
    const deptName = option.deptName.toLowerCase();
    return label.includes(query) || deptName.includes(query);
  });
}

/**
 * 找到部门节点最近的 `type=COMPANY` 祖先（即其所属组织）的 id。
 * 与 `useStore.findOrgIdByDeptId` 口径一致：orgId 只认 COMPANY 祖先。
 */
function nearestCompanyOrgId(nodes: DeptNode[], targetId: string, currentOrg?: string): string | undefined {
  for (const node of nodes) {
    const nextOrg = node.type === 'COMPANY' ? node.id : currentOrg;
    if (node.id === targetId) return nextOrg;
    if (node.children) {
      const found = nearestCompanyOrgId(node.children, targetId, nextOrg);
      if (found) return found;
    }
  }
  return undefined;
}

/** 收集某部门节点及其全部子孙部门的 id 集合。 */
function collectDeptSubtreeIds(nodes: DeptNode[], deptId: string, acc: Set<string> = new Set()): Set<string> {
  const walk = (list: DeptNode[]): boolean => {
    for (const node of list) {
      if (node.id === deptId || acc.has(node.id)) {
        acc.add(node.id);
        node.children?.forEach((child) => {
          acc.add(child.id);
          walk([child]);
        });
        return true;
      }
      if (node.children && walk(node.children)) return true;
    }
    return false;
  };
  walk(nodes);
  return acc;
}

/**
 * 按角色数据范围裁剪「责任部门」下拉选项，使部门管理员/督办责任人/组织管理员
 * 只能筛选到自己数据权限范围内的部门，避免出现「选了却查不到」的空结果。
 *
 * - ALL：全部部门
 * - MULTI_ORG：仅授权组织（优先用户级 adminOrgIds，回退角色级 orgIds）下的部门
 * - DEPT / SELF / SELF_AND_DIRECT_SUBORDINATES：仅当前用户所在部门子树
 * 无法判定范围时（缺 deptId / 缺 orgIds）安全回退为全部，避免下拉变空。
 */
export function getScopedDepartmentOptions(params: {
  options: DepartmentFilterOption[];
  departments: DeptNode[];
  dataScope: DataScope;
  orgIds: string[];
  adminOrgIds: string[];
  userDeptId?: string;
}): DepartmentFilterOption[] {
  const { options, departments, dataScope, orgIds, adminOrgIds, userDeptId } = params;
  if (dataScope === 'ALL') return options;

  if (dataScope === 'MULTI_ORG') {
    const effectiveOrgIds = adminOrgIds.length > 0 ? adminOrgIds : orgIds;
    if (effectiveOrgIds.length === 0) return options;
    return options.filter((opt) => {
      const orgId = nearestCompanyOrgId(departments, opt.deptId);
      return orgId ? effectiveOrgIds.includes(orgId) : false;
    });
  }

  // DEPT / SELF / SELF_AND_DIRECT_SUBORDINATES：以当前用户所在部门子树为范围
  if (userDeptId) {
    const subtreeIds = collectDeptSubtreeIds(departments, userDeptId);
    if (subtreeIds.size > 0) {
      return options.filter((opt) => subtreeIds.has(opt.deptId));
    }
  }
  return options;
}

export function matchesDepartmentFilter(input: {
  item: SupervisionItem;
  departmentId: string;
  lookup: DepartmentFilterLookup;
}): boolean {
  const { item, departmentId, lookup } = input;
  if (!departmentId) return true;

  const ownerIds = unique([item.ownerId, ...(item.ownerIds || [])]);
  const ownerDeptIds = unique(ownerIds.map((ownerId) => lookup.ownerDeptIdByUserId[ownerId]));

  if (ownerDeptIds.length > 0) {
    return ownerDeptIds.some((deptId) => lookup.pathIdsByDeptId[deptId]?.includes(departmentId));
  }

  const fallbackDeptName = lookup.deptNameById[departmentId];
  return Boolean(fallbackDeptName && item.deptNames?.includes(fallbackDeptName));
}
