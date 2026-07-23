# AWS SES Inbound → cloud-mail

在保留 **Cloudflare Email Routing** 收件（默认 `email()` 处理器）的前提下，可选启用 **HTTP 收件**，供 AWS SES Inbound、Lambda 或自建网关投递邮件。

未配置 `INBOUND_WEBHOOK_SECRET` 时，`/api/inbound/*` 返回 503，**不影响**现有 CF 收件。

## Worker Secrets

```bash
cd mail-worker
npx wrangler secret put INBOUND_WEBHOOK_SECRET
# 与 AwsMailPanel 同步到 GitHub Environment 的值一致（ses_inbound 时默认等于 JWT_SECRET）
```

同时需要 AWS 凭证（与发信相同），以便从 S3 拉取 raw MIME：

- `AWS_REGION`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

## API

| 路径 | 说明 |
|------|------|
| `POST /api/inbound/mime` | 直接投递 MIME |
| `POST /api/inbound/ses` | 兼容 SES Received SNS 通知（含 S3 action） |

鉴权（二选一）：

- 请求头 `X-Inbound-Secret: <INBOUND_WEBHOOK_SECRET>`
- 或 `Authorization: Bearer <INBOUND_WEBHOOK_SECRET>`

### 直接 MIME

```json
{
  "to": "support@example.com",
  "raw": "完整 MIME 原文（字符串）"
}
```

或使用 Base64：

```json
{
  "to": "support@example.com",
  "rawBase64": "..."
}
```

### SES Received（Lambda 直 POST）

将 SNS `Notification` 的 `Message` 解析后 POST，或整包 POST。若 `receipt.action` 为 S3，Worker 会用 AWS 凭证拉取对象再入库。

## DNS（根域 MX，与 CF Routing 二选一）

```
10 inbound-smtp.us-east-1.amazonaws.com
```

收件区域须支持 SES Receiving（如 `us-east-1`）。AwsMailPanel 任务参数：

```json
{
  "receiveProvider": "ses_inbound",
  "dnsProvider": "external",
  "mode": "full"
}
```

## AwsMailPanel 编排

- `receiveProvider: ses_inbound` 时跳过 Email Routing 绑定
- DNS 计划返回 `ses-inbound` MX
- GitHub Environment 同步 `INBOUND_WEBHOOK_SECRET`（默认与 `JWT_SECRET` 相同）

## 限制

- **邮件转发到其他邮箱**（管理后台「转发」）依赖 CF `message.forward`，HTTP/SES 通道仅入库 + TG 通知
- 根域 MX 不能同时指向 CF Routing 与 SES Inbound
