# 海克斯乱斗资料库 (lol-aram-guide)

League of Legends ARAM 社区套路网站。从抖音博主抓取 ARAM 出装套路，展示在 GitHub Pages 上。

## 技术栈

- **Next.js 16.2.9** (App Router, `output: "export"` 静态导出)
- **React 19**, **Tailwind CSS v4**
- **GitHub Pages** 部署 (`peaceiris/actions-gh-pages@v4` → gh-pages 分支)
- Pages 来源设置：**Deploy from a branch** (gh-pages, / (root))

## 目录结构

```
app/                          # Next.js App Router
  page.js                     # 首页 — 搜索英雄 + 卡片列表
  layout.js                   # 全局布局
  not-found.js
  champions/[id]/page.js      # 英雄详情页 — 展示该英雄的所有套路
  other-builds/page.js        # 未分类套路页
components/
  Navbar.js                   # 导航栏（版本号硬编码在 JSX 中）
  ChampionCard.js             # 英雄卡片
  SearchBar.js
data/
  champions.json              # 173 个英雄 + 48 个套路（39 个英雄有套路）
  other-builds.json           # 未分类套路
  version.json                # 游戏版本 + 更新时间
  .crawl-state.json           # 爬虫状态（已处理的视频 ID 列表）
  .crawl-cache/               # 爬虫缓存（音频转录等）
scripts/
  crawl-douyin.js             # 抖音爬虫主脚本
  douyin_user_videos.py       # Playwright 视频发现脚本
  update-data.js              # Riot Data Dragon 数据更新
```

## 数据管道

```
博主抖音主页 ─→ Playwright(douyin_user_videos.py) ─→ 视频 ID 列表
                                                          ↓
 每个视频: yt-dlp 下载 → ffmpeg 提音频 → SiliconFlow ASR → LLM 解析 → champions.json
                                                          ↓
                                            update-data.js(合并 Data Dragon 数据)
                                                          ↓
                                            next build → gh-pages 分支 → GitHub Pages
```

## GitHub Actions 工作流

| 工作流 | 触发 | 说明 |
|--------|------|------|
| `crawl-douyin.yml` | 每 3 天 / 手动 | 爬取抖音博主视频，提取套路，推送到 main |
| `update-data.yml` | 每日 14:00 CST | 从 Riot Data Dragon 更新英雄列表，保留已有套路 |
| `deploy-pages.yml` | push main / workflow_dispatch | 构建静态站点，部署到 gh-pages |

## 爬虫工作机制

### 视频发现 (douyin_user_videos.py)
- Playwright headless Chromium 打开博主主页
- 拦截 `/aweme/v1/web/aweme/post/` API 响应获取视频列表
- DOM 兜底：从页面 `<a href="/video/...">` 提取视频 ID
- `--days 25` 时间过滤（保留 DOM 视频即使没有时间戳）
- 最多 100 个视频

### 视频处理 (crawl-douyin.js)
- `yt-dlp` 下载视频（Playwright 兜底）
- `ffmpeg` 提取音频 → SiliconFlow ASR 语音转文字
- LLM (Qwen/QwQ-32B) 解析文案 → JSON 格式套路信息
- 保存到 `data/champions.json`，按英雄 ID 去重
- 已处理的视频 ID 记录到 `.crawl-state.json`

### 关键参数
- 并发: 3 (CRAWL_CONCURRENCY，CI 环境自动降为 2)
- LLM 模型: Qwen/QwQ-32B (LLM_MODEL)
- 时间过滤: `--days 25`（覆盖 6 月 12 日起）
- 重复检测: 按 `sourceUrl` 和 `title` 去重

## 已知注意事项

- 抖音 API 不按时间排序，需滚动页面触发更多 API 调用
- 抖音 API 需要 X-Bogus 签名，纯 HTTP 直连不可行
- GITHUB_TOKEN push 不触发其他 workflow，需 `gh workflow run` 显式触发
- 截图路径 `C:\Users\坤哥\AppData\Local\Temp\douyin_debug.png` 只在本地有效
- GitHub Actions 中 CRAWL_CONCURRENCY=2（预制 runner 资源有限），本地默认 3
- 英雄名称映射统一在 `data/name-mappings.json` 管理，`lib/name-mappings.js` 提供加载工具，两脚本共用
- 爬虫成功处理视频后自动删除 MP4/WAV 文件以节省空间，transcript 缓存保留
