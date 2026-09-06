export interface WecomMemberRef {
  userid: string;
  /** 企业微信成员资料中的工号，需与本地登录账号一致才可关联 */
  job_number?: string;
}

export interface LocalAccountRef {
  id: string;
  username: string;
  wecomUserId?: string | null;
}

export type SyncTargetVia = 'wecom_id' | 'job_number' | 'create';

export interface SyncTargetDecision {
  targetId: string | null;
  via: SyncTargetVia;
}

// 决定某企微成员在本地库中的落点：
// 1) wecom_user_id 精确命中 → 关联更新；2) 工号唯一命中未关联登录账号 → 回填关联；
// 3) 都未命中 → 新建。
// byUsername 只应包含尚未关联 wecom_user_id 的账号（登录账号在库内唯一，
// 因此命中即唯一；调用方在回填后应把对应账号移出索引，防止其他同工号成员重复绑定）。
export function resolveSyncTarget(
  member: WecomMemberRef,
  byWecomId: ReadonlyMap<string, LocalAccountRef>,
  byUsername: ReadonlyMap<string, LocalAccountRef>,
): SyncTargetDecision {
  const byId = byWecomId.get(member.userid);
  if (byId) return { targetId: byId.id, via: 'wecom_id' };

  const jobNumber = member.job_number == null ? '' : String(member.job_number).trim();
  if (jobNumber) {
    const hit = byUsername.get(jobNumber);
    if (hit) return { targetId: hit.id, via: 'job_number' };
  }
  return { targetId: null, via: 'create' };
}
