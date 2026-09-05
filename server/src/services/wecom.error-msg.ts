/**
 * 企业微信服务端 API 错误码的中文提示，便于管理员在任务监控里直接看到可操作的处理指引。
 * 仅翻译常见高频码，未收录的码透传企微原始 errmsg。
 */
export function translateWecomError(scope: '获取企业微信部门树' | '获取企业微信成员详情' | string, errcode: number, errmsg?: string): string {
  const hintMap: Record<number, string> = {
    60011: '企微应用无通讯录访问权限：请在企业微信管理后台检查该 Secret 对应应用的通讯录权限（通讯录同步/API 权限）及成员可见范围',
    60020: '调用 IP 不在应用可信 IP 列表：请在企业微信管理后台将服务器出口 IP 加入该应用的可信 IP',
    48002: '企微接口对该应用未授权：请在管理后台开通对应接口的调用权限',
    40029: '免登 code 无效，请重新进入应用',
    42001: 'access_token 已过期，请稍后重试',
  };
  const hint = hintMap[errcode];
  const raw = `${scope}失败: [${errcode}] ${errmsg || '未知错误'}`;
  return hint ? `${raw}。${hint}` : raw;
}
