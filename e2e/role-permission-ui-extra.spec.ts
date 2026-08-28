import { test, expect, type Page } from '@playwright/test';

/**
 * 补充 UI 抽样：PC 工作台批量按钮、r3 移动端 Tab、移动端反馈 Modal 无进度输入。
 */

async function loginUi(page: Page, username: string) {
  await page.goto('/login');
  await page.getByPlaceholder('请输入账号').fill(username);
  await page.getByPlaceholder('请输入密码').fill('123456');
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForFunction(() => !!localStorage.getItem('duban-auth-token'));
  await page.waitForTimeout(800);
}

test('SUP-04/05 PC 工作台管理视图按钮渲染', async ({ page }) => {
  await loginUi(page, 'tc-sa');
  await page.goto('/workbench');
  await page.waitForTimeout(1500);
  await expect(page.getByText('发起督办').first()).toBeVisible();
  await expect(page.getByText('批量导入').first()).toBeVisible();
});

test('DE-10 部门管理员移动端 Tab（OWNER 映射：无督办Tab）', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginUi(page, 'tc-dept');
  await page.goto('/m/home');
  await page.waitForTimeout(1500);
  await expect(page.getByText('督办', { exact: true })).toHaveCount(0);
  await page.goto('/m/supervision');
  await expect(page.locator('body')).toContainText('当前账号无权限查看该页面');
});

test('OW-15 移动端反馈 Modal 无进度输入（tc-ownb）', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginUi(page, 'tc-ownb');
  await page.goto('/m/todo');
  await page.waitForTimeout(1800);
  const card = page.locator('text=TC签收过去日期').first();
  test.skip(!(await card.count()), 'TC-SUP16 卡片不在待办列表（状态筛选或数据变化）');
  await card.click();
  await page.waitForTimeout(1500);
  const feedbackBtn = page.getByRole('button', { name: /反馈进度/ }).first();
  test.skip(!(await feedbackBtn.count()), '详情无反馈按钮（状态非 EXECUTING/DELAYED）');
  await feedbackBtn.click();
  await page.waitForTimeout(800);
  await expect(page.locator('input[type="number"]')).toHaveCount(0);
});
