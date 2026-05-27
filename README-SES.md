# cloud-mail-ses

基于 [maillab/cloud-mail](https://github.com/maillab/cloud-mail) 的 fork，**Web 发信优先走 AWS SES API**（与 AwsMailPanel DNS/身份编排一致）。

## 发信优先级（站外收件）

1. **AWS SES** — 已配置 Worker Secrets 时
2. Cloudflare Email Service（`[[send_email]]` binding）
3. Resend（管理后台按域名 Token，可选关闭）

## 每个 Cloudflare 账户部署一份

域名与 Email Routing、Worker 必须在**同一 CF 账户**。多账户场景：每个账户单独 `wrangler deploy` 本仓库，可共用同一组 AWS 凭证。

## Secrets（与 AwsMailPanel 相同）

```bash
cd mail-worker
npx wrangler secret put AWS_REGION
npx wrangler secret put AWS_ACCESS_KEY_ID
npx wrangler secret put AWS_SECRET_ACCESS_KEY
```

发信前须由 AwsMailPanel 或控制台完成：SES 域名验证、MAIL FROM 子域、DKIM。

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

- 未配置 SES 时行为与上游一致（CF Email / Resend）。
- 不建议同一域名同时用 Resend 与 SES 发信，避免 SPF/DKIM 冲突。
