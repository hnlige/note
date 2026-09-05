import { test, expect, type Page } from '@playwright/test';

// 免登 code 一次性消费核验：
// 企微 webview 重进/刷新会重放带 ?code= 的历史 URL，重复兑换必得 40029。
// 登录页必须：code 只提交一次、立即从地址栏清除、失败回落账号密码、刷新不重放。
test('mobile login consumes oauth code exactly once and strips it from URL', async ({ page }) => {
  const loginRequests: string[] = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('/api/wecom/login')) {
      loginRequests.push(req.url());
    }
  });

  await page.goto('/m/login?code=e2e-stale-code-once');

  // 后端兑换失败（本地为假凭证，500）→ 回落账号密码表单
  await expect(page.getByPlaceholder('请输入账号')).toBeVisible({ timeout: 15000 });

  // 只发起过一次免登兑换
  expect(loginRequests.length).toBe(1);
  // code 已从地址栏移除
  await expect(page).toHaveURL(/\/m\/login$/);

  // 刷新页面不得重放 code（不再产生新的 /api/wecom/login 请求）
  await page.reload();
  await page.waitForTimeout(1500);
  expect(loginRequests.length).toBe(1);
});
