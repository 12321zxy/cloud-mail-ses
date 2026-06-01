# cloud-mail-ses

基于 [maillab/cloud-mail](https://github.com/maillab/cloud-mail) 的 fork，**Web 发信走 AWS SES 或 ZeptoMail API**（与 AwsMailPanel 编排一致）。

## 每个 Cloudflare 账户部署一份

域名与 Email Routing、Worker 必须在**同一 CF 账户**。多账户场景：每个账户单独部署一份，发信凭证可共用或按 Environment 区分。

## 发信优先级（站外收件）

1. **ZeptoMail** — `SEND_PROVIDER=zeptomail` 且已配置 `ZEPTOMAIL_TOKEN`（AwsMailPanel 可自动同步）
2. **AWS SES** — 已配置 Worker Secrets 时
3. Cloudflare Email Service（`[[send_email]]` binding）
4. Resend（管理后台按域名 Token，可选关闭）

## Secrets（与 AwsMailPanel 相同）

**AWS SES：**

```bash
cd mail-worker
npx wrangler secret put AWS_REGION
npx wrangler secret put AWS_ACCESS_KEY_ID
npx wrangler secret put AWS_SECRET_ACCESS_KEY
npx wrangler secret put SEND_PROVIDER   # 填 ses
```

**ZeptoMail（Zoho API）：**

```bash
cd mail-worker
npx wrangler secret put SEND_PROVIDER   # 填 zeptomail
npx wrangler secret put ZEPTOMAIL_TOKEN # Mail Agent → SMTP/API → Send Mail Token
npx wrangler secret put ZEPTOMAIL_FROM  # 已验证域名下的发件人地址
```

发信前须由 AwsMailPanel 或控制台完成：SES 域名验证、MAIL FROM 子域、DKIM；或 ZeptoMail 控制台域名验证。

## 部署（推荐 GitHub）

**推送到 GitHub，由 Actions 部署到各 Cloudflare 账户**，更新时 `git push` 即可同步所有账户。

详见 [docs/DEPLOY-GITHUB.md](docs/DEPLOY-GITHUB.md)。

简要步骤：

1. 新建 GitHub 仓库并 push 本目录  
2. 每个 CF 账户建一个 **GitHub Environment**（如 `cf-main`）  
3. 复制 `deploy/accounts.json.example` → `deploy/accounts.json`  
4. 在 Environment / Repository 配置 Secrets（CF 凭证、DOMAIN、AWS SES 等）  
5. Push `main` 或手动运行 workflow **Deploy to CF accounts (SES)**

本机单账户：`scripts/deploy-one-account.sh`（需 `deploy/account.env.example`）

## 手工步骤（每个账户一次）

在**域名所在 CF 账户**开启 Email Routing Catch-all → Worker `cloud-mail`；DNS 可用 AwsMailPanel 编排。

## 说明

- 未配置 SES / ZeptoMail 时行为与上游一致（CF Email / Resend）。
- 不建议同一域名同时混用多种站外发信，避免 SPF/DKIM 冲突。
