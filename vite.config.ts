import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from "vite-tsconfig-paths";
import { traeBadgePlugin } from 'vite-plugin-trae-solo-badge';

// https://vite.dev/config/
// react-dev-locator 是开发期 IDE 元素定位插件，会在每个 JSX 元素上注入
// trae-inspector-* 属性（含源码文件路径与构建机绝对路径），只允许在 serve
// 模式启用；随生产构建上线会膨胀 bundle 并向公网泄露本机路径。
export default defineConfig(({ command }) => ({
  build: {
    // 不自动清空 dist/，避免本地单次删除 200+ 文件触发 WorkBuddy 安全删除守卫（阈值 50）。
    // 旧产物清理交给部署流程的 rsync --delete（服务器端执行），本地 dist 已被 gitignore，残留无害。
    emptyOutDir: false,
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom', 'zustand'],
          'vendor-ui': ['framer-motion', 'lucide-react', 'clsx', 'tailwind-merge'],
          'vendor-charts': ['recharts'],
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  plugins: [
    react({
      babel: {
        plugins: command === 'serve' ? [
          'react-dev-locator',
        ] : [],
      },
    }),
    tsconfigPaths()
  ],
}))
