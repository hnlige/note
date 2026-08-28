import { test, expect, type Page } from '@playwright/test';

/**
 * 角色权限 UI 抽样验证（配合 docs/角色权限业务测试用例_PC与移动端_2026-08-28.md）
 * 前置：本地前后端已启动；tc-* 测试账号已建（密码 123456）。
 * 运行：npx playwright test e2e/role-permission-ui.spec.ts
 */

async function loginUi(page: Page, username: string) {
  await page.goto('/login');
  await page.getByPlaceholder('请输入账号').fill(username);
  await page.getByPlaceholder('请输入密码').fill('123456');
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForFunction(() => !!localStorage.getItem('duban-auth-token'));
  await page.waitForTimeout(800);
}

const DENY_TEXT = '当前账号无权限查看该页面';

test.describe('PC 角色菜单与路由守卫', () => {
  test('SA-01 超管全菜单可达', async ({ page }) => {
    await loginUi(page, 'tc-sa');
    await page.goto('/workbench');
    await expect(page.getByRole('link', { name: '工作台首页' })).toBeVisible();
    await expect(page.getByRole('link', { name: '组织与账号' })).toBeVisible();
    await page.goto('/monitoring/lights');
    await expect(page.locator('body')).not.toContainText(DENY_TEXT);
    await page.goto('/items/audit');
    await expect(page.locator('body')).not.toContainText(DENY_TEXT);
    await page.goto('/admin/reassign');
    await expect(page.locator('body')).not.toContainText(DENY_TEXT);
  });

  test('FO-01/02 跟进人菜单与受限路由', async ({ page }) => {
    await loginUi(page, 'tc-follow');
    await page.goto('/workbench');
    await expect(page.getByRole('link', { name: '回收站' })).toBeVisible();
    await expect(page.getByRole('link', { name: '催办管理' })).toBeVisible();
    await expect(page.getByRole('link', { name: '组织与账号' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: '办结审核' })).toHaveCount(0);
    await page.goto('/settings/roles');
    await expect(page.locator('body')).toContainText(DENY_TEXT);
    await page.goto('/monitoring/lights');
    await expect(page.locator('body')).toContainText(DENY_TEXT);
  });

  test('OW-01/02 责任人菜单与受限路由', async ({ page }) => {
    await loginUi(page, 'tc-owna');
    await page.goto('/workbench');
    await expect(page.getByRole('link', { name: '催办管理' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: '回收站' })).toHaveCount(0);
    await page.goto('/monitoring');
    await expect(page.locator('body')).toContainText(DENY_TEXT);
    await page.goto('/statistics');
    await expect(page.locator('body')).toContainText(DENY_TEXT);
  });

  test('DE-05 部门管理员：统计/催办菜单可见但页面拒绝（疑点复现）', async ({ page }) => {
    await loginUi(page, 'tc-dept');
    await page.goto('/workbench');
    await expect(page.getByRole('link', { name: '统一台账' })).toBeVisible();
    await expect(page.getByRole('link', { name: '催办管理' })).toBeVisible();
    await page.goto('/statistics');
    await expect(page.locator('body')).toContainText(DENY_TEXT);
    await page.goto('/monitoring');
    await expect(page.locator('body')).toContainText(DENY_TEXT);
  });

  test('OW-13 工作台纯责任人口径', async ({ page }) => {
    await loginUi(page, 'tc-owna');
    await page.goto('/workbench');
    await expect(page.getByText('我的待办任务')).toBeVisible();
  });

  test('SEC-01 未登录跳转登录页', async ({ page }) => {
    await page.goto('/workbench');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('移动端', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('OW-18 纯责任人：无督办Tab，直输/m/supervision拒绝', async ({ page }) => {
    await loginUi(page, 'tc-owna');
    await page.goto('/m/home');
    await page.waitForTimeout(1200);
    await expect(page.getByText('待办', { exact: true }).first()).toBeVisible();
    await page.goto('/m/supervision');
    await expect(page.locator('body')).toContainText(DENY_TEXT);
  });

  test('FO-17 跟进人：督办Tab可见', async ({ page }) => {
    await loginUi(page, 'tc-follow');
    await page.goto('/m/home');
    await page.waitForTimeout(1200);
    await expect(page.getByText('督办', { exact: true }).first()).toBeVisible();
    await page.goto('/m/supervision');
    await expect(page.locator('body')).not.toContainText(DENY_TEXT);
  });

  test('SA-15 管理员移动端：无最近动态模块', async ({ page }) => {
    await loginUi(page, 'tc-sa');
    await page.goto('/m/home');
    await page.waitForTimeout(1200);
    await expect(page.getByText('最近动态')).toHaveCount(0);
  });
});
