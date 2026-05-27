# 通过 GitHub 部署到多个 Cloudflare 账户

推荐做法：**一个 GitHub 仓库 + 每个 CF 账户一个 GitHub Environment**，推送 `main` 时自动（或手动）部署到所有账户。

## 为什么这样做

| 方式 | 更新代码 | 多账户 |
|------|----------|--------|
| 本机多次 `wrangler deploy` | 每台都要拉代码 | 易漏、难统一 |
| **GitHub → 各 CF 账户** | `git push` 一次 | 矩阵/Environment 各部署一份 |

每个 CF 账户仍有**独立的 D1 / KV / R2 / Worker**，仅**源码**共用同一仓库。

## 1. 推到 GitHub

```bash
cd ~/Documents/cloud-mail-ses
git init
git add .
git commit -m "cloud-mail-ses: SES 发信 + 多账户部署配置"
# 在 GitHub 新建空仓库后：
git remote add origin git@github.com:你的用户名/cloud-mail-ses.git
git branch -M main
git push -u origin main
```

不要提交 `.env`、`node_modules`、`.wrangler`（已在 `.gitignore`）。

## 2. 为每个 Cloudflare 账户建 GitHub Environment

仓库 → **Settings → Environments** → 例如：

- `cf-main`
- `cf-brand-b`

在每个 Environment 里配置 **Environment secrets**（该账户专用）：

| Secret | 说明 |
|--------|------|
| `CLOUDFLARE_API_TOKEN` | 该账户 API Token（建议 Workers + D1 + KV + R2 权限） |
| `CLOUDFLARE_ACCOUNT_ID` | 账户 ID |
| `DOMAIN` | JSON 数组，如 `["example.com"]` |
| `ADMIN` | 管理员邮箱，如 `admin@example.com` |
| `JWT_SECRET` | 随机长字符串 |
| `NAME` | Worker 名，如 `cloud-mail` |
| `CUSTOM_DOMAIN` | 可选，自定义域名 |
| `D1_DATABASE_ID` | 可选，已建 D1 可填，否则 CI 自动创建 |
| `KV_NAMESPACE_ID` | 可选 |
| `R2_BUCKET_NAME` | 可选 |

**Repository secrets**（所有账户共用，放仓库级即可）：

| Secret | 说明 |
|--------|------|
| `AWS_REGION` | 与 AwsMailPanel / SES 一致 |
| `AWS_ACCESS_KEY_ID` | SES 发信 |
| `AWS_SECRET_ACCESS_KEY` | SES 发信 |

## 3. 登记要部署的账户列表

复制示例并编辑：

```bash
cp deploy/accounts.json.example deploy/accounts.json
```

`deploy/accounts.json` 只写 **Environment 名称**（无密钥），会随仓库提交：

```json
[
  { "environment": "cf-main", "name": "cloud-mail" },
  { "environment": "cf-brand-b", "name": "cloud-mail" }
]
```

## 4. 触发部署

- **自动**：推送到 `main` 且改动 `mail-worker/`、`mail-vue/`、`deploy/accounts.json`
- **手动**：Actions → **Deploy to CF accounts (SES)** → Run workflow

流程会为每个账户：构建前端 → `wrangler deploy` → 写入 **AWS SES Secrets** → 调用 `/api/init` 初始化 D1。

## 5. 每个账户仍需一次性手工

GitHub 无法代替（域名须在**同一 CF 账户**）：

1. Email Routing 开启并 Catch-all → 该账户的 `cloud-mail` Worker  
2. 用 **AwsMailPanel** 写入该域名的 MX/SPF（及 SES DNS）

## 6. 与 AwsMailPanel 的关系

| 项目 | 职责 |
|------|------|
| **cloud-mail-ses**（本仓库） | 企业邮箱 Web + 收件 Worker + **SES 发信** |
| **AwsMailPanel** | 多 CF 账户 DNS/SES 编排、任务记录 |

两者可各建各的 GitHub 仓库；AWS 凭证在两边 Secrets 保持一致即可。

## 7. 仅更新某一个账户

Actions 手动运行 workflow，或临时只保留 `deploy/accounts.json` 里一个 environment 再 push（不推荐长期这样）。

## 8. 不用 GitHub 时

单账户本机：

```bash
cd mail-worker
cp ../deploy/account.env.example .env.account
# 编辑 .env.account 后：
../scripts/deploy-one-account.sh
```
