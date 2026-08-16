#!/bin/sh
# Docker 容器入口点

# 启动后端（PM2 集群模式）
cd /app/server
pm2 start ecosystem.config.js

# 启动 Nginx
nginx -g 'daemon off;'
