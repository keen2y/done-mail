# 贡献指南

感谢你愿意改进 DoneMail。

## 项目边界

DoneMail 保持单管理员、自托管和 Cloudflare-first。

暂不接受这些方向：

- 多用户注册系统。
- 主动发信 / 发件箱 / Resend 类外发能力（策略转发除外）。
- SMTP 多通道 fallback。
- 复杂权限系统。
- 传统服务器部署模式。

## 提交前检查

```bash
npm run check
```

如果只改 README 或文档，可以在 PR 里说明未跑完整检查。

## 发版

发版时同步修改 `package.json` 的 `version`、`src/shared/version.ts` 的 `APP_VERSION`，以及 `.github/release.md` 更新说明。推到 `main` 后由 Release 工作流创建 GitHub Release。用户侧部署与升级：Fork + Cloudflare 连接该 Fork，升级使用 GitHub 原生 Sync fork。

## 变更注意

- 数据库结构只追加新的 migration，不修改已经发布的 migration（首版单 migration 之后的变更均追加）。
- 访问限流为代码内置常量，不要重新做成可配置设置项，除非有充分产品理由。
- 生产配置不要提交账号专属 ID、local 资源或私有环境信息。
- 公开 API 和后台 API 可以共用业务函数，但认证、限流和响应格式必须保持边界清楚。
- UI 改动保持现有控制台风格，优先清楚、紧凑、可重复使用，不引入营销页式布局。

## 代码取向

- 优先修根因。
- 不堆兼容层。
- 不保留已废弃路径。
- 不为假设场景提前铺复杂抽象。
- 新逻辑替代旧逻辑时，同步删除旧代码。

## PR 描述

PR 请说明：

- 改了什么。
- 为什么这么改。
- 如何验证。
- 是否影响部署、数据结构或公开 API。
