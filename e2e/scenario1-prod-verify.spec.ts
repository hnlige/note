import { test, expect } from '@playwright/test';
import { loginViaUi } from './helpers';

/**
 * 场景一线上人工回归（需环境变量提供线上账号）：
 *   E2E_BASE_URL=http://49.233.13.110 \
 *   PROD_OWNER_USER=00008164 PROD_OWNER_PASSWORD=... \
 *   PROD_FOLLOWER_USER=00001938 PROD_FOLLOWER_PASSWORD=... \
 *   SCENARIO1_ITEM_ID=lev3p3x3i pnpm exec playwright test e2e/scenario1-prod-verify.spec.ts
 *
 * 流程：吴丽珠(跟进人)催办 → 申林(责任人)签收不弹计划日期 → 吴丽珠暂缓/重启/废弃即时生效。
 */
const OWNER = {
  username: process.env.PROD_OWNER_USER || '00008164',
  password: process.env.PROD_OWNER_PASSWORD || '123456',
};
const FOLLOWER = {
  username: process.env.PROD_FOLLOWER_USER || '00001938',
  password: process.env.PROD_FOLLOWER_PASSWORD || '123456',
};
const ITEM_ID = process.env.SCENARIO1_ITEM_ID || 'lev3p3x3i';
const ITEM_URL = `/items/${ITEM_ID}`;

async function openItem(page: import('@playwright/test').Page) {
  await page.goto(ITEM_URL);
  // 责任人视角有"签收"按钮，跟进人视角有"催办"按钮，任一出现即详情加载完成
  await expect(
    page.getByRole('button', { name: /催办|签收/ }).first(),
  ).toBeVisible({ timeout: 15000 });
}

test.describe.configure({ mode: 'serial' });

test('跟进人（吴丽珠）UI 催办责任人（申林）成功', async ({ page }) => {
  await loginViaUi(page, FOLLOWER.username, FOLLOWER.password);
  await openItem(page);

  await page.getByRole('button', { name: '催办' }).first().click();
  await expect(page.getByRole('heading', { name: '催办提醒' })).toBeVisible();
  const check = page.getByRole('checkbox', { name: /申林/ });
  if ((await check.count()) > 0 && !(await check.isChecked())) await check.check();
  await page.getByPlaceholder('请输入催办说明...').fill('线上UI回归：催办修复确认');
  await page.getByRole('button', { name: '发送催办' }).click();

  await expect(page.getByText('催办成功')).toBeVisible({ timeout: 8000 });
  await expect(page.getByText(/【催办】线上UI回归/).first()).toBeVisible({ timeout: 8000 });
});

test('责任人（申林）签收不弹计划完成日期', async ({ page }) => {
  await loginViaUi(page, OWNER.username, OWNER.password);
  await openItem(page);

  await expect(page.getByText('待签收').first()).toBeVisible();
  await page.getByRole('button', { name: '签收' }).first().click();

  // 修复后：有要求完成日期 → 直接签收成功，不出现计划完成日期输入
  await expect(page.getByText('已签收该事项')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('input[type="date"]').first()).toBeHidden();
  await expect(page.getByText('执行中').first()).toBeVisible({ timeout: 8000 });
});

test('跟进人（吴丽珠）暂缓→重启→废弃 状态即时更新（无需刷新）', async ({ page }) => {
  await loginViaUi(page, FOLLOWER.username, FOLLOWER.password);
  await openItem(page);

  await page.getByRole('button', { name: '暂缓' }).first().click();
  await page.getByPlaceholder('例如：2026/06/03').fill('2026/10/15');
  await page.getByPlaceholder('请详细说明暂缓原因...').fill('线上回归-暂缓验证');
  await page.getByRole('button', { name: '确认暂缓' }).click();
  await expect(page.getByText(/已暂缓|暂缓中/).first()).toBeVisible({ timeout: 10000 });

  await page.getByRole('button', { name: '重启' }).first().click();
  await page.getByPlaceholder('例如：2026/06/03').fill('2026/10/20');
  await page.getByRole('button', { name: /确认重启/ }).click();
  await expect(page.getByText('执行中').first()).toBeVisible({ timeout: 10000 });

  await expect(page.getByRole('heading', { name: '重启事项' })).toBeHidden({ timeout: 5000 });
  await page.getByRole('button', { name: '废弃', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: '废弃事项' })).toBeVisible({ timeout: 5000 });
  await page.getByPlaceholder(/废弃原因|请.*说明.*/).first().fill('线上回归-废弃验证');
  await page.getByRole('button', { name: /确认废弃/ }).click();
  await expect(page.getByText(/已废弃|已停用/).first()).toBeVisible({ timeout: 10000 });
});
