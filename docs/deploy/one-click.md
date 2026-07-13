# 开始部署

1. Fork 本仓库  
2. 在 Cloudflare 连接该 Fork 并部署  
3. 升级时在 GitHub 点 **Sync fork**，Cloudflare 会自动重新构建

## 1. Fork 仓库

1. 打开 [keen2y/done-mail](https://github.com/keen2y/done-mail)  
2. 点击右上角 **Fork**，fork 到你自己的 GitHub 账号  

## 2. 连接 Git 并部署 Worker

1. 登录 [Cloudflare](https://dash.cloudflare.com/)  
2. 打开 **计算** → **Workers 和 Pages** → **创建应用程序**  
3. 选择 **Continue with GitHub**，选中 **你的 Fork**（不要选上游 `keen2y/done-mail`）  
4. 构建配置：

| 模式 | Build command | Deploy command | 说明 |
| --- | --- | --- | --- |
| 默认 | `npm run build` | `npm run deploy` | 附件只存元信息 |
| 启用 R2 | `npm run build` | `npm run deploy:r2` | 可保存和下载附件内容 |

5. 保存并部署，打开 Worker 访问地址  

![Cloudflare 部署配置示意](/deploy/cloudflare-deploy-config.png)

## 3. 初始化后台

首次打开 DoneMail，创建管理员 Key。

![初始化管理员 Key](/deploy/setup-admin-key.png)

建议路径：

1. 创建管理员 Key 并登录  
2. **配置中心** → 连接 Cloudflare（接口令牌）  
3. **域名管理** → 添加主域 / 子域  
4. 按需配置策略、共享与公开 API  

## 后续更新 {#updates}

### 检查是否有新版本

后台右上角菜单 → **检查更新**。有新版本时菜单项会高亮，并显示版本对比与更新日志。

### 升级（推荐）

1. 打开你 **Fork** 出来的 GitHub 仓库  
2. 点击 **Sync fork** → **Update branch**（若有冲突，按 GitHub 提示处理；纯 fork 未改代码时一般直接更新即可）  
3. Cloudflare 检测到 `main` 变更后会自动重新构建部署  
4. 回到 DoneMail 再点一次「检查更新」确认版本  

邮件数据在 D1 中，**同步代码一般不会清空邮件**（不要删掉 D1 绑定或换库即可）。
