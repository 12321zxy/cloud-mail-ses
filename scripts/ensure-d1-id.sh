#!/usr/bin/env bash
# 解析或创建 Cloudflare D1 数据库 ID（幂等；兼容 list 漏项 / create 已存在）
set -euo pipefail

NAME="${1:?用法: ensure-d1-id.sh <database-name>}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/../mail-worker"

pick_d1_id() {
  local raw id
  raw="$(pnpm wrangler d1 list --json 2>/dev/null || true)"
  if [ -n "$raw" ]; then
    id="$(echo "$raw" | jq -r ".[]? | select(.name==\"$NAME\") | (.uuid // .database_id // empty)" 2>/dev/null | head -1)"
    if [ -n "$id" ] && [ "$id" != "null" ]; then
      echo "$id"
      return 0
    fi
  fi
  raw="$(pnpm wrangler d1 info "$NAME" --json 2>/dev/null || true)"
  if [ -n "$raw" ]; then
    id="$(echo "$raw" | jq -r '.uuid // .database_id // .result.uuid // .result.database_id // empty' 2>/dev/null | head -1)"
    if [ -n "$id" ] && [ "$id" != "null" ]; then
      echo "$id"
      return 0
    fi
  fi
  return 1
}

D1_ID=""
if D1_ID="$(pick_d1_id)"; then
  echo "[OK] 已找到 D1: ${NAME} (${D1_ID})" >&2
  echo "$D1_ID"
  exit 0
fi

echo "[OK] 创建 D1: ${NAME}…" >&2
set +e
OUT="$(pnpm wrangler d1 create "$NAME" 2>&1)"
RC=$?
set -e

if [ "$RC" -ne 0 ]; then
  if echo "$OUT" | grep -qi 'already exists'; then
    echo "[WARN] D1 ${NAME} 已存在，改用 d1 info 解析 ID" >&2
  else
    echo "$OUT" >&2
    exit "$RC"
  fi
else
  echo "$OUT" >&2
fi

if ! D1_ID="$(pick_d1_id)"; then
  echo "[ERR] 无法解析 D1 数据库 ID: ${NAME}" >&2
  exit 1
fi

echo "[OK] D1 ID: ${D1_ID}" >&2
echo "$D1_ID"
