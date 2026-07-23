#!/usr/bin/env bash
# Cloudflare 免费/基础计划：全账户 cron 触发器上限 5 条。
# 每域名一个 cm-* Worker 时，默认不在 wrangler 中注册 cron，避免 deploy 失败（code 10072）。
# 若仅需某一个 Worker 跑定时任务，在 GitHub Environment 设 ENABLE_CRON_TRIGGERS=true（仅一个 Environment）。
set -euo pipefail

CONFIG="${1:?usage: strip-wrangler-cron-triggers.sh wrangler.toml}"

if [[ "${ENABLE_CRON_TRIGGERS:-}" == "true" ]]; then
  echo "[OK] 保留 cron triggers（ENABLE_CRON_TRIGGERS=true，占用 1 条账户配额）"
  exit 0
fi

if ! grep -q '^\[triggers\]' "$CONFIG"; then
  exit 0
fi

if sed --version 2>/dev/null | grep -qi gnu; then
  sed -i '/^\[triggers\]/,/^\[vars\]/{
    /^\[vars\]/!d
  }' "$CONFIG"
else
  sed -i '' '/^\[triggers\]/,/^\[vars\]/{
    /^\[vars\]/!d
  }' "$CONFIG"
fi

echo "[OK] 已移除 [triggers]（避免 CF 账户 cron 超过 5 条；可选 Secret ENABLE_CRON_TRIGGERS=true 启用）"
