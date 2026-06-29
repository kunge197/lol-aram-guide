/**
 * 抖音博主套路自动爬取脚本
 *
 * 按博主自动爬取最新视频 → 语音转文字 → AI 解析装备套路 → 更新数据库
 *
 * 环境变量:
 *   SILICONFLOW_API_KEY  - 硅基流动 API Key (语音识别)
 *   LLM_API_KEY          - 模型 API Key (文案解析，可复用 SILICONFLOW_API_KEY)
 *   LLM_BASE_URL         - API 地址 (默认 https://api.siliconflow.cn/v1)
 *   LLM_MODEL            - 模型名称 (默认 Qwen/QwQ-32B)
 *
 * 用法:
 *   node scripts/crawl-douyin.js                         # 爬取所有博主
 *   node scripts/crawl-douyin.js --url <视频链接>         # 处理单个视频
 *   node scripts/crawl-douyin.js --check                  # 只检查状态
 *   node scripts/crawl-douyin.js --urls-file <文件路径>   # 批量处理
 */

const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");
const crypto = require("crypto");

// ==================== 配置 ====================

const DATA_DIR = path.join(__dirname, "..", "data");
const CACHE_DIR = path.join(DATA_DIR, ".crawl-cache");
const STATE_FILE = path.join(DATA_DIR, ".crawl-state.json");
const CHAMPIONS_FILE = path.join(DATA_DIR, "champions.json");
const OTHER_BUILDS_FILE = path.join(DATA_DIR, "other-builds.json");

// 首次爬取只处理此日期之后的视频（第一次设为 2026-06-12）
// 之后自动更新为上次爬取时间
const FIRST_CRAWL_SINCE = new Date("2026-06-12T00:00:00+08:00").getTime() / 1000;

// ===== 博主配置 =====
const BLOGGERS = [
  {
    name: "皇子凡",
    url: "https://www.douyin.com/user/MS4wLjABAAAAahe2W9pdv6se5wgletSviwIzl6fZmhMlULAQsj14JRQ",
  },
  {
    name: "徐小涵哟",
    url: "https://www.douyin.com/user/MS4wLjABAAAA3N8rhvUVREVQ9FcT-N3JFYcKZpsGU80xWcH31WvAkpw",
  },
  {
    name: "乱斗嘟嘟嘟",
    url: "https://www.douyin.com/user/MS4wLjABAAAAqjSdAVxndnKen3vwkgaohrZv4DOHEq_9FhAHDT3FoOnSx_3mEcUI3y9bmncPaJUs",
  },
];

// ===== LLM 配置 =====
// 如果用 DeepSeek，设置环境变量：
//   LLM_BASE_URL=https://api.deepseek.com/v1
//   LLM_MODEL=deepseek-chat
const LLM_CONFIG = {
  apiKey: process.env.LLM_API_KEY || process.env.SILICONFLOW_API_KEY || "",
  baseURL: process.env.LLM_BASE_URL || "https://api.siliconflow.cn/v1",
  model: process.env.LLM_MODEL || "Qwen/QwQ-32B",
};

// ===== 请求头 =====
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
};

// ==================== 工具函数 ====================

function readJSON(filepath) {
  if (!fs.existsSync(filepath)) return null;
  return JSON.parse(fs.readFileSync(filepath, "utf-8"));
}

function writeJSON(filepath, data) {
  const dir = path.dirname(filepath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), "utf-8");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function log(...args) {
  console.log(`[${new Date().toLocaleString("zh-CN")}]`, ...args);
}

// ==================== 状态管理 ====================

function getState() {
  return readJSON(STATE_FILE) || {
    processedVideos: [],
    lastCrawlTime: null,
    firstCrawlDone: false,
  };
}

function saveState(state) {
  writeJSON(STATE_FILE, state);
}

function markCrawlDone() {
  const state = getState();
  state.lastCrawlTime = new Date().toISOString();
  state.firstCrawlDone = true;
  saveState(state);
}

function isVideoProcessed(videoId) {
  return getState().processedVideos.includes(videoId);
}

function markVideoProcessed(videoId) {
  const state = getState();
  if (!state.processedVideos.includes(videoId)) {
    state.processedVideos.push(videoId);
  }
  state.lastCrawlTime = new Date().toISOString();
  saveState(state);
}

// ==================== 博主视频发现 ====================

/**
 * 通过 Playwright 爬取博主主页，发现最新视频
 * 调用 douyin_user_videos.py 脚本
 */
