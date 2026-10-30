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

高德需三项配置：Web JSAPI Key、securityJsCode，以及服务端逆地理编码使用的 Web 服务 Key（AMAP_REST_KEY）。定位经授权后转换为 GCJ-02，自动填写坐标、解析地址，并可建议 80 米内的 POI 店名；必须由用户确认实际门店。拒绝定位仍可手动选点。

## Secret 与变量

Cloudflare Worker secrets：`DATA_ENCRYPTION_KEY`、`PIPELINE_SECRET`、`GITHUB_TOKEN`、`GITHUB_CLIENT_SECRET`、`AMAP_SECURITY_JS_CODE`、`AMAP_REST_KEY`。其中 GITHUB_TOKEN 请使用专用细粒度 token，仅授权主项目与媒体仓库：主项目 Contents write（dispatch），媒体仓库 Contents write（Release 附件）。没有将本机 GitHub CLI 的全账号 token 复制到 Worker。

普通变量见 `wrangler.jsonc`：`APP_ORIGIN`、`GITHUB_REPO`、`MEDIA_REPO`、`REVIEWER_GITHUB_IDS`、`GITHUB_CLIENT_ID`、`AMAP_WEB_KEY`。OAuth App 的 callback 是 `https://food.zxymiku.top/auth/callback`。

数据加密密钥必须长期保存，丢失后无法解密既有草稿、会话和媒体；更换密钥需要先设计迁移。D1 中已公开地点按公开内容保存；待审稿、媒体索引和会话采用 AES-256-GCM。图片上传前移除 EXIF；视频会加密，但不承诺移除视频原有元数据。

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

页面“反馈”支持两种方式：手动打开本 Web 仓库的 Issues/new；自动填写标题、详情与最多 3 张截图，确认公开授权后直接创建 Web Issue。Android 的同类入口发往主项目仓库。

自动反馈需要登录 GitHub。新增可选 Worker Secret `FEEDBACK_GITHUB_TOKEN`，对主项目和 Web 两个仓库授权 **Issues: write**；未单独设置时回退使用 GITHUB_TOKEN，因此该 token 也需具备这两处 Issues 写权限。截图继续使用 GITHUB_TOKEN 的媒体仓库 Contents 写权限，最大 8 MB/张，上传前移除 EXIF，加密保存于媒体 Releases。

反馈正文仅附带主动填写的文字、平台和应用版本。明确选择并确认的截图通过独立随机链接提供给 GitHub 图片代理；不会把普通美食图片地址自动设为公开。草稿在 D1 中加密保存。网络结果不明确时保留同一表单和请求编号，再次点击只查询/恢复结果，避免重复 Issue。每用户每天最多自动提交 5 次；人工反馈由 GitHub 页面处理。

新增迁移 `0003_feedback.sql`，部署前执行 `npm run db:remote`。新增接口：POST `/api/feedback/screenshots`（JPEG/PNG 二进制）、POST `/api/feedback`（JSON，platform 为 web/android）、GET `/api/feedback/{id}/screenshots/{mediaId}?key=...`（仅对应反馈截图的随机公开链接）。配置接口返回两平台的手动反馈 URL 及服务配置状态。可选变量 `FEEDBACK_WEB_REPO` 可替换 Web 反馈仓库，Android 跟随 GITHUB_REPO。
