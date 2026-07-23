#!/usr/bin/env bash
# 生成 wrangler deploy --secrets-file 用的键值文件（避免 deploy 后再 secret put 触发版本冲突）
set -euo pipefail

OUT="${1:?usage: build-wrangler-secrets-file.sh OUTFILE}"
: > "$OUT"

if [[ -n "${AWS_ACCESS_KEY_ID:-}" && -n "${AWS_SECRET_ACCESS_KEY:-}" ]]; then
  printf '%s=%s\n' AWS_REGION "${AWS_REGION:-us-east-1}" >> "$OUT"
  printf '%s=%s\n' AWS_ACCESS_KEY_ID "$AWS_ACCESS_KEY_ID" >> "$OUT"
  printf '%s=%s\n' AWS_SECRET_ACCESS_KEY "$AWS_SECRET_ACCESS_KEY" >> "$OUT"
  printf '%s=%s\n' SEND_PROVIDER ses >> "$OUT"
elif [[ "${SEND_PROVIDER:-}" == 'zeptomail' && -n "${ZEPTOMAIL_TOKEN:-}" ]]; then
  printf '%s=%s\n' SEND_PROVIDER zeptomail >> "$OUT"
  printf '%s=%s\n' ZEPTOMAIL_TOKEN "$ZEPTOMAIL_TOKEN" >> "$OUT"
  if [[ -n "${ZEPTOMAIL_FROM:-}" ]]; then
    printf '%s=%s\n' ZEPTOMAIL_FROM "$ZEPTOMAIL_FROM" >> "$OUT"
  fi
fi

if [[ -n "${INBOUND_WEBHOOK_SECRET:-}" ]]; then
  printf '%s=%s\n' INBOUND_WEBHOOK_SECRET "$INBOUND_WEBHOOK_SECRET" >> "$OUT"
fi

if [[ -s "$OUT" ]]; then
  echo "[OK] Secrets 文件已生成（$(wc -l < "$OUT" | tr -d ' ') 项）"
else
  echo "[OK] 无发信 Secrets，跳过 --secrets-file"
fi
