import { test, expect } from '@playwright/test';
import { loginViaUi } from './helpers';

/**
 * 场景一（测试下发单督办责任人）修复验证用例。
 * 前置：本地前后端已启动；测试事项由 scripts 准备（负责人 test-sc-owner / 跟进人 test-sc-follow）。
 * 覆盖：
 *  - 问题2：跟进人在详情页对责任人发起催办成功（不再报"发起催办失败"）；
 *  - 问题3：跟进人暂缓→重启→废弃后，页面状态即时更新，无需手动刷新。
 */
const FOLLOWER = { username: 'test-sc-follow', password: '123456' };
const ITEM_URL = process.env.SCENARIO1_ITEM_URL || '/items/5919e0ad-0acc-4aa1-ad72-74eb38ce82a8';

async function openItem(page: import('@playwright/test').Page) {
  await page.goto(ITEM_URL);
  await expect(page.getByRole('heading', { name: '场景一验证C-UI操作' })).toBeVisible({ timeout: 15000 });
}

test('跟进人催办责任人成功', async ({ page }) => {
  await loginViaUi(page, FOLLOWER.username, FOLLOWER.password);
  await openItem(page);

  await page.getByRole('button', { name: '催办' }).first().click();
  await expect(page.getByRole('heading', { name: '催办提醒' })).toBeVisible();
  await page.getByRole('checkbox', { name: /场景一责任人/ }).check();
  await page.getByPlaceholder('请输入催办说明...').fill('e2e-催办验证-请尽快推进');
  await page.getByRole('button', { name: '发送催办' }).click();

  await expect(page.getByText('催办成功')).toBeVisible({ timeout: 8000 });
  // 时间轴出现催办记录
  await expect(page.getByText(/【催办】e2e-催办验证/).first()).toBeVisible({ timeout: 8000 });
});

test('跟进人暂缓→重启→废弃 状态即时更新（无需刷新）', async ({ page }) => {
  await loginViaUi(page, FOLLOWER.username, FOLLOWER.password);
  await openItem(page);

  // 暂缓
  await page.getByRole('button', { name: '暂缓' }).first().click();
  await page.getByPlaceholder('例如：2026/06/03').fill('2026/10/15');
  await page.getByPlaceholder('请详细说明暂缓原因...').fill('e2e-暂缓验证');
  await page.getByRole('button', { name: '确认暂缓' }).click();
  await expect(page.getByText(/已暂缓|暂缓中/).first()).toBeVisible({ timeout: 10000 });

  // 重启：点击后不刷新页面，状态应立即回到执行中
  await page.getByRole('button', { name: '重启' }).first().click();
  await page.getByPlaceholder('例如：2026/06/03').fill('2026/10/20');
  await page.getByRole('button', { name: /确认重启/ }).click();
  await expect(page.getByText('执行中').first()).toBeVisible({ timeout: 10000 });

  // 废弃：点击后不刷新页面，状态应立即变为已废弃
  await expect(page.getByRole('heading', { name: '重启事项' })).toBeHidden({ timeout: 5000 });
  await page.getByRole('button', { name: '废弃', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: '废弃事项' })).toBeVisible({ timeout: 5000 });
  await page.getByPlaceholder(/废弃原因|请.*说明.*/).first().fill('e2e-废弃验证');
  await page.getByRole('button', { name: /确认废弃/ }).click();
  await expect(page.getByText(/已废弃|已停用/).first()).toBeVisible({ timeout: 10000 });
});
