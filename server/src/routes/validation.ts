const TEMPLATE_STATUSES = new Set(['DRAFT', 'PUBLISHED', 'INACTIVE']);
const DICTIONARY_TYPES = new Set(['CATEGORY', 'CAMPUS', 'MEETING_SOURCE', 'URGENCY', 'DELAY_REASON', 'EVAL_TAG']);

type ValidationResult = {
  valid: boolean;
  error?: string;
};

function ok(): ValidationResult {
  return { valid: true };
}

function fail(error: string): ValidationResult {
  return { valid: false, error };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateStringField(
  payload: Record<string, unknown>,
  field: string,
  label: string,
  options: { required?: boolean; max: number },
): ValidationResult {
  const value = payload[field];
  if (value === undefined || value === null) {
    return options.required ? fail(`${label}不能为空`) : ok();
  }
  if (typeof value !== 'string') return fail(`${label}必须为文本`);
  const trimmed = value.trim();
  if (options.required && trimmed.length === 0) return fail(`${label}不能为空`);
  if (trimmed.length > options.max) return fail(`${label}不能超过${options.max}个字符`);
  return ok();
}

function firstInvalid(validations: ValidationResult[]): ValidationResult {
  return validations.find((result) => !result.valid) || ok();
}

export function validatePasswordChangeInput(payload: unknown): ValidationResult {
  if (!isPlainObject(payload)) return fail('请求体格式错误');
  const oldPassword = payload.oldPassword;
  const newPassword = payload.newPassword;

  if (typeof oldPassword !== 'string' || oldPassword.length === 0) return fail('请输入当前密码');
  if (typeof newPassword !== 'string' || newPassword.length < 6) return fail('新密码长度不能少于6位');
  if (newPassword.length > 72) return fail('新密码不能超过72个字符');
  if (oldPassword === newPassword) return fail('新密码不能与当前密码相同');
  return ok();
}

export function validateCreateItemPayload(payload: unknown): ValidationResult {
  if (!isPlainObject(payload)) return fail('请求体格式错误');
  const result = firstInvalid([
    validateStringField(payload, 'serialNo', '督办序号', { required: true, max: 50 }),
    validateStringField(payload, 'title', '事项标题', { required: true, max: 200 }),
    validateStringField(payload, 'content', '事项内容', { max: 10000 }),
  ]);
  if (!result.valid) return result;

  const ownerIds = Array.isArray(payload.ownerIds) ? payload.ownerIds.filter((value) => typeof value === 'string' && value.trim()) : [];
  const ownerId = typeof payload.ownerId === 'string' ? payload.ownerId.trim() : '';
  if (ownerIds.length === 0 && !ownerId) return fail('责任人不能为空');
  for (const field of ['deadline', 'raiseDate', 'requiredCompletionDate', 'plannedCompletionDate', 'actualCompletionDate']) {
    const value = payload[field];
    if (value === undefined || value === null || value === '') continue;
    if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) return fail(`${field}日期格式不合法`);
  }
  return ok();
}

export function validateTemplatePayload(payload: unknown, mode: 'create' | 'update'): ValidationResult {
  if (!isPlainObject(payload)) return fail('请求体格式错误');

  const result = firstInvalid([
    validateStringField(payload, 'name', '模板名称', { required: mode === 'create', max: 100 }),
    validateStringField(payload, 'category', '模板分类', { max: 50 }),
    validateStringField(payload, 'content', '模板内容', { max: 5000 }),
    validateStringField(payload, 'description', '模板说明', { max: 2000 }),
  ]);
  if (!result.valid) return result;

  if (payload.status !== undefined && (typeof payload.status !== 'string' || !TEMPLATE_STATUSES.has(payload.status))) {
    return fail('模板状态不合法');
  }
  if (payload.defaultDeadlineDays !== undefined && (!Number.isInteger(payload.defaultDeadlineDays) || (payload.defaultDeadlineDays as number) < 0 || (payload.defaultDeadlineDays as number) > 3650)) {
    return fail('默认办理天数必须为0到3650之间的整数');
  }
  if (payload.rules !== undefined && !isPlainObject(payload.rules)) return fail('模板规则格式错误');
  return ok();
}

export function validateDictionaryPayload(payload: unknown, mode: 'create' | 'update'): ValidationResult {
  if (!isPlainObject(payload)) return fail('请求体格式错误');

  const result = firstInvalid([
    validateStringField(payload, 'type', '字典类型', { required: mode === 'create', max: 50 }),
    validateStringField(payload, 'label', '字典名称', { required: mode === 'create', max: 100 }),
    validateStringField(payload, 'value', '字典值', { required: mode === 'create', max: 100 }),
  ]);
  if (!result.valid) return result;

  if (payload.type !== undefined && (typeof payload.type !== 'string' || !DICTIONARY_TYPES.has(payload.type))) {
    return fail('字典类型不合法');
  }
  if (payload.sortOrder !== undefined && (!Number.isInteger(payload.sortOrder) || (payload.sortOrder as number) < 0 || (payload.sortOrder as number) > 9999)) {
    return fail('排序号必须为0到9999之间的整数');
  }
  return ok();
}

