import { test, expect } from '@playwright/test';
import { loginViaUi } from './helpers';

// 临时验证：任务监控页展示服务端 async_tasks 真实记录（通讯录同步修复回归）
test('task monitor shows real async task records', async ({ page }) => {
  await loginViaUi(page, 'admin', '00000210');
  await page.goto('/system/tasks');

  // 等待任务列表渲染出服务端记录
  await expect(page.getByRole('heading', { name: '任务监控与重跑' })).toBeVisible();
  const row = page.getByRole('row', { name: /企业微信通讯录同步/ }).first();
  await expect(row).toBeVisible({ timeout: 10000 });
  // 模块列显示「组织架构」、状态为失败
  await expect(row.getByText('组织架构')).toBeVisible();
  await expect(row.getByText('失败')).toBeVisible();

  // 详情弹窗含结果信息
  await row.getByTitle('查看详情').click();
  await expect(page.getByText('结果信息')).toBeVisible();
  await expect(page.getByText('所属模块')).toBeVisible();
});
