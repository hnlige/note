export interface FollowerCandidateLike {
  id: string;
  role?: string;
  roleId?: string;
  roleIds?: string[];
}

export interface SelectedFollower {
  id: string;
  name: string;
}

export const isFollowerCandidate = (user: FollowerCandidateLike) => (
  user.roleId === 'r2' || user.roleIds?.includes('r2') || user.role === '督办专员' || user.role === 'FOLLOWER'
);

export const getInitialFollowers = (): SelectedFollower[] => [];
