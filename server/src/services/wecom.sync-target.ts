export interface WecomMemberRef {
  userid: string;
  mobile?: string;
}

export interface LocalAccountRef {
  id: string;
  wecomUserId?: string | null;
  phone?: string | null;
}

export type SyncTargetVia = 'wecom_id' | 'phone' | 'phone_conflict' | 'create';

export interface SyncTargetDecision {
  targetId: string | null;
  via: SyncTargetVia;
}

// 归一化手机号：仅保留数字，去掉中国大陆区号前缀 86，用于企微与本地库的对齐比较
export function normalizePhone(raw: unknown): string {
  if (typeof raw !== 'string' && typeof raw !== 'number') return '';
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length > 11 && digits.startsWith('86')) return digits.slice(2);
  return digits;
}

// 决定某企微成员在本地库中的落点：
// 1) wecom_user_id 精确命中 → 关联更新；2) 手机号唯一命中未关联账号 → 回填关联；
// 3) 手机号命中多个账号 → 跳过（防错绑，留给人工处理）；4) 都未命中 → 新建。
// byPhone 只应包含尚未关联 wecom_user_id 的账号，避免覆盖已有绑定。
export function resolveSyncTarget(
  member: WecomMemberRef,
  byWecomId: ReadonlyMap<string, LocalAccountRef>,
  byPhone: ReadonlyMap<string, LocalAccountRef[]>,
): SyncTargetDecision {
  const byId = byWecomId.get(member.userid);
  if (byId) return { targetId: byId.id, via: 'wecom_id' };

  const phone = normalizePhone(member.mobile);
  if (phone) {
    const hits = byPhone.get(phone);
    if (hits && hits.length === 1) return { targetId: hits[0].id, via: 'phone' };
    if (hits && hits.length > 1) return { targetId: null, via: 'phone_conflict' };
  }
  return { targetId: null, via: 'create' };
}