async function discoverVideosFromBlogger(blogger) {
  log(`获取视频列表: ${blogger.name}`);

  const state = getState();
  // 计算时间过滤：首次爬取用固定日期，之后用上次爬取时间
  let sinceTime;
  if (!state.firstCrawlDone) {
    sinceTime = FIRST_CRAWL_SINCE;
    log(`  首次爬取，获取 ${new Date(FIRST_CRAWL_SINCE * 1000).toISOString().split("T")[0]} 后的视频`);
  } else {
    const lastCrawl = state.lastCrawlTime
      ? new Date(state.lastCrawlTime).getTime() / 1000 - 86400 // 多取1天容错
      : FIRST_CRAWL_SINCE;
    sinceTime = lastCrawl;
  }

  const scriptPath = path.join(__dirname, "douyin_user_videos.py");
  if (!fs.existsSync(scriptPath)) {
    log(`  ⚠️ douyin_user_videos.py 不存在，跳过自动发现`);
    return [];
  }

  const { execSync } = require("child_process");
  try {
    const daysSince = Math.max(1, Math.ceil((Date.now() / 1000 - sinceTime) / 86400));
    const output = execSync(
      `uv run --script "${scriptPath}" "${blogger.url}" --days ${daysSince}`,
      { timeout: 120000, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 }
    );
    const result = JSON.parse(output);

    if (result.error) {
      log(`  ❌ ${result.error}`);
      return [];
    }

    const videos = result.videos || [];
    log(`  发现 ${videos.length} 个视频`);

    return videos.map((v) => ({
      id: v.id,
      url: `https://www.douyin.com/video/${v.id}`,
      desc: (v.desc || "").substring(0, 80),
    }));
  } catch (e) {
    log(`  ❌ 获取视频列表失败: ${e.message}`);
    log(`  请用 --url 参数手动提供视频链接`);
    return [];
  }
}

function fetchWithRetry(url, options = {}, retries = 3) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      const protocol = url.startsWith("https") ? require("https") : require("http");
      const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;

      let opts = {
        headers: { ...HEADERS, ...options.headers },
        method: options.method || "GET",
      };

      // 代理支持
      if (proxyUrl) {
        const pu = new URL(proxyUrl);
        opts.host = pu.hostname;
        opts.port = pu.port;
        opts.path = url;
        opts.headers["Host"] = new URL(url).host;
      } else {
        opts.host = new URL(url).host;
        opts.path = new URL(url).pathname + new URL(url).search;
      }

      const req = protocol.request(opts, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else if (
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            resolve(fetchWithRetry(res.headers.location, options, retries));
          } else if (n > 0 && res.statusCode >= 500) {
            setTimeout(() => attempt(n - 1), 2000);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${url}`));
          }
        });
      });
      req.on("error", (e) => {
        if (n > 0) setTimeout(() => attempt(n - 1), 2000);
        else reject(e);
      });
      if (options.body) req.write(options.body);
      req.end();
    };
    attempt(retries);
  });
}

// ==================== 抖音视频解析 ====================

/**
 * 从文本中提取抖音分享链接
 */
function extractVideoUrl(text) {
  const match = text.match(/https?:\/\/(?:www\.)?douyin\.com\/video\/\S+/i);
  if (match) return match[0].split("?")[0];
  const match2 = text.match(/https?:\/\/v\.douyin\.com\/\S+/i);
  if (match2) return match2[0];
  return null;
}

/**
 * 解析抖音分享链接 → 无水印视频 URL + 视频 ID
 */
async function parseVideoInfo(shareUrl) {
  log(`  解析视频: ${shareUrl}`);

  // 1. 解析短链
  const finalUrl = await fetchWithRetry(shareUrl, { headers: { "Accept-Language": "zh-CN" } });
  let videoId = finalUrl.split("video/")[1]?.split("?")[0]?.split("/")[0];
  if (!videoId) {
    videoId = shareUrl.split("video/")[1]?.split("?")[0]?.split("/")[0];
  }
  if (!videoId) throw new Error("无法提取视频ID");

  // 2. 获取视频信息
  const detailUrl = `https://www.iesdouyin.com/share/video/${videoId}`;
  const html = await fetchWithRetry(detailUrl);

  const match = html.match(/window\._ROUTER_DATA\s*=\s*(.*?)<\/script>/s);
  if (!match) throw new Error("无法解析视频信息");

  const jsonData = JSON.parse(match[1].trim());
  const pageKey = Object.keys(jsonData.loaderData).find(
    (k) => k.includes("video") || k.includes("note")
  );
  if (!pageKey) throw new Error("未找到视频数据");

  const item = jsonData.loaderData[pageKey].videoInfoRes.item_list[0];
  const videoUrl = item.video.play_addr.url_list[0].replace("playwm", "play");
  const desc = (item.desc || `douyin_${videoId}`).replace(/[\\/:*?"<>|]/g, "_");

  return { videoId, videoUrl, title: desc };
}

// ==================== 语音识别 ====================

/**
 * 使用 SiliconFlow API 进行语音转文字
 */
async function transcribeAudio(audioPath, apiKey) {
  log(`  语音识别中...`);

  const client = new OpenAI({
    baseURL: "https://api.siliconflow.cn/v1",
    apiKey: apiKey,
  });

  const transcription = await client.audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model: "FunAudioLLM/SenseVoiceSmall",
    language: "zh",
    response_format: "text",
  });

  return transcription;
}

// ==================== AI 解析文案 ====================

const BUILD_PARSE_PROMPT = `你是一个英雄联盟海克斯大乱斗套路分析师。从以下抖音视频文案中提取套路信息。

要求：
1. 英雄名称用中文（如 萨科、金克斯）
2. 出装按视频中提到的顺序列出
3. 海克斯符文只列出视频中明确提到的
4. 套路名称要简洁有力

只返回 JSON 格式（不要 markdown 代码块）：
{
  "champion": "英雄中文名，无法确定填 null",
  "championEn": "英雄英文名如 Shaco，无法确定填 null",
  "buildTitle": "套路四字名称·副标题",
  "description": "一句话概括套路核心",
  "items": ["装备1", "装备2"],
  "hextechAugments": ["符文1", "符文2"]
}`;

async function parseBuildFromTranscript(transcript) {
  log(`  AI 解析文案中...`);

  const client = new OpenAI({
    baseURL: LLM_CONFIG.baseURL,
    apiKey: LLM_CONFIG.apiKey,
  });

  const completion = await client.chat.completions.create({
    model: LLM_CONFIG.model,
    messages: [
      { role: "system", content: "你是一个精确的结构化数据提取器，只返回 JSON。" },
      { role: "user", content: `${BUILD_PARSE_PROMPT}\n\n文案：\n${transcript}` },
    ],
    temperature: 0.1,
    response_format: { type: "json_object" },
  });

  const content = completion.choices[0]?.message?.content || "{}";

  try {
    return JSON.parse(content);
  } catch {
    const jm = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jm) return JSON.parse(jm[1]);
    throw new Error("LLM 返回无法解析");
  }
}