export function validateGlobalRulesPayload(payload: unknown): ValidationResult {
  if (!isPlainObject(payload)) return fail('请求体格式错误');

  const numberLimits: Record<string, { label: string; min: number; max: number }> = {
    autoRemindDays: { label: '自动提醒天数', min: 0, max: 365 },
    autoUrgeDays: { label: '自动催办天数', min: 0, max: 365 },
    lightDelayDays: { label: '黄灯预警天数', min: 0, max: 365 },
    lightWarningDays: { label: '红灯预警天数', min: 0, max: 365 },
    yellowLightDays: { label: '黄灯预警天数', min: 0, max: 365 },
    redLightHours: { label: '红灯告警小时数', min: 0, max: 8760 },
    autoUrgeFrequency: { label: '自动催办频率', min: 1, max: 365 },
  };
  for (const [field, limit] of Object.entries(numberLimits)) {
    const value = payload[field];
    if (value === undefined) continue;
    if (!Number.isInteger(value) || (value as number) < limit.min || (value as number) > limit.max) {
      return fail(`${limit.label}必须为${limit.min}到${limit.max}之间的整数`);
    }
  }

  for (const field of ['autoRemindEnabled', 'autoUrgeEnabled', 'wecomPrivateInfoEnabled']) {
    if (payload[field] !== undefined && typeof payload[field] !== 'boolean') {
      return fail(`${field}必须为布尔值`);
    }
  }

  if (payload.wecomSyncMode !== undefined && payload.wecomSyncMode !== 'legacy' && payload.wecomSyncMode !== 'list_id') {
    return fail('企业微信同步模式必须为 legacy 或 list_id');
  }

  const result = firstInvalid([
    validateStringField(payload, 'wecomCorpId', '企业ID', { max: 100 }),
    validateStringField(payload, 'wecomCorpSecret', '应用Secret', { max: 512 }),
    validateStringField(payload, 'wecomContactSecret', '通讯录同步Secret', { max: 512 }),
    validateStringField(payload, 'wecomAgentId', '应用AgentId', { max: 50 }),
    validateStringField(payload, 'wecomToken', '回调Token', { max: 100 }),
    validateStringField(payload, 'wecomEncodingAesKey', 'EncodingAESKey', { max: 100 }),
    validateStringField(payload, 'wecomCallbackUrl', '回调URL', { max: 300 }),
  ]);
  if (!result.valid) return result;

  if (payload.urgeChannels !== undefined && (!Array.isArray(payload.urgeChannels) || payload.urgeChannels.some((value) => typeof value !== 'string'))) {
    return fail('催办渠道必须为字符串数组');
  }
  for (const field of ['serialRule', 'notifTemplates', 'auditFlow']) {
    if (payload[field] !== undefined && !isPlainObject(payload[field])) return fail(`${field}格式错误`);
  }

  if (typeof payload.wecomCallbackUrl === 'string' && payload.wecomCallbackUrl && !/^https?:\/\//i.test(payload.wecomCallbackUrl)) {
    return fail('回调URL必须以 http:// 或 https:// 开头');
  }
  return ok();
}

export function validateWecomConnectionPayload(payload: unknown): ValidationResult {
  if (!isPlainObject(payload)) return fail('请求体格式错误');
  return firstInvalid([
    validateStringField(payload, 'wecomCorpId', '企业ID', { required: true, max: 100 }),
    validateStringField(payload, 'wecomAgentId', '应用AgentId', { required: true, max: 50 }),
  ]);
}

export function validateWecomVerifyPayload(payload: unknown): ValidationResult {
  if (!isPlainObject(payload)) return fail('请求体格式错误');
  const result = firstInvalid([
    validateStringField(payload, 'wecomToken', '回调Token', { required: true, max: 100 }),
    validateStringField(payload, 'wecomEncodingAesKey', 'EncodingAESKey', { required: true, max: 100 }),
    validateStringField(payload, 'wecomCallbackUrl', '回调URL', { required: true, max: 300 }),
  ]);
  if (!result.valid) return result;
  if (typeof payload.wecomEncodingAesKey === 'string' && payload.wecomEncodingAesKey.length !== 43) {
    return fail('EncodingAESKey必须为43个字符');
  }
  if (typeof payload.wecomCallbackUrl === 'string' && !/^https?:\/\//i.test(payload.wecomCallbackUrl)) {
    return fail('回调URL必须以 http:// 或 https:// 开头');
  }
  return ok();
}
