export interface MobileUrgeRequest {
  itemId: string;
  receiverId: string;
  content: string;
  method: 'SYSTEM';
  idempotencyKey: string;
}

/**
 * 移动端催办弹窗支持多选接收人，但 /api/urge 每次只接收一个 receiverId。
 * 在请求边界展开并去重，避免把 receiverIds 数组传成空的 receiverId。
 */
export function buildMobileUrgeRequests(
  itemId: string,
  receiverIds: string[],
  content: string,
  requestId: number = Date.now(),
): MobileUrgeRequest[] {
  return [...new Set(receiverIds.map((receiverId) => receiverId.trim()).filter(Boolean))].map((receiverId, index) => ({
    itemId,
    receiverId,
    content,
    method: 'SYSTEM' as const,
    idempotencyKey: `urge_${itemId}_${receiverId}_${requestId}_${index}`,
  }));
}
