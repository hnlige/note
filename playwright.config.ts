import { defineConfig, devices } from '@playwright/test';

/**
 * E2E 冒烟测试配置。
 *
 * 前置条件：本地前后端已启动
 *   - 前端：根目录 `pnpm dev`（http://localhost:5173）
 *   - 后端：`cd server && npm run dev`（http://localhost:3001，Vite 代理 /api）
 *
 * 运行：`pnpm test:e2e`
 * 浏览器：复用本机 Chrome（channel: 'chrome'），无需 `playwright install` 下载浏览器。
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
    channel: 'chrome',
    screenshot: 'only-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: 'chrome',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
  ],
});
