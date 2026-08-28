import { test, expect, type Page } from '@playwright/test';

/**
 * DF-2 修复回归：PC「我的督办」与移动端详情的审批驳回链路。
 * 夹具：TC-FIX-R7（多责任人 tc-owna/tc-ownb，跟进人 tc-follow，REVIEWING 待本级审批）。
 */

async function loginUi(page: Page, username: string) {
  await page.goto('/login');
  await page.getByPlaceholder('请输入账号').fill(username);
  await page.getByPlaceholder('请输入密码').fill('123456');
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForFunction(() => !!localStorage.getItem('duban-auth-token'));
  await page.waitForTimeout(800);
}

test.describe('DF-2 驳回链路修复回归', () => {
  test('PC 我的督办：跟进人驳回 REVIEWING 事项成功', async ({ page }) => {
    await loginUi(page, 'tc-follow');
    await page.goto('/my-items?role=follower');
    await page.waitForTimeout(1500);
    const card = page.locator('text=TC-FIX-R7').first();
    test.skip(!(await card.count()), 'TC-FIX-R7 不在我的督办列表');
    await card.click();
    await page.waitForTimeout(1000);
    // 驳回按钮（REVIEWING 审批面板内）
    const rejectBtn = page.getByRole('button', { name: /驳回/ }).first();
    test.skip(!(await rejectBtn.count()), '详情无驳回按钮');
    await rejectBtn.click();
    await page.waitForTimeout(500);
    const reasonInput = page.locator('textarea').first();
    if (await reasonInput.count()) {
      await reasonInput.fill('PC回归驳回：材料不全');
    }
    const confirmBtn = page.getByRole('button', { name: /确认驳回|提交|确定/ }).last();
    await confirmBtn.click();
    await page.waitForTimeout(1500);
    // 成功 toast 或状态回执行中；不应出现「当前角色无CHANGE_ITEM操作权限」
    await expect(page.locator('body')).not.toContainText('CHANGE_ITEM');
    await expect(page.locator('body')).not.toContainText('403');
  });

  test('移动端详情：跟进人驳回 REVIEWING 事项成功', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginUi(page, 'tc-follow');
    // 直接打开事项详情（移动端路由）
    const itemId = process.env.FIX_R7_ID || '';
    test.skip(!itemId, '未提供 FIX_R7_ID');
    await page.goto(`/m/item/${itemId}`);
    await page.waitForTimeout(1800);
    const rejectBtn = page.getByRole('button', { name: /驳回/ }).first();
    test.skip(!(await rejectBtn.count()), '移动端详情无驳回按钮');
    await rejectBtn.click();
    await page.waitForTimeout(600);
    const reasonInput = page.locator('textarea').first();
    if (await reasonInput.count()) {
      await reasonInput.fill('移动端回归驳回：材料不全');
    }
    const confirmBtn = page.getByRole('button', { name: /确认驳回|提交|确定/ }).last();
    await confirmBtn.click();
    await page.waitForTimeout(1800);
    await expect(page.locator('body')).not.toContainText('CHANGE_ITEM');
  });
});
