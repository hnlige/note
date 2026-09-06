import { test, expect } from '@playwright/test';
import { loginViaUi, protectedApiStatus } from './helpers';

/**
 * 登录与权限冒烟用例。
 *
 * 断言基线来自 2026-08-28 本地真实 UI 采集（browser-use）+ src/App.tsx 路由守卫：
 * - 超管（admin）：全量菜单，含办结审核/亮灯管理与整个「系统管理」组；
 * - 业务账号（00000210，督办跟进人）：无办结审核/亮灯管理/系统管理组，
 *   直输无权 URL 显示「无访问权限」页。
 *
 * 账号默认取本地开发种子账号（与 docs/qa/full-chain-smoke.mjs 同源），
 * 其他环境通过环境变量覆盖：E2E_ADMIN_USER / E2E_ADMIN_PASSWORD /
 * E2E_FOLLOWER_USER / E2E_FOLLOWER_PASSWORD。
 */
const ADMIN = {
  username: process.env.E2E_ADMIN_USER || 'admin',
  password: process.env.E2E_ADMIN_PASSWORD || 'admin123',
  displayName: '黎敏',
};
const FOLLOWER = {
  username: process.env.E2E_FOLLOWER_USER || '00000210',
  password: process.env.E2E_FOLLOWER_PASSWORD || '123456',
};

test.describe('登录与路由守卫', () => {
  test('登录页渲染账号密码表单', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByPlaceholder('请输入账号')).toBeVisible();
    await expect(page.getByPlaceholder('请输入密码')).toBeVisible();
    await expect(page.getByRole('button', { name: '登录' })).toBeVisible();
  });

  test('未登录访问受保护路由跳回登录页', async ({ page }) => {
    await page.goto('/workbench');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('超级管理员冒烟', () => {
  test('登录进入工作台，全量菜单与发起督办可见，受保护接口可用', async ({ page }) => {
    await loginViaUi(page, ADMIN.username, ADMIN.password);

    const adminMenus = [
      '工作台首页',
      '我的督办',
      '事项列表',
      '办结审核',
      '回收站',
      '统一台账',
      '催办管理',
      '亮灯管理',
      '消息列表',
      '组织与账号',
      '角色与数据权限',
      '操作日志',
      '任务监控',
    ];
    for (const menu of adminMenus) {
      await expect(page.getByRole('link', { name: menu })).toBeVisible();
    }
    await expect(page.getByRole('button', { name: '发起督办' })).toBeVisible();
    await expect(protectedApiStatus(page, '/api/items?pageSize=1')).resolves.toBe(200);
  });

  test('退出登录清空登录态并回到登录页', async ({ page }) => {
    await loginViaUi(page, ADMIN.username, ADMIN.password);
    await page.getByRole('banner').getByText(ADMIN.displayName).click();
    await page.getByRole('button', { name: '退出登录' }).click();
    await expect(page).toHaveURL(/\/login/);
    expect(await page.evaluate(() => localStorage.getItem('duban-auth-token'))).toBeNull();
  });
});

test.describe('业务账号（督办跟进人）冒烟', () => {
  test('登录后菜单按权限隔离，受保护接口可用', async ({ page }) => {
    await loginViaUi(page, FOLLOWER.username, FOLLOWER.password);

    const visibleMenus = ['工作台首页', '我的督办', '事项列表', '回收站', '统一台账', '催办管理', '消息列表'];
    for (const menu of visibleMenus) {
      await expect(page.getByRole('link', { name: menu })).toBeVisible();
    }
    const hiddenMenus = ['办结审核', '亮灯管理', '组织与账号', '角色与数据权限', '操作日志', '任务监控'];
    for (const menu of hiddenMenus) {
      await expect(page.getByRole('link', { name: menu })).toHaveCount(0);
    }
    await expect(protectedApiStatus(page, '/api/items?pageSize=1')).resolves.toBe(200);
  });

  test('直输无权 URL 显示无访问权限页', async ({ page }) => {
    await loginViaUi(page, FOLLOWER.username, FOLLOWER.password);
    await page.goto('/settings/org');
    await expect(page.getByText('无访问权限')).toBeVisible();
  });
});
