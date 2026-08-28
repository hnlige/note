import { expect, type Page } from '@playwright/test';

/**
 * 走真实 UI 登录流程，并等待登录态建立：
 * 1. localStorage 写入 duban-auth-token（JWT，非 cookie，见 scripts/prod-login-check.mjs 说明）；
 * 2. 离开 /login（登录页会按角色权限跳转到第一个可访问页面）；
 * 3. 应用外壳（侧边栏）渲染完成。
 */
export async function loginViaUi(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByPlaceholder('请输入账号').fill(username);
  await page.getByPlaceholder('请输入密码').fill(password);
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForFunction(() => {
    try {
      return !!localStorage.getItem('duban-auth-token');
    } catch {
      return false;
    }
  });
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByRole('link', { name: '工作台首页' })).toBeVisible();
}

/** 用页面内已登录 token 调受保护接口，返回 HTTP 状态码 */
export async function protectedApiStatus(page: Page, path: string): Promise<number> {
  return page.evaluate(async (p) => {
    const token = localStorage.getItem('duban-auth-token');
    const res = await fetch(p, { headers: { Authorization: `Bearer ${token}` } });
    return res.status;
  }, path);
}
