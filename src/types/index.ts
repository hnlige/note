export type UserRole = 'ADMIN' | 'OWNER' | 'FOLLOWER';

export interface User {
  id: string;
  name: string;
  username?: string;
  role: UserRole;
  roleId?: string;
  roleIds?: string[];
  deptId?: string;
  orgId?: string;
  adminOrgIds?: string[];
  avatar?: string;
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

export interface Attachment {
  id: string;
  name: string;
  url: string;
  /** COS 对象键，仅服务端使用以生成短期签名下载地址。 */
  storageKey?: string;
  size: string;
  type: string;
  uploadedAt?: string;
}

export type TimelineType = 'FEEDBACK' | 'FOLLOWER_FEEDBACK' | 'URGE' | 'STATUS' | 'DELAY' | 'SUSPEND' | 'CREATE' | 'SIGN' | 'CHANGE' | 'REJECT' | 'APPLY_COMPLETE' | 'APPROVE' | 'SHARE' | 'DISABLE' | 'RESTART' | 'SATISFIED';

export interface TimelineNode {
  id: string;
  type: TimelineType;
  user: string;
  /** 操作人稳定 ID，用于签收等身份敏感动作避免同名误判。 */
  actorUserId?: string;
  content: string;
  timestamp: string;
  attachments?: Attachment[];
}

export interface ChangeRecord {
  id: string;
  user: string;
  content: string;
  timestamp: string;
  changes: { field: string; oldValue?: string; newValue?: string }[];
}

export interface SharedUser {
  userId: string;
  userName: string;
  sharedAt: string;
  sharedBy: string;
}

export interface SubTask {
  id: string;
  title: string;
  deadline: string;
  status: ItemStatus;
  assigneeId?: string;
  assigneeName?: string;
  progress?: number;
  lastFeedbackDate?: string;
  plannedCompletionDate?: string;
  requiredCompletionDate?: string;
  actualCompletionDate?: string;
  parentItemId?: string;
  /** 跟进人（督办专员）本级审批通过人姓名；空表示尚待跟进人审批 */
  followerApprovedBy?: string;
  /** 跟进人上级终审通过人姓名；空表示尚待上级终审 */
  finalApprovedBy?: string;
}

export interface SupervisionItem {
  id: string;
  serialNo: string;
  title: string;
  content: string;
  status: ItemStatus;
  /** 后端统一计算的展示状态；优先于前端对时间轴/子任务的兼容性推导。 */
  effectiveStatus?: ItemStatus;
  deadline: string;
  issuerId?: string;
  issuerName?: string;
  issuerAccount?: string;
  ownerId: string;
  ownerName: string;
  ownerIds?: string[];
  ownerNames?: string[];
  followerId: string;
  followerName: string;
  followerIds?: string[];
  followerNames?: string[];
  progress: number;
  lightStatus?: 'RED' | 'YELLOW' | 'GREEN';
  lastFeedbackDate?: string;
  category: string;
  campus: string;
  meetingSource?: string;
  meetingName?: string;
  raiseDate?: string;
  requiredCompletionDate?: string;
  plannedCompletionDate?: string;
  actualCompletionDate?: string;
  deptNames?: string[];
  timeline: TimelineNode[];
  subTasks?: SubTask[];
  rating?: number;
  evaluation?: string;
  originalStatus?: NonDeletedStatus;
  copyTo?: string[];
  /** 变更记录（留痕） */
  changeHistory?: ChangeRecord[];
  /** 共享用户列表 */
  sharedWith?: SharedUser[];
  /** 事项附件列表 */
  attachments?: Attachment[];
  /** 驳回原因 */
  rejectReason?: string;
  /** 废弃原因 */
  disableReason?: string;
  /** 暂缓后重启时填写的计划完成时间 */
  restartDate?: string;
  /** 删除时间（用于30天自动清理） */
  deletedAt?: string;
  /** 删除操作人（用于回收站找回权限） */
  deletedById?: string;
  /** 签收状态：多责任人场景下，0 人签收 NOT_SIGNED、部分签收 PARTIAL、全部签收 SIGNED（各责任人独立、互不干扰） */
  signOffStatus?: 'SIGNED' | 'NOT_SIGNED' | 'PARTIAL';
  /** 已完成签收的责任人数量 */
  signedOwnerCount?: number;
  /** 关联责任人总数 */
  totalOwnerCount?: number;
}

export interface LightRecord {
  id: string;
  itemId: string;
  color: 'RED' | 'YELLOW' | 'GREEN';
  reason: string;
  triggerMode: 'AUTO' | 'MANUAL';
  operatorName: string;
  createdAt: string;
}

export interface GlobalRules {
  yellowLightDays: number;
  redLightHours: number;
  autoUrgeFrequency: number;
  /** 是否发送超期提醒，默认开启 */
  autoRemindEnabled: boolean;
  /** 是否生成系统自动催办，默认关闭 */
  autoUrgeEnabled: boolean;
  urgeChannels: string[];
  serialRule: {
    prefix: string;
    showYear: boolean;
    sequenceLength: number;
    connector: string;
  };
  notifTemplates: {
    urge: string;
    warning: string;
    audit: string;
  };
  auditFlow: {
    enableMultiLevel: boolean;
    auditRoles: string[];
  };
}

export interface DictionaryItem {
  id: string;
  label: string;
  type: 'CATEGORY' | 'CAMPUS' | 'MEETING_SOURCE' | 'URGENCY' | 'DELAY_REASON' | 'EVAL_TAG';
}

export interface MetricCardData {
  title: string;
  value: string | number;
  trend?: string;
  trendType?: 'up' | 'down';
  icon: string;
  color: string;
}

export interface Activity {
  id: string;
  content: string;
  timestamp: string;
  type: 'FEEDBACK' | 'URGE' | 'STATUS_CHANGE' | 'SYSTEM';
}

export interface UrgeRecord {
  id: string;
  itemId: string;
  itemTitle: string;
  senderId?: string;
  sender: string;
  receiverId?: string;
  receiver: string;
  timestamp: string;
  status: 'UNREAD' | 'READ' | 'RESPONDED';
  content?: string;
  responseContent?: string;
  method: 'SYSTEM' | 'MESSAGE' | 'PHONE';
}

export interface Template {
  id: string;
  name: string;
  category: string;
  description: string;
  defaultDeadlineDays: number;
  defaultFollowerId: string;
  defaultFollowerName: string;
  status: 'DRAFT' | 'PUBLISHED' | 'INACTIVE';
  rules: {
    yellowLightDays: number;
    redLightHours: number;
  };
}

export interface DeptNode {
  id: string;
  name: string;
  parentId?: string;
  type?: string;
  sortOrder?: number;
  children?: DeptNode[];
}

export interface Message {
  id: string;
  title: string;
  content: string;
  type: 'TODO' | 'URGE' | 'NOTICE';
  timestamp: string;
  read: boolean;
  link?: string;
  receiverId?: string;
  /** 接收人名称，为空表示广播消息（所有人可见） */
  receiverName?: string;
  senderId?: string;
  /** 发送人名称 */
  senderName?: string;
}

export type DataScope = 'ALL' | 'MULTI_ORG' | 'DEPT' | 'SELF' | 'SELF_AND_DIRECT_SUBORDINATES';
export type FollowerDataScope = 'ALL' | 'MULTI_ORG' | 'DEPT' | 'SELF_AND_DIRECT_SUBORDINATES' | 'SELF';

export type AllowedAction =
  | 'READ'
  | 'SEARCH'
  | 'EXPORT'
  | 'EDIT_ITEM'
  | 'EDIT_SYSTEM'
  | 'CREATE_ITEM'
  | 'DELETE_ITEM'
  | 'SIGN_ITEM'
  | 'FEEDBACK_ITEM'
  | 'DELAY_ITEM'
  | 'URGE_ITEM'
  | 'CHANGE_ITEM'
  | 'SUSPEND_ITEM'
  | 'RESTART_ITEM'
  | 'DISABLE_ITEM'
  | 'REJECT_ITEM'
  | 'APPROVE_ITEM'
  | 'APPLY_COMPLETE_ITEM'
  | 'MARK_UNSATISFIED_ITEM'
  | 'SHARE_ITEM'
  | 'DOWNLOAD_TEMPLATE'
  | 'BATCH_IMPORT';

export type PagePermissionCode = string;
export type AllowedPageActions = Partial<Record<PagePermissionCode, AllowedAction[]>>;

export interface Role {
  id: string;
  name: string;
  authCodes: string[];
  /** 责任人维度的数据范围（默认 SELF）*/
  dataScope: DataScope;
  /** 跟进人维度的数据范围（未设置表示不按跟进人维度过滤）*/
  followerDataScope?: FollowerDataScope;
  /** 关联的组织 ID 列表（MULTI_ORG 时使用）*/
  orgIds?: string[];
  /** 责任人维度的指定人员 ID 列表 */
  ownerCustomUserIds?: string[];
  /** 跟进人维度的指定人员 ID 列表 */
  followerCustomUserIds?: string[];
  /** 旧版统一指定人员 ID 列表（兼容字段） */
  customUserIds?: string[];
  /** 允许的操作列表，空数组或 undefined 表示无编辑限制 |
   * 如 ['READ','SEARCH','EXPORT'] 表示只读 */
  allowedActions?: AllowedAction[];
  allowedPageActions?: AllowedPageActions;
}

export interface OperationLog {
  id: string;
  userId: string;
  userName: string;
  action: string;
  module: string;
  timestamp: string;
  ip: string;
}

export interface KnowledgeDoc {
  id: string;
  title: string;
  category: string;
  updateDate: string;
  size: string;
  downloads: number;
}

export interface AsyncTask {
  id: string;
  name: string;
  progress: number;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  startTime: string;
  type: 'IMPORT' | 'EXPORT';
  result?: string;
}

export interface AuditRecord {
  id: string;
  itemId: string;
  itemTitle: string;
  submitter: string;
  submitTime: string;
  content: string;
  status: 'PENDING' | 'FOLLOWER_APPROVED' | 'APPROVED' | 'REJECTED';
  reviewerName?: string;
  reviewedAt?: string;
  rating?: number;
  evaluation?: string;
}

export interface OrgUser {
  id: string;
  name: string;
  username: string;
  role: string;
  roleId?: string;
  /** 多角色 ID 列表（P1-4: 支持用户拥有多个角色） */
  roleIds?: string[];
  email: string;
  phone: string;
  status: 'ACTIVE' | 'INACTIVE';
  deptId: string;
  /** 所属组织 ID */
  orgId?: string;
  /** 直属上级用户 ID，支持跨部门/跨公司的虚线汇报关系 */
  supervisorId?: string;
  /** 用户级组织授权覆盖（如院办各组织管理员），优先于角色级 orgIds */
  adminOrgIds?: string[];
}
