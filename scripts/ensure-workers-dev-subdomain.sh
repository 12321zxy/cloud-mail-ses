#!/usr/bin/env bash
# 在 CI 中注册账户级 workers.dev 子域（wrangler 非交互模式无法完成 onboarding）
set -euo pipefail

ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:?缺少 CLOUDFLARE_ACCOUNT_ID}"
SUBDOMAIN="${CF_WORKERS_SUBDOMAIN:-${GITHUB_ENVIRONMENT_NAME:-}}"

if [ -z "$SUBDOMAIN" ]; then
  echo '[ERR] 未设置 CF_WORKERS_SUBDOMAIN 或 GITHUB_ENVIRONMENT_NAME'
  exit 1
fi

sanitize_subdomain() {
  echo "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g' | sed 's/^-//;s/-$//'
}

BASE_SUB=$(sanitize_subdomain "$SUBDOMAIN")
if [ -z "$BASE_SUB" ]; then
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

is_retryable_error() {
  local resp="$1"
  echo "$resp" | jq -e '.errors[]? | select(.code == 10031)' >/dev/null 2>&1 && return 0
  echo "$resp" | grep -Eiq 'unavailable|too short|already exists|已被占用' && return 0
  return 1
}

try_register() {
  local candidate="$1"
  echo "[OK] 尝试注册 workers.dev 子域: ${candidate}.workers.dev"
  local resp
  resp=$(curl -sS "${CURL_AUTH[@]}" -X PUT "$API/accounts/$ACCOUNT_ID/workers/subdomain" \
    -H 'Content-Type: application/json' \
    -d "{\"subdomain\":\"$candidate\"}")
  if echo "$resp" | jq -e '.success == true' >/dev/null; then
    echo "[OK] 子域注册成功: $(echo "$resp" | jq -r '.result.subdomain').workers.dev"
    return 0
  fi
  echo "[WARN] 子域「${candidate}」不可用: $(echo "$resp" | jq -c '.errors // .')"
  if is_retryable_error "$resp"; then
    return 2
  fi
  echo "[ERR] 子域注册失败（不可重试）: $(echo "$resp" | jq -c '.errors // .')"
  return 1
}

EXISTING=$(get_subdomain)
if [ -n "$EXISTING" ] && [ "$EXISTING" != "null" ]; then
  echo "[OK] 账户已有 workers.dev 子域: ${EXISTING}.workers.dev"
  exit 0
fi

# 候选：Environment 名 + 预设后缀（pe1 → pe1-mail → pe1-mail-2 …）
declare -a CANDIDATES=()
declare -A SEEN=()
add_candidate() {
  local c
  c=$(sanitize_subdomain "$1")
  [ -z "$c" ] && return
  [ -n "${SEEN[$c]+x}" ] && return
  SEEN[$c]=1
  CANDIDATES+=("$c")
}

# 若 Secret 指定了与 Environment 不同的名，优先尝试
if [ -n "${CF_WORKERS_SUBDOMAIN:-}" ]; then
  add_candidate "$CF_WORKERS_SUBDOMAIN"
fi
for suffix in '' '-mail' '-mail-2' '-mail-3'; do
  add_candidate "${BASE_SUB}${suffix}"
done

LAST_ERR=""
for candidate in "${CANDIDATES[@]}"; do
  set +e
  try_register "$candidate"
  rc=$?
  set -e
  if [ "$rc" -eq 0 ]; then
    exit 0
  fi
  if [ "$rc" -eq 1 ]; then
    exit 1
  fi
  LAST_ERR="$candidate"
done

echo "[ERR] 子域注册失败，已尝试: ${CANDIDATES[*]}"
echo "[WARN] 请到 Cloudflare 控制台手动注册更长且唯一的子域:"
echo "       https://dash.cloudflare.com/${ACCOUNT_ID}/workers/onboarding"
exit 1
