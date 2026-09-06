#!/bin/bash
# ============================================
# 督办系统一键部署脚本
# 适用于腾讯云 CentOS/Ubuntu 服务器
# 用法: bash deploy.sh
# ============================================

set -e

echo "=========================================="
echo "  督办管理系统 - 部署脚本"
echo "=========================================="

# ─── 非敏感配置 ───
DOMAIN="${DOMAIN:-49.233.13.110}"
PROJECT_DIR="${PROJECT_DIR:-/var/www/duban}"
GIT_REPO="${GIT_REPO:-https://github.com/hnlige/note.git}"
DB_NAME="${DB_NAME:-duban}"
DB_USER="${DB_USER:-duban}"
NODE_VERSION="${NODE_VERSION:-22}"
SERVER_ENV_FILE="${SERVER_ENV_FILE:-/opt/duban/server/.env}"

# 敏感值只能由调用环境或服务器私有环境文件传入，绝不能写入仓库。
: "${MYSQL_ROOT_PASS:?请通过环境变量提供 MYSQL_ROOT_PASS}"
: "${DB_PASS:?请通过环境变量提供 DB_PASS}"
: "${AUTH_TOKEN_SECRET:?请通过环境变量提供 AUTH_TOKEN_SECRET}"
: "${SEED_DEFAULT_PASSWORD:?请通过环境变量提供 SEED_DEFAULT_PASSWORD}"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ─── 1. 系统依赖安装 ───
info ">>> 1/8 安装系统依赖..."
if command -v apt &> /dev/null; then
    sudo apt update && sudo apt install -y curl git nginx
elif command -v yum &> /dev/null; then
    sudo yum install -y curl git nginx
fi

# ─── 2. 安装 Node.js ───
info ">>> 2/8 安装 Node.js ${NODE_VERSION}..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | sudo bash -
    sudo apt install -y nodejs
fi
info "Node.js $(node -v) | npm $(npm -v)"

# ─── 3. 安装 PM2 ───
info ">>> 3/8 安装 PM2 进程管理器..."
if ! command -v pm2 &> /dev/null; then
    sudo npm install -g pm2
fi

# ─── 4. 安装 MySQL 8 ───
info ">>> 4/8 安装 MySQL 8..."
if ! command -v mysql &> /dev/null; then
    # Ubuntu
    if command -v apt &> /dev/null; then
        sudo apt install -y mysql-server
        sudo systemctl start mysql
        sudo systemctl enable mysql
    # CentOS
    elif command -v yum &> /dev/null; then
        sudo yum install -y mysql-server
        sudo systemctl start mysqld
        sudo systemctl enable mysqld
    fi
fi

# 创建数据库和用户
info ">>> 配置数据库..."
sudo mysql -u root <<SQL
ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY '${MYSQL_ROOT_PASS}';
CREATE DATABASE IF NOT EXISTS ${DB_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
DROP USER IF EXISTS '${DB_USER}'@'localhost';
CREATE USER '${DB_USER}'@'localhost' IDENTIFIED WITH mysql_native_password BY '${DB_PASS}';
GRANT ALL PRIVILEGES ON ${DB_NAME}.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
SQL

# ─── 5. 拉取代码 ───
info ">>> 5/8 拉取项目代码..."
if [ -d "$PROJECT_DIR" ]; then
    cd "$PROJECT_DIR" && git pull
else
    sudo mkdir -p "$PROJECT_DIR"
    sudo chown -R $USER:$USER "$PROJECT_DIR"
    git clone "$GIT_REPO" "$PROJECT_DIR"
fi

# ─── 6. 构建前端
info ">>> 6/8 构建前端..."
cd "$PROJECT_DIR"
npm install
npm run build

# ─── 7. 构建后端 ───
info ">>> 7/8 构建后端..."
cd "$PROJECT_DIR/server"

# 配置服务器私有运行环境。该文件不在仓库和构建产物中。
sudo install -d -m 700 "$(dirname "$SERVER_ENV_FILE")"
sudo install -m 600 /dev/null "$SERVER_ENV_FILE"
sudo tee "$SERVER_ENV_FILE" > /dev/null << EOF
DATABASE_URL=mysql://${DB_USER}:${DB_PASS}@127.0.0.1:3306/${DB_NAME}
PORT=3001
FRONTEND_URL=http://${DOMAIN}
AUTH_TOKEN_SECRET=${AUTH_TOKEN_SECRET}
NODE_ENV=production
EOF

npm install
npm run build

# 数据库表初始化
npm run db:push

# 如果是首次部署，导入种子数据
if [ ! -f ".seed_done" ]; then
    SEED_DEFAULT_PASSWORD="$SEED_DEFAULT_PASSWORD" npm run db:seed && touch .seed_done
fi

# PM2 启动后端
pm2 start ecosystem.config.js
pm2 save

# ─── 8. 配置 Nginx ───
info ">>> 8/8 配置 Nginx..."
cat > /tmp/duban.conf << NGINX
server {
    listen 80;
    server_name ${DOMAIN};

    root ${PROJECT_DIR}/dist;
    index index.html;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript image/svg+xml;
    gzip_min_length 1k;

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    location / {
        try_files \$uri \$uri/ /index.html;
        expires off;
        add_header Cache-Control "no-cache, no-store, must-revalidate" always;
        add_header Pragma "no-cache" always;
        add_header Expires "0" always;
    }

    location ~ /\. {
        deny all;
    }

    # 安全：禁止下载 sourcemap，防止前端源码还原
    location ~* \.map$ {
        deny all;
    }
}
NGINX

if [ -d "/etc/nginx/sites-enabled" ]; then
    sudo cp /tmp/duban.conf /etc/nginx/sites-available/duban.conf
    sudo ln -sf /etc/nginx/sites-available/duban.conf /etc/nginx/sites-enabled/
elif [ -d "/etc/nginx/conf.d" ]; then
    sudo cp /tmp/duban.conf /etc/nginx/conf.d/duban.conf
fi

sudo nginx -t && sudo systemctl reload nginx

# ─── 完成 ───
echo ""
echo "=========================================="
echo -e "  ${GREEN}✅ 部署完成!${NC}"
echo "=========================================="
echo ""
echo "  前端地址:   http://${DOMAIN}"
echo "  API 地址:   http://${DOMAIN}/api"
echo "  管理后台:   http://${DOMAIN}"
echo ""
echo "  种子账号密码由 SEED_DEFAULT_PASSWORD 提供，不在部署日志中回显。"
echo ""
echo "  管理命令:"
echo "    pm2 list                  # 查看进程"
echo "    pm2 logs duban-server     # 查看日志"
echo "    pm2 restart duban-server  # 重启后端"
echo "=========================================="
