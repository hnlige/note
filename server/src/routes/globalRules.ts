import { Router, Request, Response } from 'express';
import { getDb } from '../db';
import { canManageGlobalRules, canReadGlobalRules } from './module-authz';
import { requireModuleAccess } from './module-authz.middleware';
import { validateGlobalRulesPayload, validateWecomConnectionPayload, validateWecomVerifyPayload } from './validation';

export const globalRulesRouter = Router();
const requireGlobalRulesRead = requireModuleAccess(canReadGlobalRules, '当前账号无全局规则访问权限');
const requireGlobalRulesManage = requireModuleAccess(canManageGlobalRules, '当前账号无全局规则管理权限');
const SECRET_MASK = '••••••••••••••••••••••••';
const LEGACY_SECRET_MASK = '******';

function isSecretMask(value: unknown): boolean {
  return value === SECRET_MASK || value === LEGACY_SECRET_MASK;
}

function maskWecomSecret(config: Record<string, any>): Record<string, any> {
  return {
    ...config,
    wecomCorpSecret: config.wecomCorpSecret ? SECRET_MASK : '',
  };
}

export function toGlobalRulesDto(config: Record<string, any>) {
  return maskWecomSecret({
    ...config,
    yellowLightDays: config.yellowLightDays ?? config.lightWarningDays ?? 3,
    redLightHours: config.redLightHours ?? 24,
    autoUrgeFrequency: config.autoUrgeFrequency ?? config.autoUrgeDays ?? 1,
    urgeChannels: Array.isArray(config.urgeChannels) ? config.urgeChannels : ['SYSTEM'],
    serialRule: config.serialRule || { prefix: 'DB', showYear: true, sequenceLength: 3, connector: '-' },
    notifTemplates: config.notifTemplates || {},
    auditFlow: config.auditFlow || { enableMultiLevel: false, auditRoles: ['ADMIN'] },
  });
}

globalRulesRouter.get('/', requireGlobalRulesRead, async (_req: Request, res: Response) => {
  try {
    const db = await getDb();
    const { globalRules: rulesTable } = await import('../db/schema');
    const [config] = await db.select().from(rulesTable).limit(1);
    if (!config) {
      // 初始化默认配置
      await db.insert(rulesTable).values({ id: 'default' } as any);
      const [newConfig] = await db.select().from(rulesTable).limit(1);
      return res.json(toGlobalRulesDto(newConfig));
    }
    return res.json(toGlobalRulesDto(config));
  } catch (error) {
    console.error('Get global rules error:', error);
    return res.status(500).json({ error: '获取全局规则失败' });
  }
});

globalRulesRouter.put('/', requireGlobalRulesManage, async (req: Request, res: Response) => {
  const validation = validateGlobalRulesPayload(req.body);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  try {
    const db = await getDb();
    const { globalRules: rulesTable } = await import('../db/schema');
    const { eq } = await import('drizzle-orm');

    const { autoRemindEnabled, autoRemindDays, autoUrgeEnabled, autoUrgeDays,
      lightDelayDays, lightWarningDays, wecomCorpId, wecomCorpSecret, wecomAgentId,
      wecomToken, wecomEncodingAesKey, wecomCallbackUrl, wecomTemplates,
      yellowLightDays, redLightHours, autoUrgeFrequency, urgeChannels, serialRule,
      notifTemplates, auditFlow } = req.body;

    const updates: any = { updatedAt: new Date() };
    if (autoRemindEnabled !== undefined) updates.autoRemindEnabled = autoRemindEnabled;
    if (autoRemindDays !== undefined) updates.autoRemindDays = autoRemindDays;
    if (autoUrgeEnabled !== undefined) updates.autoUrgeEnabled = autoUrgeEnabled;
    if (autoUrgeDays !== undefined) updates.autoUrgeDays = autoUrgeDays;
    if (lightDelayDays !== undefined) updates.lightDelayDays = lightDelayDays;
    if (lightWarningDays !== undefined) updates.lightWarningDays = lightWarningDays;
    if (yellowLightDays !== undefined) updates.yellowLightDays = yellowLightDays;
    if (redLightHours !== undefined) updates.redLightHours = redLightHours;
    if (autoUrgeFrequency !== undefined) updates.autoUrgeFrequency = autoUrgeFrequency;
    if (urgeChannels !== undefined) updates.urgeChannels = urgeChannels;
    if (serialRule !== undefined) updates.serialRule = serialRule;
    if (notifTemplates !== undefined) updates.notifTemplates = notifTemplates;
    if (auditFlow !== undefined) updates.auditFlow = auditFlow;
    if (wecomCorpId !== undefined) updates.wecomCorpId = wecomCorpId;
    if (wecomCorpSecret !== undefined && !isSecretMask(wecomCorpSecret)) updates.wecomCorpSecret = wecomCorpSecret;
    if (wecomAgentId !== undefined) updates.wecomAgentId = wecomAgentId;
    if (wecomToken !== undefined) updates.wecomToken = wecomToken;
    if (wecomEncodingAesKey !== undefined) updates.wecomEncodingAesKey = wecomEncodingAesKey;
    if (wecomCallbackUrl !== undefined) updates.wecomCallbackUrl = wecomCallbackUrl;
    if (wecomTemplates !== undefined) updates.wecomTemplates = wecomTemplates;

    // upsert
    const [existing] = await db.select().from(rulesTable).where(eq(rulesTable.id, 'default')).limit(1);
    if (existing) {
      await db.update(rulesTable).set(updates).where(eq(rulesTable.id, 'default'));
    } else {
      await db.insert(rulesTable).values({ id: 'default', ...updates } as any);
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Update global rules error:', error);
    return res.status(500).json({ error: '更新全局规则失败' });
  }
});

globalRulesRouter.post('/wecom/test', requireGlobalRulesManage, async (req: Request, res: Response) => {
  const validation = validateWecomConnectionPayload(req.body);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  try {
    const db = await getDb();
    const { globalRules: rulesTable } = await import('../db/schema');
    const { eq } = await import('drizzle-orm');
    const [config] = await db.select().from(rulesTable).where(eq(rulesTable.id, 'default')).limit(1);
    const hasSecret = Boolean(req.body.wecomCorpSecret && !isSecretMask(req.body.wecomCorpSecret)) || Boolean(config?.wecomCorpSecret);
    if (!hasSecret) {
      return res.status(400).json({ error: '请先保存或输入应用Secret' });
    }

    return res.json({ ok: true, message: '企业微信连接参数已由后端校验，具备发起代理调用的必要配置' });
  } catch (error) {
    console.error('Test wecom connection error:', error);
    return res.status(500).json({ error: '企业微信连接测试失败' });
  }
});

globalRulesRouter.post('/wecom/verify', requireGlobalRulesManage, async (req: Request, res: Response) => {
  const validation = validateWecomVerifyPayload(req.body);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  return res.json({ ok: true, message: '回调验签参数已由后端校验，Token/AESKey/URL 格式符合企业微信接入要求' });
});
