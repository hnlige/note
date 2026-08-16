/**
 * 服务端领域类型（校验脚本 / 服务复用，避免跨前端包引用）。
 *
 * 仅包含督办事项校验所需的字段子集，字段多为可选以兼容 DB 行映射。
 * 业务口径与前端 `src/types/index.ts` 保持一致。
 */

export type UserRole = 'ADMIN' | 'OWNER' | 'FOLLOWER';

export interface User {
  id: string;
  name?: string;
  username?: string;
  role?: string;
  roleId?: string;
  roleIds?: string[];
  deptId?: string;
  orgId?: string;
  adminOrgIds?: string[];
  supervisorId?: string;
  status?: string;
}

export type ItemStatus =
  | 'PENDING'
  | 'EXECUTING'
  | 'OVERDUE'
  | 'DELAYED'
  | 'SUSPENDED'
  | 'COMPLETED'
  | 'ARCHIVED'
  | 'DELETED'
  | 'DISABLED'
  | 'NOT_SATISFIED'
  | 'REVIEWING';

export type NonDeletedStatus = Exclude<ItemStatus, 'DELETED'>;

export interface SubTask {
  id?: string;
  title?: string;
  deadline?: string;
  status?: ItemStatus;
  assigneeId?: string;
  assigneeName?: string;
  progress?: number;
  lastFeedbackDate?: string;
  plannedCompletionDate?: string;
  requiredCompletionDate?: string;
  parentItemId?: string;
}

export interface TimelineNode {
  id?: string;
  type?: string;
  user?: string;
  content?: string;
  timestamp?: string;
  attachments?: unknown[];
}

export interface SharedUser {
  userId?: string;
  userName?: string;
  sharedAt?: string;
  sharedBy?: string;
  [key: string]: unknown;
}

export interface Attachment {
  id?: string;
  name?: string;
  url?: string;
  size?: string;
  type?: string;
  uploadedAt?: string;
}

export interface SupervisionItem {
  id: string;
  serialNo?: string;
  title?: string;
  content?: string;
  status: ItemStatus;
  deadline?: string;
  issuerId?: string;
  issuerName?: string;
  issuerAccount?: string;
  ownerId?: string;
  ownerName?: string;
  ownerIds?: string[];
  ownerNames?: string[];
  followerId?: string;
  followerName?: string;
  followerIds?: string[];
  followerNames?: string[];
  progress?: number;
  lightStatus?: string;
  lastFeedbackDate?: string;
  category?: string;
  campus?: string;
  meetingSource?: string;
  raiseDate?: string;
  requiredCompletionDate?: string;
  plannedCompletionDate?: string;
  actualCompletionDate?: string;
  deptNames?: string[];
  subTasks?: SubTask[];
  sharedWith?: SharedUser[];
  attachments?: Attachment[];
  deletedAt?: string;
  deletedById?: string;
  // 列表接口附加的计算字段
  effectiveStatus?: ItemStatus;
  timeline?: TimelineNode[];
  signOffStatus?: 'SIGNED' | 'NOT_SIGNED' | 'PARTIAL';
  signedOwnerCount?: number;
  totalOwnerCount?: number;
}

export interface DeptNode {
  id: string;
  name?: string;
  parentId?: string;
  type?: string;
  sortOrder?: number;
  children?: DeptNode[];
}

export type DataScope = 'ALL' | 'MULTI_ORG' | 'DEPT' | 'SELF' | 'SELF_AND_DIRECT_SUBORDINATES';
export type FollowerDataScope = 'ALL' | 'MULTI_ORG' | 'DEPT' | 'SELF_AND_DIRECT_SUBORDINATES' | 'SELF';

export interface OrgUser {
  id: string;
  name?: string;
  username?: string;
  role?: string;
  roleId?: string;
  roleIds?: string[];
  deptId?: string;
  orgId?: string;
  supervisorId?: string;
  status?: string;
  adminOrgIds?: string[];
}

export interface Role {
  id: string;
  name?: string;
  description?: string;
  /** 菜单权限编码（authCodes） */
  permissions?: string[];
  authCodes?: string[];
  dataScope?: DataScope;
  followerDataScope?: FollowerDataScope | null;
  allowedActions?: string[];
  allowedPageActions?: Record<string, string[]>;
  orgIds?: string[];
  ownerCustomUserIds?: string[];
  followerCustomUserIds?: string[];
  customUserIds?: string[];
}
