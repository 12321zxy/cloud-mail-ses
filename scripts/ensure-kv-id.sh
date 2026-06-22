#!/usr/bin/env bash
# 解析或创建 Cloudflare KV namespace ID（幂等；兼容 list 漏项 / create 已存在）
set -euo pipefail

NAME="${1:?用法: ensure-kv-id.sh <namespace-title>}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/../mail-worker"

pick_kv_id() {
  local raw id
  raw="$(pnpm wrangler kv namespace list 2>/dev/null || true)"
  if [ -n "$raw" ]; then
    id="$(echo "$raw" | jq -r ".[]? | select(.title==\"$NAME\") | .id // empty" 2>/dev/null | head -1)"
    if [ -n "$id" ] && [ "$id" != "null" ]; then
      echo "$id"
      return 0
    fi
  fi
  return 1
}

KV_ID=""
if KV_ID="$(pick_kv_id)"; then
  echo "[OK] 已找到 KV: ${NAME} (${KV_ID})" >&2
  echo "$KV_ID"
  exit 0
fi

echo "[OK] 创建 KV: ${NAME}…" >&2
set +e
OUT="$(pnpm wrangler kv namespace create "$NAME" 2>&1)"
RC=$?
set -e

if [ "$RC" -ne 0 ]; then
  if echo "$OUT" | grep -qi 'already exists'; then
    echo "[WARN] KV ${NAME} 已存在，重新 list 解析 ID" >&2
  else
    echo "$OUT" >&2
    exit "$RC"
  fi
else
  echo "$OUT" >&2
fi

if ! KV_ID="$(pick_kv_id)"; then
  echo "[ERR] 无法解析 KV namespace ID: ${NAME}" >&2
  exit 1
fi

echo "[OK] KV ID: ${KV_ID}" >&2
echo "$KV_ID"