// ==================== 视频下载 ====================

async function downloadVideo(url, outputPath) {
  log(`  下载视频中...`);
  const data = await fetchWithRetry(url);
  fs.writeFileSync(outputPath, data);
}

function extractAudio(videoPath, audioPath) {
  log(`  提取音频中...`);
  const { execSync } = require("child_process");
  try {
    execSync(`ffmpeg -y -i "${videoPath}" -vn -ar 16000 -ac 1 "${audioPath}"`, {
      timeout: 120000,
      stdio: "pipe",
    });
  } catch {
    execSync(
      `python -m imageio_ffmpeg -y -i "${videoPath}" -vn -ar 16000 -ac 1 "${audioPath}"`,
      { timeout: 120000, stdio: "pipe" }
    );
  }
}

// ==================== 数据更新 ====================

function saveBuild(buildInfo, sourceUrl, author) {
  const buildEntry = {
    title: buildInfo.buildTitle || "未知套路",
    author: author || "@抖音博主",
    source: "抖音",
    sourceUrl,
    description: buildInfo.description || "",
    items: buildInfo.items || [],
    hextechAugments: buildInfo.hextechAugments || [],
    dateAdded: new Date().toISOString().split("T")[0],
  };

  const championName = buildInfo.champion || buildInfo.championEn || "";

  if (championName) {
    const champions = readJSON(CHAMPIONS_FILE) || [];
    let found = false;
    const q = championName.toLowerCase();

    for (const champ of champions) {
      const matchList = [
        champ.name,
        champ.nameEn,
        champ.title,
        ...(champ.aliases || []),
      ].map((s) => s.toLowerCase());

      if (matchList.some((m) => m === q || m.includes(q))) {
        if (!champ.builds) champ.builds = [];
        const exists = champ.builds.some(
          (b) => b.sourceUrl === sourceUrl || b.title === buildEntry.title
        );
        if (!exists) {
          champ.builds.push(buildEntry);
          log(`  ✅ 已添加到 ${champ.name}`);
        } else {
          log(`  ⏭️ ${champ.name} 已有此套路`);
        }
        found = true;
        break;
      }
    }

    if (!found) {
      log(`  ⚠️ 未匹配英雄「${championName}」，存入其他套路`);
      addToOtherBuilds(buildEntry, championName);
    }

    writeJSON(CHAMPIONS_FILE, champions);
  } else {
    addToOtherBuilds(buildEntry, null);
  }
}

