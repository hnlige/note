module.exports = {
  apps: [{
    name: 'duban-server',
    script: 'dist/index.js',
    cwd: __dirname,
    // ── 集群模式：根据 CPU 核心数自动分配实例，最少 2 个 ──
    instances: process.env.PM2_INSTANCES || 'max',
    exec_mode: 'cluster',
    // 单个实例最大内存，超限自动重启（500 并发压测实测峰值 ~505MB/实例，768M 留余量避免峰值期重启雪崩）
    max_memory_restart: '768M',
    // 环境变量
    env: {
      NODE_ENV: 'production',
      PORT: 3001,
      RATE_LIMIT_PER_MINUTE: '1200',
      DB_POOL_SIZE: '50',        // 从 30 → 50（单实例连接数）
      DB_QUEUE_LIMIT: '100',     // 限制队列深度，防止 OOM
      // 部署指纹：由 deploy-server.sh 的 run_host_pm2 通过 shell 注入，
      // 这里显式声明后才会真正透传到 duban-server 进程环境，
      // 否则 health.runtimeId 恒为 local-runtime，导致 select_public_runtime 永远不匹配、自动角色刷新被跳过。
      DEPLOY_RUNTIME_ID: process.env.DEPLOY_RUNTIME_ID,
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
