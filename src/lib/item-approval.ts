import type { OrgUser, SupervisionItem, User } from '../types';
import { isItemFollowerForUser } from './item-format';

export interface ItemApprovalState {
  isFinalApprover: boolean;
  pendingFollowerApproval: boolean;
  pendingFinalApproval: boolean;
  submittedToLeader: boolean;
  showApprovePanel: boolean;
}

function getFollowerSupervisorIds(item: SupervisionItem, orgUsers: readonly OrgUser[]): string[] {
  const followerIds = [item.followerId, ...(item.followerIds || [])].filter(Boolean);
  const supervisorIds = followerIds.flatMap((followerId) => {
    const follower = orgUsers.find((user) => user.id === followerId);
    const supervisorId = follower?.supervisorId;
    const supervisor = supervisorId
      ? orgUsers.find((user) => user.id === supervisorId && user.status === 'ACTIVE')
      : undefined;
    return supervisor ? [supervisor.id] : [];
  });

  if (supervisorIds.length > 0) return [...new Set(supervisorIds)];

  return orgUsers
    .filter((user) => user.status === 'ACTIVE' && (user.role === 'ADMIN' || (user as OrgUser & { permissions?: string[] }).permissions?.includes('ALL')))
    .map((user) => user.id);
}

export function getItemApprovalState(
  item: SupervisionItem,
  currentUser: Pick<User, 'id' | 'name' | 'username' | 'role'>,
  orgUsers: readonly OrgUser[],
): ItemApprovalState {
  const isFollower = isItemFollowerForUser(item, currentUser);
  const isFinalApprover = getFollowerSupervisorIds(item, orgUsers).includes(currentUser.id);
  const isAdmin = currentUser.role === 'ADMIN';
  const subTasks = item.subTasks || [];
  const hasSubTasks = subTasks.length > 0;
  const hasCurrentUserApproved = (item.timeline || []).some(
    (node) => node.type === 'APPROVE' && node.user === currentUser.name,
  );
  const pendingFollowerApproval = isFollower && !isFinalApprover && (
    hasSubTasks
      ? subTasks.some((task) => task.status === 'REVIEWING' && !task.followerApprovedBy)
      : !hasCurrentUserApproved
  );
  const pendingFinalApproval = (isFinalApprover || isAdmin) && (
    hasSubTasks
      ? subTasks.some((task) => task.status === 'REVIEWING' && Boolean(task.followerApprovedBy) && !task.finalApprovedBy)
      : !hasCurrentUserApproved
  );
  const submittedToLeader = isFollower && !isFinalApprover && hasSubTasks && subTasks.some(
    (task) => task.status === 'REVIEWING' && task.followerApprovedBy === currentUser.name && !task.finalApprovedBy,
  );

  return {
    isFinalApprover,
    pendingFollowerApproval,
    pendingFinalApproval,
    submittedToLeader,
    showApprovePanel: (isAdmin || isFollower || isFinalApprover) && (pendingFollowerApproval || pendingFinalApproval),
  };
}
