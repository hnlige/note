module.exports = {
  apps: [{
    name: 'duban-server',
    script: 'dist/index.js',
    cwd: __dirname,
    // ── 集群模式：根据 CPU 核心数自动分配实例，最少 2 个 ──
    instances: process.env.PM2_INSTANCES || 'max',
    exec_mode: 'cluster',
    // 单个实例最大内存，超限自动重启
    max_memory_restart: '500M',
    // 环境变量
    env: {
      NODE_ENV: 'production',
      PORT: 3001,
      RATE_LIMIT_PER_MINUTE: '1200',
      DB_POOL_SIZE: '30',
    },
    // 监听文件变化自动重启（生产环境关闭）
    watch: false,
    // 优雅退出超时
    kill_timeout: 10000,
    // 重启策略
    max_restarts: 10,
    restart_delay: 1000,
    // 日志
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }]
};