function addToOtherBuilds(entry, possible) {
  const list = readJSON(OTHER_BUILDS_FILE) || [];
  const exists = list.some((b) => b.sourceUrl === entry.sourceUrl);
  if (!exists) {
    const item = { ...entry, id: `other_${Date.now()}_${crypto.randomBytes(2).toString("hex")}` };
    if (possible) item.possibleChampions = [possible];
    list.push(item);
    writeJSON(OTHER_BUILDS_FILE, list);
    log(`  ✅ 已添加到其他套路`);
  }
}

// ==================== 主流程 ====================

async function processVideo(shareUrl, author = "@抖音博主") {
  const videoId = shareUrl.split("video/")[1]?.split("?")[0];
  if (!videoId) { log(`  ❌ 无效链接: ${shareUrl}`); return; }
  if (isVideoProcessed(videoId)) { log(`  ⏭️ 已处理: ${videoId}`); return; }

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const vp = path.join(CACHE_DIR, `${videoId}.mp4`);
  const ap = path.join(CACHE_DIR, `${videoId}.wav`);

  try {
    log(`处理: ${shareUrl}`);
    const info = await parseVideoInfo(shareUrl);
    log(`  标题: ${info.title}`);

    if (!fs.existsSync(vp)) await downloadVideo(info.videoUrl, vp);
    if (!fs.existsSync(ap)) extractAudio(vp, ap);

    const apiKey = process.env.SILICONFLOW_API_KEY;
    if (!apiKey) throw new Error("请设置 SILICONFLOW_API_KEY");

    const text = await transcribeAudio(ap, apiKey);
    log(`  文案 ${text.length} 字`);

    if (text.length < 10) { log(`  ⚠️ 文案过短`); return; }

    const build = await parseBuildFromTranscript(text);
    log(`  解析: ${build.buildTitle || "?"} → ${build.champion || "?"}`);

    saveBuild(build, shareUrl, author);
    markVideoProcessed(videoId);
    log(`  ✅ 完成`);
  } catch (e) {
    log(`  ❌ ${e.message}`);
    markVideoProcessed(videoId); // 避免反复重试
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (!process.env.SILICONFLOW_API_KEY && !process.env.LLM_API_KEY) {
    console.error("请设置 SILICONFLOW_API_KEY 环境变量");
    process.exit(1);
  }

  // --check
  if (args.includes("--check")) {
    const state = getState();
    console.log(`已处理: ${state.processedVideos.length} 个视频`);
    console.log(`上次爬取: ${state.lastCrawlTime || "从未"}`);
    return;
  }

  // --url <link>
  const ui = args.indexOf("--url");
  if (ui !== -1 && args[ui + 1]) {
    const url = extractVideoUrl(args[ui + 1]);
    if (!url) { console.error("无效链接"); process.exit(1); }
    await processVideo(url, args.includes("--author") ? args[args.indexOf("--author") + 1] : "@抖音博主");
    return;
  }

  // --urls-file <path>
  const fi = args.indexOf("--urls-file");
  if (fi !== -1 && args[fi + 1]) {
    const content = fs.readFileSync(args[fi + 1], "utf-8");
    const urls = content.split("\n").map((l) => extractVideoUrl(l)).filter(Boolean);
    log(`批量处理 ${urls.length} 个视频`);
    for (let i = 0; i < urls.length; i++) {
      log(`[${i + 1}/${urls.length}]`);
      await processVideo(urls[i]);
      await sleep(3000);
    }
    return;
  }

  if (BLOGGERS.length === 0) {
    console.log("用法:");
    console.log("  node scripts/crawl-douyin.js --url <抖音链接>");
    console.log("  node scripts/crawl-douyin.js --urls-file <文件路径>");
    console.log("  node scripts/crawl-douyin.js --check");
    console.log("\n提示: 在脚本顶部 BLOGGERS 数组中配置博主后，可自动爬取");
    return;
  }

  // 博主模式
  log("开始爬取博主视频...");

  for (const blogger of BLOGGERS) {
    log(`\n===== ${blogger.name} =====`);
    const videos = await discoverVideosFromBlogger(blogger);

    for (let i = 0; i < videos.length; i++) {
      const v = videos[i];
      log(`\n[${i + 1}/${videos.length}] ${v.desc || v.id}`);
      await processVideo(v.url, `@${blogger.name}`);
      await sleep(3000);
    }
  }

  markCrawlDone();
  log("\n===== 爬取完成 =====");
}

main().catch((e) => {
  console.error("失败:", e.message);
  process.exit(1);
});
