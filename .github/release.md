# v1.0.0 更新说明

- 首个正式版本：基于 Cloudflare Workers 的收信控制台（不含主动发信，保留策略转发）。
- 部署：Fork 仓库后在 Cloudflare 连接该 Fork；升级使用 GitHub Sync fork。
- 配置中心：连接 Cloudflare、入口域名、邮件定时清理（保留天数最少 1 天）。
- 收信检索：主题 / 地址 / 正文 FTS，收信后即可搜索；公开 API 列表默认 limit 3、上限 20。
- 策略自动化：转发、HTTP、Telegram；异常记录仅记失败与拦截。
- 检查更新：对照上游 Release，更新日志支持基础 Markdown。
