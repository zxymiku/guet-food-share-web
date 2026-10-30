# 桂电美食分享 · Web

面向桂林电子科技大学的美食地图。Cloudflare Workers 提供页面、API、登录、投稿审核和 Android 更新接口；D1 仅保存元数据，图片和视频加密后存入公开 GitHub 媒体仓库的 Releases 附件。

主项目：[桂电美食分享](https://github.com/zxymiku/guet-food-share)。媒体仓库：[桂电美食分享媒体](https://github.com/zxymiku/guet-food-share-media)。

## Cloudflare 仓库绑定（首次操作）

当前账号的 Wrangler 登录可部署 Worker，但没有 Workers Builds Configuration 权限，无法通过当前 API 凭据代为绑定 GitHub。请在 Cloudflare 控制台完成一次：

1. 打开 Worker **guet-food-share** → Settings → Builds → Connect repository。
2. 选择 **zxymiku/guet-food-share-web**，生产分支 **main**。
3. 根目录 `/`，构建命令留空（静态前端不需要额外构建），部署命令 `npm run db:remote && npm run deploy`。
4. Node.js 使用 22 或 24。Worker 名称必须与 `wrangler.jsonc` 的 `guet-food-share` 一致。
5. 完成连接后，向本仓库 main 推送代码，即会由 Workers Builds 自动部署。修改文件但未提交推送不会触发部署。

不要同时启用两种部署方式。`.github/workflows/deploy.yml` 是可选备用方案，只有设置仓库变量 `DEPLOY_WITH_ACTIONS=true` 后才运行；它需要另外配置 Cloudflare API Token。当前按用户选择使用控制台绑定方式。

## 运行

```powershell
npm ci
Copy-Item .dev.vars.example .dev.vars
# DATA_ENCRYPTION_KEY 使用至少 32 字符随机值；不要提交 .dev.vars
npm run db:local
npm run dev
```

高德凭据由每位用户在网页“地图 API”填写自己的 JSAPI Key 和 securityJsCode，默认长期保存在当前浏览器；不上传项目服务器。[详细申请教程](public/amap-guide.md)在 `/amap-guide.html` 渲染，涵盖收费与额度、域名限制和排错。定位经授权后转换为 GCJ-02，自动填写坐标、解析地址，并可建议 80 米内的 POI 店名；必须由用户确认实际门店。拒绝定位仍可手动选点。

## Secret 与变量

完整申请步骤：[主项目凭据与最小权限指南](https://github.com/zxymiku/guet-food-share/blob/main/docs/CREDENTIALS.md)。

- 同一个 PASSWORD_CREDENTIAL 支持 Web 与 Android。运行 `npm run password:setup` 输入并上传加盐密码验证器，不公开原密码。
- MEDIA_GITHUB_TOKEN 仅授权媒体仓库 Contents write；DISPATCH_GITHUB_TOKEN 仅授权主仓库 Contents write；FEEDBACK_GITHUB_TOKEN 仅授权主/Web 两仓库 Issues write。
- INTAKE_SECRET 只读待审稿，PUBLISH_SECRET 只用于发布，分别与主仓库 Actions repository secret / production Environment secret 匹配。
- GitHub App 仅开 Issues write，安装到两个目标仓库。Client ID/Secret 通过 GITHUB_CLIENT_ID/GITHUB_CLIENT_SECRET 配置，按 GITHUB_WEB_REPO_ID/GITHUB_ANDROID_REPO_ID 为用户令牌限制仓库。密码用户反馈由管理员代发，GitHub 用户反馈使用自己的授权。
- DATA_ENCRYPTION_KEY 用于按用途派生加密密钥；已有部署不要随意更换。
- 高德 Key 不再配置在 Worker 或 APK 构建。Web JS SDK 与地址解析直接连接高德；个人凭据与地点数据分离。Android 在自己的设置页填写 Android Key 和可选 Web 服务 Key。
- workers.dev 与预览入口已禁用。生产网页、API、截图、登录回调和更新统一使用 https://food.zxymiku.top 。

## 上传和播放

- 图片：JPEG/PNG，最多 6 张，每张 8 MB。
- 视频：MP4/WebM，最多 2 个，每个 50 MB。浏览器/设备还需支持视频文件自身的编码。
- 上传到 `/api/photos` 或 `/api/media`，二进制 body，正确 Content-Type，建议同时发送 X-File-Size。
- Worker 使用 256 KiB 分块 AES-GCM 加密，密文作为 `.gefm` Release 附件保存；不会把视频完整读入 Worker 内存。
- 媒体仓库全公开，但附件不包含解密密钥。待审媒体仅投稿者和审核员可通过应用解密；审核发布后可公开播放。公开后访问者仍可保存解密内容，这不是 DRM。
- 支持单段 HTTP Range 视频播放；当前从附件起点流式解密到目标区间，远距离 seek 会有额外流量和延迟。
- 按日创建 Release、900 个附件后分桶。GitHub 依然有 API 配额、可用性和平台使用规则；不视为无限媒体 CDN。

## 按需验证

不再在每次 push 自动执行全套测试。需要时手动运行：

```powershell
npm test
npm run test:integration
npm run check
```

完整配置与 Android 发布说明位于主项目 docs/DEPLOYMENT.md。

## 意见反馈

页面“反馈”可手动跳转 Web 仓库 Issues，也可自动填写文字和最多 3 张截图。Android 发往主项目仓库。

共享密码登录由管理员的 FEEDBACK_GITHUB_TOKEN 代发；GitHub App 登录由该用户自己的、对应平台的 user token 发布。不会在用户授权失败时改用管理员 Token。两种身份都支持自动反馈，且均不能通过客户端删除记录。

截图最大 8 MB/张，上传前去 EXIF，加密后保存到媒体仓库；明确确认的反馈截图才生成独立随机公开链接供 GitHub 图片代理读取。普通媒体仍遵循原投稿权限。正文只附用户填写的内容、平台和应用版本。

网络结果不确定时保留表单与请求编号，重试确认而不重复创建。每个用户/设备身份每天最多自动提交 5 次，属于基础应用频次限制。

## 公开数据与教程

`/api/places?limit=200` 返回完整地点字段、ID、创建/发布时间和 `nextCursor`，持续请求游标直到 null。前端自动获取全部页；“导出全部公开地点”保存可移植 JSON，媒体以原站路径引用。数据不含个人 Key，换用任意有效个人 API 绘制相同 GCJ-02 坐标即可。

教程源码为 `public/amap-guide.md`，修改后运行 `npm run guide:build`。生成 HTML 不依赖外部样式、字体或脚本，Android 使用相同生成文件。主仓库运行 `node scripts/sync-map-guide.mjs` 同步到 APK。
