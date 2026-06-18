#!/usr/bin/env bash
#
# 财会结算管理系统 - 一键部署脚本（通用模板）
# ==========================================
# 适用于: 容器/K8s 环境 + nginx + Python FastAPI + React/Vue SPA
#
# 用法: ./deploy.sh [BASE_PATH] [SERVER_PORT] [NGINX_PORT]
#   示例:
#     ./deploy.sh                      # 默认: /yourapp/ 9000 8080
#     ./deploy.sh /app/ 9001 8080      # 自定义路径和端口
#     ./deploy.sh / 9000 8080          # 独占根路径（无其他应用时）
#
# 端口策略:
#   ✅ 优先查找空闲端口，不主动 kill 任何已占用端口的进程
#   ✅ 如果指定端口被占用，从该端口+1 开始自动递增扫描，找到第一个可用端口
#   ✅ 清理旧进程仅通过进程名匹配（本应用自身），跨应用互不干扰
#
# 模板占位符（使用前替换为实际值）:
#   caijie     - 应用简称（英文，用于日志/进程名/nginx配置文件名）
#   财会结算管理系统    - 应用标题（中文，用于输出显示）
#   /caijie/ - 默认路径前缀（如 /zhique/）
#
# 环境要求: python3 / node / nginx
#

set -e

# ─── 工具函数 ──────────────────────────────────────────────

# 查找空闲端口：从起始端口开始递增扫描，直到找到未被占用的端口
# 参数: $1 = 起始端口号
# 输出: 第一个空闲端口号（stdout）
# 返回: 0 = 成功找到, 1 = 扫描100个端口均被占用
find_free_port() {
    local start_port=$1
    local port=$start_port
    local max_port=$((start_port + 100))

    while [ $port -le $max_port ]; do
        if ! ss -tlnp 2>/dev/null | grep -q ":${port} "; then
            echo "$port"
            return 0
        fi
        port=$((port + 1))
    done

    echo "❌ 无法找到空闲端口 (已扫描 ${start_port}-${max_port})" >&2
    return 1
}

# ─── 配置（可通过命令行参数覆盖）──────────────────────────
BASE_PATH="${1:-/caijie/}"     # 前端 base 路径（nginx 分流用）
SERVER_PORT="${2:-9000}"               # FastAPI 期望端口（被占用时自动递增到空闲端口）
NGINX_PORT="${3:-8080}"                # nginx 对外端口
NGINX_CONF="/etc/nginx/conf.d/caijie.conf"  # 按应用名独立配置文件，避免互相覆盖
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="/tmp/caijie-server.log"
OTHER_APP_PORT=5000                     # 其他应用占用的端口（检测共存用）

echo "========================================"
echo "  🚀 财会结算管理系统 — 部署中..."
echo "  Base: ${BASE_PATH}"
echo "========================================"

# ─── 1. 环境检查 ──────────────────────────────────────────

command -v python3 &>/dev/null || { echo "❌ 需要 Python3"; exit 1; }
command -v node &>/dev/null     || { echo "❌ 需要 Node.js"; exit 1; }
command -v nginx &>/dev/null    || { echo "⚠️  nginx 未安装，跳过 nginx 配置"; }

echo "✅ Python: $(python3 --version)"
echo "✅ Node:   $(node --version)"

# ─── 2. 安装依赖 ──────────────────────────────────────────

echo ""
echo "📦 安装 Python 依赖..."
if [ -f "${PROJECT_DIR}/requirements.txt" ]; then
    pip install -q -r "${PROJECT_DIR}/requirements.txt" 2>/dev/null || \
        pip install -r "${PROJECT_DIR}/requirements.txt"
fi

echo "📦 安装前端依赖 + 构建..."
if [ -d "${PROJECT_DIR}/frontend" ]; then
    cd "${PROJECT_DIR}/frontend"
    npm install --silent 2>/dev/null || npm install

    # ─── 3. 前端配置（base 和 API baseURL 已设为动态，无需修改）──
    echo ""
    echo "🔧 前端使用动态路径，无需修改 base"

    # ─── 4. 构建前端 ──────────────────────────────────────────

    echo "🔨 构建前端..."
    npm run build
    cd "$PROJECT_DIR"
fi

# ─── 5. 端口分配（智能查找空闲端口，不杀任何进程）───────

echo ""
echo "🔍 端口检查..."

# 检查 nginx 端口
if ss -tlnp 2>/dev/null | grep -q ":${NGINX_PORT} "; then
    echo "  ⚠️  nginx 端口 ${NGINX_PORT} 已被占用，共用该 nginx 实例"
fi

