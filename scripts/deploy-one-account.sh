#!/usr/bin/env bash
# 从本机部署 cloud-mail-ses 到单个 Cloudflare 账户
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKER="$ROOT/mail-worker"
WRANGLER="${WRANGLER:-/opt/homebrew/bin/wrangler}"

ENV_FILE="${1:-$WORKER/.env.account}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "[ERR] 缺少账户配置: $ENV_FILE"
  echo "      可复制 deploy/account.env.example"
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

for v in CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID DOMAIN ADMIN JWT_SECRET; do
  if [[ -z "${!v:-}" ]]; then
    echo "[ERR] 未设置 $v"
    exit 1
  fi
done

export CLOUDFLARE_API_TOKEN
export CLOUDFLARE_ACCOUNT_ID

cd "$WORKER"

echo "[OK] 安装依赖并构建…"
if command -v pnpm >/dev/null 2>&1; then
  pnpm install --frozen-lockfile
else
  npm install
fi

CONFIG="wrangler-action.toml"
NAME="${NAME:-cloud-mail}"

if [[ -z "${D1_DATABASE_ID:-}" ]]; then
  echo "[OK] 检查 D1…"
  D1_DATABASE_ID="$("$WRANGLER" d1 list --json 2>/dev/null | jq -r ".[] | select(.name==\"$NAME\") | .uuid" | head -1)"
  if [[ -z "$D1_DATABASE_ID" || "$D1_DATABASE_ID" == "null" ]]; then
    "$WRANGLER" d1 create "$NAME"
    D1_DATABASE_ID="$("$WRANGLER" d1 list --json | jq -r ".[] | select(.name==\"$NAME\") | .uuid")"
  fi
fi

if [[ -z "${KV_NAMESPACE_ID:-}" ]]; then
  KV_NAMESPACE_ID="$(bash "$ROOT/scripts/ensure-kv-id.sh" "$NAME")"
fi

sed -e "s|\${NAME}|${NAME}|g" \
    -e "s|\${CUSTOM_DOMAIN}|${CUSTOM_DOMAIN:-}|g" \
    -e "s|\"\${DOMAIN}\"|${DOMAIN}|g" \
    -e "s|\${ADMIN}|${ADMIN}|g" \
    -e "s|\${JWT_SECRET}|${JWT_SECRET}|g" \
    -e "s|\${D1_DATABASE_ID}|${D1_DATABASE_ID}|g" \
    -e "s|\${KV_NAMESPACE_ID}|${KV_NAMESPACE_ID}|g" \
    -e "s|\${R2_BUCKET_NAME}|${R2_BUCKET_NAME:-}|g" \
    -e "s|\${AI_MODEL}|@cf/meta/llama-3.1-8b-instruct|g" \
    -e "s|\${ANALYSIS_CACHE}|false|g" \
    -e "s|\${PROJECT_LINK}||g" \
    -e "s|\${LINUXDO_CLIENT_ID}||g" \
    -e "s|\${LINUXDO_CLIENT_SECRET}||g" \
    -e "s|\${LINUXDO_CALLBACK_URL}||g" \
    -e "s|\${LINUXDO_SWITCH}||g" \
    wrangler-action.toml > wrangler-deploy.generated.toml

if [[ -z "${CUSTOM_DOMAIN:-}" ]]; then
  sed -i '' '/\[\[routes\]\]/,/^$/d' wrangler-deploy.generated.toml 2>/dev/null || \
    sed -i '/\[\[routes\]\]/,/^$/d' wrangler-deploy.generated.toml
fi
if [[ -z "${R2_BUCKET_NAME:-}" ]]; then
  sed -i '' '/\[\[r2_buckets\]\]/,/^$/d' wrangler-deploy.generated.toml 2>/dev/null || \
    sed -i '/\[\[r2_buckets\]\]/,/^$/d' wrangler-deploy.generated.toml
fi

bash "$ROOT/scripts/strip-wrangler-cron-triggers.sh" wrangler-deploy.generated.toml

echo "[OK] 部署 Worker…"
SECRETS_FILE="$(mktemp)"
bash "$ROOT/scripts/build-wrangler-secrets-file.sh" "$SECRETS_FILE"
DEPLOY_ARGS=(-c wrangler-deploy.generated.toml)
if [[ -s "$SECRETS_FILE" ]]; then
  DEPLOY_ARGS+=(--secrets-file "$SECRETS_FILE")
fi
"$WRANGLER" deploy "${DEPLOY_ARGS[@]}" 2>&1 | tee deploy.log
rm -f "$SECRETS_FILE"

WORKER_URL="${CUSTOM_DOMAIN:+https://${CUSTOM_DOMAIN}}"
if [[ -z "$WORKER_URL" ]]; then
  WORKER_URL=$(grep -oE 'https://[a-zA-Z0-9.-]+\.workers\.dev' deploy.log | tail -1 || true)
fi

if [[ -n "$WORKER_URL" ]]; then
  echo "[OK] 初始化数据库: $WORKER_URL/api/init/…"
  sleep 10
  curl -sL "${WORKER_URL}/api/init/${JWT_SECRET}" || true
  echo ""
fi

echo "[OK] 完成。请在 CF 控制台为该域名配置 Email Routing → 本 Worker。"
