import { test, expect } from '@playwright/test';
import { loginViaUi } from './helpers';

// 企微通讯录「官方推荐链路」配置项核验：
// 设置页新增 通讯录同步Secret / 同步链路 / 免登敏感信息授权 三项配置，可保存并正确回显。
test('wecom settings exposes contact chain config fields', async ({ page }) => {
  await loginViaUi(page, 'admin', '00000210');
  // 先注册响应等待再导航；dev 环境 StrictMode 会让加载 effect 跑两次（两次 GET），
  // 必须等网络空闲确保全部初始请求落地，否则迟到的 GET 会把已填字段覆盖回库内旧值。
  const configLoaded = page.waitForResponse(/\/api\/global-rules/);
  await page.goto('/settings/wecom');
  await configLoaded;
  await page.waitForLoadState('networkidle');

  await expect(page.getByRole('heading', { name: '企业微信配置' })).toBeVisible();

  // 新增控件渲染
  const contactSecretInput = page.getByPlaceholder('企业微信管理后台 → 管理工具 → 通讯录同步 的 Secret');
  await expect(contactSecretInput).toBeVisible();
  const modeSelect = page.locator('select').first();
  await expect(modeSelect).toBeVisible();
  const privateInfoToggle = page.getByText('移动端免登申请敏感信息授权');
  await expect(privateInfoToggle).toBeVisible();

  // 交互：填 Secret、切官方推荐链路、开敏感授权，保存成功
  await contactSecretInput.fill('e2e-verify-contact-secret');
  await modeSelect.selectOption('list_id');
  await page.locator('input[type="checkbox"]').first().check();
  await page.getByRole('button', { name: '保存配置' }).click();
  await expect(page.getByText('企业微信配置已保存')).toBeVisible({ timeout: 10000 });

  // 刷新后回显：链路为官方推荐、开关开启、Secret 脱敏（同样等全部加载请求落地再断言）
  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: '企业微信配置' })).toBeVisible();
  await expect(page.locator('select').first()).toHaveValue('list_id');
  await expect(page.locator('input[type="checkbox"]').first()).toBeChecked();
  await expect(contactSecretInput).toHaveValue('••••••••••••••••••••••••');

  // 留证截图
  await page.screenshot({ path: 'e2e/__screenshots__/wecom-contact-chain-settings.png', fullPage: true });

  // 还原本地配置，避免影响后续用例与本地环境
  await page.evaluate(async () => {
    const token = localStorage.getItem('duban-auth-token');
    await fetch('/api/global-rules', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ wecomContactSecret: '', wecomSyncMode: 'legacy', wecomPrivateInfoEnabled: false }),
    });
  });
});