# 检查 server 端口，被占用则自动找空闲端口（不杀进程！）
if ss -tlnp 2>/dev/null | grep -q ":${SERVER_PORT} "; then
    echo "  ⚠️  端口 ${SERVER_PORT} 已被占用，自动查找空闲端口..."
    OCCUPIED_INFO=$(ss -tlnp 2>/dev/null | grep ":${SERVER_PORT} " | head -1)
    echo "    占用来源: ${OCCUPIED_INFO}"
    NEW_PORT=$(find_free_port $((SERVER_PORT + 1)))
    if [ $? -ne 0 ]; then
        echo "❌ 无法分配端口，部署失败"
        exit 1
    fi
    echo "  ✅ 已分配空闲端口: ${NEW_PORT}（原期望 ${SERVER_PORT}）"
    SERVER_PORT=$NEW_PORT
else
    echo "  ✅ 端口 ${SERVER_PORT} 空闲可用"
fi

# ─── 6. 清理同应用的旧进程 ─────────────────────────────────

echo ""
echo "🧹 清理 财会结算管理系统 旧实例..."

# 通过进程名精确匹配本应用的旧实例（不依赖端口号，不影响其他应用）
OLD_PIDS=$(pgrep -f "python3.*caijie" 2>/dev/null || true)
if [ -n "$OLD_PIDS" ]; then
    echo "  停止旧实例 PID: $OLD_PIDS"
    echo "$OLD_PIDS" | xargs kill 2>/dev/null || true
    sleep 1
    echo "  ✅ 旧实例已停止"
else
    echo "  ✅ 无旧实例运行中"
fi

# ─── 7. 配置 nginx ────────────────────────────────────────

if command -v nginx &>/dev/null; then
    echo ""
    echo "🔧 配置 nginx (对外端口 ${NGINX_PORT})..."

    # 自动检测是否有其他应用在运行
    OTHER_APP_EXISTS=false
    curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${OTHER_APP_PORT}/" 2>/dev/null | grep -q "200" && OTHER_APP_EXISTS=true

    # 写入独立的 nginx 配置文件（按应用名称命名，多应用互不覆盖）
    if $OTHER_APP_EXISTS; then
        echo "   检测到其他应用 (端口 ${OTHER_APP_PORT})，使用路径隔离模式"
        cat > "$NGINX_CONF" << NGINX_EOF
server {
    listen ${NGINX_PORT};
    server_name _;
    charset utf-8;
    absolute_redirect off;

    # 财会结算管理系统 服务（${BASE_PATH} → ${SERVER_PORT}）
    location ${BASE_PATH} {
        proxy_pass http://127.0.0.1:${SERVER_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        client_max_body_size 50m;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # 其他应用（根路径兜底）
    location / {
        proxy_pass http://127.0.0.1:${OTHER_APP_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        client_max_body_size 50m;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
NGINX_EOF
    else
        echo "   独占模式：全量代理到 财会结算管理系统 (${SERVER_PORT})"
        cat > "$NGINX_CONF" << NGINX_EOF
server {
    listen ${NGINX_PORT};
    server_name _;
    charset utf-8;
    absolute_redirect off;

    location / {
        proxy_pass http://127.0.0.1:${SERVER_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        client_max_body_size 50m;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
NGINX_EOF
    fi

    # 保留 default.conf（预览环境可能依赖它），不删除

    nginx -t && nginx -s reload 2>/dev/null || nginx
    echo "  ✅ nginx 已就绪 (配置: ${NGINX_CONF})"
fi

# ─── 8. 启动服务 ──────────────────────────────────────────

echo ""
echo "🚀 启动 财会结算管理系统 服务 (端口 ${SERVER_PORT})..."

nohup env SERVER_PORT=${SERVER_PORT} CUSTOM_PREFIX=${BASE_PATH} python3 server.py > "$LOG_FILE" 2>&1 &
sleep 2

# ─── 9. 健康检查 ──────────────────────────────────────────

echo ""
echo "🔍 健康检查..."

# 直连 server
HTTP_DIRECT=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${SERVER_PORT}/" 2>/dev/null)
HTTP_API=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${SERVER_PORT}/api/health" 2>/dev/null)

# 通过 nginx
HTTP_NGINX=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${NGINX_PORT}${BASE_PATH}" 2>/dev/null)

echo "  直连首页: HTTP ${HTTP_DIRECT}"
echo "  直连API:  HTTP ${HTTP_API}"
echo "  nginx:    HTTP ${HTTP_NGINX}"

if [ "$HTTP_API" = "200" ]; then
    echo ""
    echo "========================================"
    echo "  ✅ 部署成功！财会结算管理系统 已上线"
    echo "  Server:    http://0.0.0.0:${SERVER_PORT}"
    echo "  Nginx:     http://0.0.0.0:${NGINX_PORT}${BASE_PATH}"
    echo "  日志:      ${LOG_FILE}"
    echo "========================================"
else
    echo ""
    echo "  ⚠️  API 检查失败 (HTTP ${HTTP_API})，查看日志: tail -f ${LOG_FILE}"
fi
