# ============================================
# 督办管理系统 - Docker 多阶段构建
# ============================================

# ─── 阶段1: 构建后端 ───
FROM node:22-alpine AS backend-builder
WORKDIR /app

COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --registry=https://registry.npmjs.org

COPY server/ ./server/
RUN cd server && npm run build

# ─── 阶段3: 运行镜像 ───
FROM node:22-alpine
WORKDIR /app

# 安装 Nginx 和 PM2（进程管理）
RUN sed -i 's#https://dl-cdn.alpinelinux.org/alpine#https://mirrors.aliyun.com/alpine#g' /etc/apk/repositories \
    && apk add --no-cache nginx \
    && npm install -g pm2

# 复制前端构建产物
COPY dist ./dist

# 复制后端构建产物
COPY --from=backend-builder /app/server/dist ./server/dist
COPY --from=backend-builder /app/server/node_modules ./server/node_modules
COPY --from=backend-builder /app/server/package.json ./server/
COPY --from=backend-builder /app/server/ecosystem.config.js ./server/
COPY --from=backend-builder /app/server/drizzle ./server/drizzle

# Nginx 配置
COPY deploy/nginx.conf /etc/nginx/nginx.conf

# 启动脚本
COPY deploy/docker-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 80

ENTRYPOINT ["/entrypoint.sh"]
