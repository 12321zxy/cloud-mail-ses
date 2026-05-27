#!/usr/bin/env bash
# 在 CI 中注册账户级 workers.dev 子域（wrangler 非交互模式无法完成 onboarding）
set -euo pipefail

ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:?缺少 CLOUDFLARE_ACCOUNT_ID}"
SUBDOMAIN="${CF_WORKERS_SUBDOMAIN:-${GITHUB_ENVIRONMENT_NAME:-}}"

if [ -z "$SUBDOMAIN" ]; then
  echo '[ERR] 未设置 CF_WORKERS_SUBDOMAIN 或 GITHUB_ENVIRONMENT_NAME'
  exit 1
fi

# 子域仅允许小写字母数字与连字符
SUBDOMAIN=$(echo "$SUBDOMAIN" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g' | sed 's/^-//;s/-$//')
if [ -z "$SUBDOMAIN" ]; then
  echo '[ERR] workers.dev 子域名无效'
  exit 1
fi

API="https://api.cloudflare.com/client/v4"
CURL_AUTH=()
if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
  CURL_AUTH=(-H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}")
elif [ -n "${CLOUDFLARE_API_KEY:-}" ] && [ -n "${CLOUDFLARE_EMAIL:-}" ]; then
  CURL_AUTH=(-H "X-Auth-Email: ${CLOUDFLARE_EMAIL}" -H "X-Auth-Key: ${CLOUDFLARE_API_KEY}")
else
  echo '[ERR] 须设置 CLOUDFLARE_API_TOKEN 或 CLOUDFLARE_API_KEY + CLOUDFLARE_EMAIL'
  exit 1
fi

get_subdomain() {
  curl -sS "${CURL_AUTH[@]}" "$API/accounts/$ACCOUNT_ID/workers/subdomain" | jq -r '.result.subdomain // empty'
}

EXISTING=$(get_subdomain)
if [ -n "$EXISTING" ] && [ "$EXISTING" != "null" ]; then
  echo "[OK] 账户已有 workers.dev 子域: ${EXISTING}.workers.dev"
  exit 0
fi

echo "[OK] 注册 workers.dev 子域: ${SUBDOMAIN}.workers.dev"
RESP=$(curl -sS "${CURL_AUTH[@]}" -X PUT "$API/accounts/$ACCOUNT_ID/workers/subdomain" \
  -H 'Content-Type: application/json' \
  -d "{\"subdomain\":\"$SUBDOMAIN\"}")

if echo "$RESP" | jq -e '.success == true' >/dev/null; then
  echo "[OK] 子域注册成功: $(echo "$RESP" | jq -r '.result.subdomain').workers.dev"
  exit 0
fi

echo "[ERR] 子域注册失败: $(echo "$RESP" | jq -c '.errors // .')"
echo "[WARN] 若子域已被占用，请到 Cloudflare 控制台手动注册:"
echo "       https://dash.cloudflare.com/${ACCOUNT_ID}/workers/onboarding"
exit 1
