/**
 * 抖音博主套路自动爬取脚本 (v2)
 *
 * 管线: 视频发现(Douyin API) → 下载(yt-dlp) → 音频提取(ffmpeg)
 *       → 语音识别(SiliconFlow) → AI解析(LLM) → 更新数据
 *
 * 相比 v1 改进:
 *   - 视频发现直接用 Douyin Web API，无需 Playwright
 *   - 视频下载 yt-dlp 主力，Playwright 降级为兜底
 *   - 并发处理池(默认 3 路并行)
 *   - 转写结果按视频ID缓存，避免重复调用
 *   - 失败视频入重试队列，不丢数据
 *
 * 环境变量:
 *   SILICONFLOW_API_KEY  - 硅基流动 API Key (语音识别)
 *   LLM_API_KEY          - 模型 API Key (文案解析)
 *   LLM_BASE_URL         - API 地址
 *   LLM_MODEL            - 模型名称, 默认 Qwen/QwQ-32B
 *   HTTPS_PROXY          - 代理地址 (可选)
 *
 * 用法:
 *   node scripts/crawl-douyin.js                         # 爬取所有博主
 *   node scripts/crawl-douyin.js --url <视频链接>         # 处理单个视频
 *   node scripts/crawl-douyin.js --check                  # 只检查状态
 *   node scripts/crawl-douyin.js --urls-file <文件路径>   # 批量处理
 *   node scripts/crawl-douyin.js --refresh-cookies        # 只刷新 cookie
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const crypto = require("crypto");
const { execSync } = require("child_process");
const OpenAI = require("openai");
const { getNicknameMap } = require("../lib/name-mappings");

// ==================== 配置 ====================

const DATA_DIR = path.join(__dirname, "..", "data");
const CACHE_DIR = path.join(DATA_DIR, ".crawl-cache");
const STATE_FILE = path.join(DATA_DIR, ".crawl-state.json");
const CHAMPIONS_FILE = path.join(DATA_DIR, "champions.json");
/** processedVideos 最大保留数量，超出时裁剪旧记录，避免文件无限增长 */
const MAX_PROCESSED_VIDEOS = 200;
const OTHER_BUILDS_FILE = path.join(DATA_DIR, "other-builds.json");
const COOKIE_FILE = path.join(CACHE_DIR, "douyin_cookies.txt");
const CONCURRENCY = parseInt(process.env.CRAWL_CONCURRENCY || "3", 10);

const BLOGGERS = [
  { name: "皇子凡", url: "https://www.douyin.com/user/MS4wLjABAAAAahe2W9pdv6se5wgletSviwIzl6fZmhMlULAQsj14JRQ" },
  { name: "徐小涵哟", url: "https://www.douyin.com/user/MS4wLjABAAAA3N8rhvUVREVQ9FcT-N3JFYcKZpsGU80xWcH31WvAkpw" },
  { name: "乱斗螃蟹", url: "https://www.douyin.com/user/MS4wLjABAAAAOOMS8jMWctkdFEDcIdqtblfig_6OHuk_ghCVU89spYo" },
  { name: "乱斗老王（原名极地老王）", url: "https://www.douyin.com/user/MS4wLjABAAAAj5tp1gc6MzrFud6fu_F_HzQ5iqbxvODkW6WOyylsjog" },
];

const LLM_CONFIG = {
  apiKey: process.env.LLM_API_KEY || process.env.SILICONFLOW_API_KEY || "",
  baseURL: process.env.LLM_BASE_URL || "https://api.siliconflow.cn/v1",
  model: process.env.LLM_MODEL || "Qwen/QwQ-32B",
};

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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

function proxyAgent(urlStr) {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  if (!proxyUrl) return null;
  const pu = new URL(proxyUrl);
  const isHttps = urlStr.startsWith("https");
  return { host: pu.hostname, port: parseInt(pu.port, 10), protocol: isHttps ? "https" : "http" };
}

// ==================== 状态管理 ====================

function getState() {
  return readJSON(STATE_FILE) || { processedVideos: [], lastCrawlTime: null, firstCrawlDone: false };
}

function saveState(state) {
  writeJSON(STATE_FILE, state);
}

function isVideoProcessed(videoId) {
  return getState().processedVideos.includes(videoId);
}

function markVideoProcessed(videoId) {
  const state = getState();
  if (!state.processedVideos.includes(videoId)) {
    state.processedVideos.push(videoId);
  }
  // 限制数组大小，防止无限增长
  if (state.processedVideos.length > MAX_PROCESSED_VIDEOS) {
    state.processedVideos = state.processedVideos.slice(-MAX_PROCESSED_VIDEOS);
  }
  state.lastCrawlTime = new Date().toISOString();
  saveState(state);
}

function markCrawlDone() {
  const state = getState();
  state.lastCrawlTime = new Date().toISOString();
  state.firstCrawlDone = true;
  saveState(state);
}

// ==================== Cookie 管理 ====================

/**
 * 通过 Playwright 获取抖音 cookie
 * 抖音的 s_v_web_id 由 JS 在客户端生成，纯 HTTP 请求无法获取
 */
async function fetchCookieViaPlaywright() {
  try {
    const pyScript = path.join(__dirname, "get_douyin_cookies.py");
    if (fs.existsSync(pyScript)) {
      execSync(`uv run --script "${pyScript}"`, { timeout: 30000, stdio: "pipe" });
      return true;
    }
  } catch (e) {
    log(`  ⚠️ Playwright 获取 cookie 失败: ${e.message}`);
  }
  return false;
}

/**
 * 获取可用的 cookie 字符串
 * 先用缓存的 cookie，失效后通知用户刷新
 */
async function getCookies() {
  if (!fs.existsSync(COOKIE_FILE)) {
    log("  ⚠️ 未找到 cookie 文件，请先运行 --refresh-cookies");
    return "";
  }

  const raw = fs.readFileSync(COOKIE_FILE, "utf-8");
  const lines = raw.split("\n").filter((l) => l && !l.startsWith("#"));
  const cookieParts = [];
  for (const line of lines) {
    const p = line.trim().split("\t");
    if (p.length >= 7) {
      const name = p[5];
      const value = p[6].replace(/\r$/, "");
      if (name) cookieParts.push(`${name}=${value}`);
    }
  }
  // 清理 cookie 值中的非法字符 (HTTP 头不允许控制字符)
  const cookieStr = cookieParts.join("; ").replace(/[\r\n\0]/g, "");

  // 检查是否包含关键 cookie
  const hasSvid = cookieParts.some((p) => p.startsWith("s_v_web_id="));
  if (!hasSvid) {
    log("  ⚠️ cookie 缺少 s_v_web_id，尝试重新获取...");
    await refreshCookies();
    return getCookies();
  }

  return cookieStr;
}

// ==================== 视频发现 ====================

/**
 * 通过 Playwright 脚本发现视频
 * 用临时文件传递 JSON 结果，避免 Windows 管道编码问题
 */
async function discoverVideosViaPlaywright(blogger) {
  const scriptPath = path.join(__dirname, "douyin_user_videos.py");
  if (!fs.existsSync(scriptPath)) return [];

  const MAX_RETRIES = 2;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const tmpFile = path.join(CACHE_DIR, `discover_${Date.now()}_${attempt}.json`);
      execSync(
        `uv run --script "${scriptPath}" "${blogger.url}" --days 25 > "${tmpFile}"`,
        { timeout: 180000, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 }
      );

      const raw = fs.readFileSync(tmpFile, "utf-8");
      const jsonStart = raw.indexOf("{");
      if (jsonStart === -1) {
        if (attempt < MAX_RETRIES) { log(`  重试 ${attempt + 1}/${MAX_RETRIES}...`); continue; }
        return [];
      }
      const result = JSON.parse(raw.substring(jsonStart));

      try { fs.unlinkSync(tmpFile); } catch {}

      if (result.error) return [];
      return (result.videos || []).map((v) => ({
        id: v.id,
        desc: (v.desc || "").substring(0, 80),
        create_time: v.create_time || 0,
      }));
    } catch (e) {
      if (attempt < MAX_RETRIES) {
        log(`  ⚠️ Playwright 失败 (${attempt + 1}/${MAX_RETRIES}): ${e.message}，重试...`);
        await sleep(3000 * (attempt + 1));
      } else {
        log(`  ❌ Playwright 最终失败: ${e.message}`);
        return [];
      }
    }
  }
  return [];
}

/**
 * 发现博主视频
 */
async function discoverVideos(blogger) {
  log(`发现视频: ${blogger.name}`);
  const videos = await discoverVideosViaPlaywright(blogger);
  log(`  发现 ${videos.length} 个视频`);
  if (videos.length === 0) {
    log(`  ⚠️ 未发现视频，可能原因：`);
    log(`     - 抖音页面结构已变更（检查 douyin_user_videos.py 的拦截 API 路径）`);
    log(`     - Cookie 已过期（运行 --refresh-cookies 刷新）`);
    log(`     - 博主 ${blogger.name} 近 25 天未发布新视频`);
  }
  return videos;
}

// ==================== 视频下载 ====================

/**
 * yt-dlp 下载视频
 */
async function downloadWithYtdlp(videoUrl, outputPath) {
  log(`  yt-dlp 下载中...`);
  const cookieArg = fs.existsSync(COOKIE_FILE) ? `--cookies "${COOKIE_FILE}"` : "";
  try {
    execSync(
      `uv run --with yt-dlp -- python -m yt_dlp --no-warnings ${cookieArg} -o "${outputPath}" "${videoUrl}"`,
      { timeout: 180000, stdio: "pipe" }
    );
    return fs.existsSync(outputPath) && fs.statSync(outputPath).size > 10000;
  } catch (e) {
    log(`  ⚠️ yt-dlp 失败: ${e.message}`);
    return false;
  }
}

/**
 * 兜底: Playwright 下载
 */
async function downloadWithPlaywright(videoUrl, outputPath) {
  const dlScript = path.join(__dirname, "douyin_video_dl.py");
  if (!fs.existsSync(dlScript)) return false;

  try {
    const output = execSync(
      `uv run --script "${dlScript}" "${videoUrl}" "${outputPath}"`,
      { timeout: 300000, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024, env: { ...process.env, PYTHONIOENCODING: "utf-8" } }
    );
    const result = JSON.parse(output.trim());
    return result.success === true;
  } catch {
    return false;
  }
}

async function fetchWithRetry(urlStr, options = {}, retries = 3) {
  for (let i = retries; i > 0; i--) {
    try {
      const proxy = proxyAgent(urlStr);
      const url = new URL(urlStr);
      const opts = {
        hostname: proxy ? proxy.host : url.hostname,
        port: proxy ? proxy.port : (url.protocol === "https:" ? 443 : 80),
        path: proxy ? urlStr : url.pathname + url.search,
        method: options.method || "GET",
        headers: { "User-Agent": UA, ...(options.headers || {}) },
      };
      if (proxy) opts.headers["Host"] = url.host;

      return await new Promise((resolve, reject) => {
        const mod = (proxy ? url.protocol === "https:" : url.protocol === "https:") ? https : http;
        const req = mod.request(opts, (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            if (res.statusCode >= 200 && res.statusCode < 300) resolve(data);
            else if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              fetchWithRetry(res.headers.location, options, i).then(resolve).catch(reject);
            } else if (i > 1 && res.statusCode >= 500) {
              reject(new Error(`HTTP ${res.statusCode}, retrying...`));
            } else reject(new Error(`HTTP ${res.statusCode}`));
          });
        });
        req.on("error", (e) => i > 1 ? reject(e) : reject(e));
        if (options.body) req.write(options.body);
        req.setTimeout(60000, () => { req.destroy(); reject(new Error("Timeout")); });
        req.end();
      });
    } catch (e) {
      if (i <= 1) throw e;
      await sleep(2000 * (retries - i + 1));
    }
  }
}

/**
 * 下载视频 + 获取元信息: yt-dlp 优先，Playwright 兜底
 */
async function downloadVideo(videoUrl, videoId) {
  const mp4Path = path.join(CACHE_DIR, `${videoId}.mp4`);
  if (fs.existsSync(mp4Path) && fs.statSync(mp4Path).size > 10000) {
    return mp4Path;
  }

  // yt-dlp
  const ok = await downloadWithYtdlp(videoUrl, mp4Path);
  if (ok) return mp4Path;

  // 兜底
  log(`  yt-dlp 失败，尝试 Playwright...`);
  const ok2 = await downloadWithPlaywright(videoUrl, mp4Path);
  if (ok2) return mp4Path;

  throw new Error("所有下载方式均失败");
}

// ==================== 音频提取 ====================

function extractAudio(videoPath, audioPath) {
  if (fs.existsSync(audioPath) && fs.statSync(audioPath).size > 1000) return true;

  try {
    execSync(`ffmpeg -y -i "${videoPath}" -vn -ar 16000 -ac 1 "${audioPath}"`, {
      timeout: 120000, stdio: "pipe",
    });
    return fs.existsSync(audioPath) && fs.statSync(audioPath).size > 1000;
  } catch (e) {
    log(`  ⚠️ 音频提取失败: ${e.message}`);
    log(`     视频路径: ${videoPath}`);
    return false;
  }
}

// ==================== 独立音频下载 ====================

/**
 * 下载独立 mp3 音频 (从抖音 API 返回的 audio_url)
 * 绕过 HE-AACv2 解码问题
 */
async function downloadIndependentAudio(audioUrl, audioPath) {
  if (!audioUrl) return false;
  try {
    const mp3Path = audioPath.replace(/\.wav$/, ".mp3");
    const data = await fetchWithRetry(audioUrl);
    fs.writeFileSync(mp3Path, data);
    execSync(`ffmpeg -y -i "${mp3Path}" -vn -ar 16000 -ac 1 "${audioPath}"`, {
      timeout: 120000, stdio: "pipe",
    });
    return fs.existsSync(audioPath) && fs.statSync(audioPath).size > 1000;
  } catch {
    return false;
  }
}

// ==================== 语音识别 (带缓存) ====================

function getTranscriptCache(videoId) {
  const cacheFile = path.join(CACHE_DIR, `${videoId}.transcript.json`);
  if (fs.existsSync(cacheFile)) {
    return JSON.parse(fs.readFileSync(cacheFile, "utf-8"));
  }
  return null;
}

function setTranscriptCache(videoId, transcript) {
  const cacheFile = path.join(CACHE_DIR, `${videoId}.transcript.json`);
  writeJSON(cacheFile, {
    videoId,
    transcript,
    cachedAt: new Date().toISOString(),
  });
}

async function transcribeAudio(audioPath, apiKey) {
  log(`  语音识别中...`);

  const client = new OpenAI({
    baseURL: "https://api.siliconflow.cn/v1",
    apiKey: apiKey,
  });

  let filePath = audioPath;
  if (!fs.existsSync(audioPath) || fs.statSync(audioPath).size < 1000) {
    const mp4Path = audioPath.replace(/\.wav$/, ".mp4");
    if (fs.existsSync(mp4Path) && fs.statSync(mp4Path).size > 10000) {
      filePath = mp4Path;
      log(`  使用 mp4 直接转写`);
    }
  }

  const result = await client.audio.transcriptions.create({
    file: fs.createReadStream(filePath),
    model: "FunAudioLLM/SenseVoiceSmall",
    language: "zh",
  });

  return typeof result === "string" ? result : (result.text || "");
}

// ==================== AI 解析文案 ====================

const BUILD_PARSE_PROMPT = `你是一个英雄联盟海克斯大乱斗套路分析师。从以下抖音视频文案中提取套路信息。

核心任务：**必须识别出英雄是谁**，这是最高优先级。

英雄识别规则：
1. **#标签最高优先级** — 视频标题/描述中的 #英雄名（如 #蔚、#金克斯、#亚索）是识别英雄的最可靠依据
2. **文案推理** — 如果视频#标签被截断或不全，从文案内容推断英雄（如提到"E技能"、"Q技能"、英雄特性描述等）
3. **宁可猜测不要空** — 如果 70% 以上确定某个英雄，就输出它，不要输出 null
4. **"小丑学院"是海克斯符文名称**，不是英雄"恶魔小丑"
5. 这是 LOL 海克斯大乱斗（ARAM）模式，不是召唤师峡谷

英雄名称要求：
- champion 字段用 **最常用的中文称呼**，例如：
  - 亚索（不是疾风剑豪）、金克丝（不是暴走萝莉）、布兰德（不是火男，但火男也可接受）
  - 如果英雄有通行中文简称可用简称（盖伦、德莱文、VN）
- championEn 字段用 **英文名**（如 Yasuo、Jinx、Brand），必须首字母大写

输出格式要求：
- 出装按视频中提到的顺序列出
- 海克斯符文只列出视频中明确提到的
- 套路名称简洁有力（如 "暴击收割·海克斯弹射流"）
- description 一句话概括核心玩法

**如果文案内容不是套路教学（如纯娱乐、剪辑、无关内容），buildTitle 返回 null，不要编造名称。**

只返回 JSON 格式（不要 markdown 代码块）：
{
  "champion": "英雄中文名/常用称呼，无法确定填 null",
  "championEn": "英雄英文名首字母大写，如 Yasuo、Jinx、Brand，无法确定填 null",
  "buildTitle": "套路名称·副标题，无法识别返回 null",
  "description": "一句话概括套路核心",
  "items": ["装备1", "装备2"],
  "hextechAugments": ["符文1", "符文2"]
}`;

async function parseBuildFromTranscript(transcript, title = "") {
  log(`  AI 解析文案中...`);

  const client = new OpenAI({
    baseURL: LLM_CONFIG.baseURL,
    apiKey: LLM_CONFIG.apiKey,
  });

  let userContent = BUILD_PARSE_PROMPT;
  if (title) userContent += `\n\n视频标题/描述：${title}`;
  userContent += `\n\n文案：\n${transcript}`;

  // 指数退避重试
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const completion = await client.chat.completions.create({
        model: LLM_CONFIG.model,
        messages: [
          {
            role: "system",
            content: "你必须只输出符合要求 JSON 对象，不要输出任何其他文字、思考过程、或 markdown 代码块标记。直接输出原始 JSON。",
          },
          { role: "user", content: userContent },
        ],
        temperature: 0.1,
      });

      let content = completion.choices[0]?.message?.content || "{}";

      // 剥离推理模型的 思考过程
      content = content.replace(/^[\s\S]*?```(?:json)?\s*/m, "").replace(/\s*```[\s\S]*$/m, "");
      content = content.replace(/^[\s\S]*?(\{)/m, "$1").replace(/(\})[\s\S]*$/m, "$1");

      try { return JSON.parse(content); }
      catch {
        const jm = content.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jm) return JSON.parse(jm[1]);
        throw new Error("LLM 返回无法解析");
      }
    } catch (e) {
      lastErr = e;
      if (attempt < 2) {
        const wait = Math.pow(2, attempt) * 2000;
        log(`  ⚠️ LLM 调用失败，${wait / 1000}s 后重试: ${e.message}`);
        await sleep(wait);
      }
    }
  }
  throw lastErr || new Error("LLM 调用失败");
}

// ==================== 昵称 → 英雄映射表 ====================

/**
 * 从 data/name-mappings.json 加载统一映射表。
 * 如需增删映射，请编辑 data/name-mappings.json 而非此处。
 * 此文件与 scripts/update-data.js 共用同一份映射，无需同步维护。
 */
const NICKNAME_MAP = getNicknameMap();

/** 通过昵称查找英雄 ID */
function resolveChampionId(name) {
  if (!name || name === "null") return null;
  // 尝试直接匹配 nickname map (键全小写)
  const normalized = name.trim().toLowerCase();
  if (NICKNAME_MAP[normalized]) return NICKNAME_MAP[normalized];

  // 尝试匹配 champions.json 中的 name / nameEn / title / aliases
  const champions = readJSON(CHAMPIONS_FILE) || [];
  for (const champ of champions) {
    const matchList = [champ.name, champ.nameEn, champ.title, ...(champ.aliases || [])].map(s => s.toLowerCase());
    if (matchList.some(m => m === normalized || m.includes(normalized))) {
      return champ.id;
    }
  }

  return null;
}

// ==================== 数据更新 ====================

function saveBuild(buildInfo, sourceUrl, author) {
  const title = buildInfo.buildTitle || "未知套路";
  const items = buildInfo.items || [];

  // 过滤无效套路：LLM 无法识别内容
  const invalidTitles = ["未知套路", "无法识别"];
  if (invalidTitles.includes(title) || (title.includes("无法") && items.length === 0)) {
    log(`  ⏭️ 跳过无效套路（${title}）`);
    return;
  }

  const buildEntry = {
    title,
    author: author || "@抖音博主",
    source: "抖音",
    sourceUrl,
    description: buildInfo.description || "",
    items,
    hextechAugments: buildInfo.hextechAugments || [],
    dateAdded: new Date().toISOString().split("T")[0],
  };

  // 按优先级尝试解析英雄: championEn(英文名最精确) > champion(中文名/昵称)
  const champId = resolveChampionId(buildInfo.championEn) || resolveChampionId(buildInfo.champion);
  const championName = buildInfo.champion || buildInfo.championEn || "";

  if (champId) {
    const champions = readJSON(CHAMPIONS_FILE) || [];
    const champ = champions.find((c) => c.id === champId);
    if (champ) {
      if (!champ.builds) champ.builds = [];
      const exists = champ.builds.some((b) => b.sourceUrl === sourceUrl || b.title === buildEntry.title);
      if (!exists) {
        champ.builds.push(buildEntry);
        log(`  ✅ 已添加到 ${champ.name} (${champ.nameEn})`);
      } else {
        log(`  ⏭️ ${champ.name} 已有此套路`);
      }
      writeJSON(CHAMPIONS_FILE, champions);
    } else {
      addToOtherBuilds(buildEntry, championName || null);
    }
  } else if (championName && championName !== "null") {
    log(`  ⚠️ 未匹配英雄「${championName}」，存入其他套路`);
    addToOtherBuilds(buildEntry, championName);
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

// ==================== 视频处理管线 ====================

async function processVideo(shareUrl, author = "@抖音博主") {
  const videoId = shareUrl.split("video/")[1]?.split("?")[0];
  if (!videoId) { log(`  ❌ 无效链接: ${shareUrl}`); return; }
  if (isVideoProcessed(videoId)) { log(`  ⏭️ 已处理: ${videoId}`); return; }

  fs.mkdirSync(CACHE_DIR, { recursive: true });

  try {
    log(`处理: ${shareUrl}`);

    // 1. 视频下载
    const videoPath = await downloadVideo(shareUrl, videoId);

    // 2. 音频提取
    const audioPath = path.join(CACHE_DIR, `${videoId}.wav`);
    const audioExtracted = extractAudio(videoPath, audioPath);

    // 3. 语音识别 (优先用缓存)
    let transcript = null;
    const cached = getTranscriptCache(videoId);
    if (cached) {
      transcript = cached.transcript;
      log(`  使用缓存的转录 (${transcript.length} 字)`);
    }

    if (!transcript) {
      const apiKey = process.env.SILICONFLOW_API_KEY;
      if (!apiKey) throw new Error("请设置 SILICONFLOW_API_KEY");

      if (audioExtracted) {
        transcript = await transcribeAudio(audioPath, apiKey);
      } else {
        // 直接传 mp4
        transcript = await transcribeAudio(videoPath, apiKey);
      }

      if (transcript && transcript.length >= 10) {
        setTranscriptCache(videoId, transcript);
      }
    }

    if (!transcript || transcript.length < 10) {
      log(`  ⚠️ 文案过短或为空`);
      markVideoProcessed(videoId);
      return;
    }
    log(`  文案 ${transcript.length} 字`);

    // 4. 获取视频标题 (从缓存 meta 或 yt-dlp 输出)
    let title = "";
    const metaFile = path.join(CACHE_DIR, `${videoId}.meta.json`);
    if (fs.existsSync(metaFile)) {
      title = JSON.parse(fs.readFileSync(metaFile, "utf-8")).title || "";
    } else {
      // 尝试从 yt-dlp 获取标题 (--print title)
      try {
        title = execSync(
          `uv run --with yt-dlp -- python -m yt_dlp --no-warnings --print title "${shareUrl}"`,
          { timeout: 30000, encoding: "utf-8", stdio: "pipe" }
        ).trim();
      } catch { /* ignore */ }
    }

    // 5. AI 解析
    const build = await parseBuildFromTranscript(transcript, title);
    log(`  解析: ${build.buildTitle || "?"} → ${build.champion || "?"}`);

    // 6. 保存
    saveBuild(build, shareUrl, author);
    markVideoProcessed(videoId);
    log(`  ✅ 完成`);

    // 清理视频文件（保留转录缓存）
    try { if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath); } catch {}
    try { if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath); } catch {}
  } catch (e) {
    log(`  ❌ ${e.message}`);
    // 失败时不做 markVideoProcessed，下次重试
  }
}

// ==================== 并发池 ====================

async function asyncPool(array, concurrency, iteratorFn) {
  const results = [];
  const executing = new Set();

  for (const [index, item] of array.entries()) {
    const p = Promise.resolve().then(() => iteratorFn(item, index));
    results.push(p);
    executing.add(p);

    const clean = () => executing.delete(p);
    p.then(clean, clean);

    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }

  return Promise.allSettled(results);
}

// ==================== 刷新 Cookie ====================

async function refreshCookies() {
  log("刷新 cookie...");
  const ok = await fetchCookieViaPlaywright();
  if (ok) {
    log(`  ✅ Cookie 已保存`);
  } else {
    log(`  ❌ 获取 cookie 失败`);
  }
}

// ==================== 主流程 ====================

async function main() {
  const args = process.argv.slice(2);

  // 启动时验证 NICKNAME_MAP 的 hero ID 是否有效
  const champions = readJSON(CHAMPIONS_FILE) || [];
  const validIds = new Set(champions.map((c) => c.id));
  const brokenMappings = Object.entries(NICKNAME_MAP).filter(([, id]) => !validIds.has(id));
  if (brokenMappings.length > 0) {
    log(`⚠️ NICKNAME_MAP 中有 ${brokenMappings.length} 个无效的 hero ID:`);
    for (const [name, id] of brokenMappings) {
      log(`  ${name} → ${id} (champions.json 中不存在)`);
    }
  }
  // 验证 builds 数据完整性
  for (const champ of champions) {
    if (champ.builds) {
      for (const build of champ.builds) {
        if (!build.sourceUrl) {
          log(`⚠️ ${champ.name} 缺少 sourceUrl 的套路: ${build.title}`);
        }
      }
    }
  }

  // --refresh-cookies、--check、--dry-run 不需要 API Key
  if (args.includes("--check") || args.includes("--refresh-cookies") || args.includes("--dry-run")) {
    // 跳过 API key 检查
  } else if (!process.env.SILICONFLOW_API_KEY && !process.env.LLM_API_KEY) {
    console.error("请设置 SILICONFLOW_API_KEY 环境变量");
    console.error("  爬取视频需要 API Key 进行语音识别和文案解析");
    console.error("  可以先试试: node scripts/crawl-douyin.js --refresh-cookies");
    process.exit(1);
  }

  // --refresh-cookies
  if (args.includes("--refresh-cookies")) {
    await refreshCookies();
    return;
  }

  // --check
  if (args.includes("--check")) {
    const state = getState();
    console.log(`已处理: ${state.processedVideos.length} 个视频`);
    console.log(`上次爬取: ${state.lastCrawlTime || "从未"}`);
    console.log(`首次爬取完成: ${state.firstCrawlDone}`);
    return;
  }

  // 确保 cookie 存在
  if (!fs.existsSync(COOKIE_FILE)) {
    await refreshCookies();
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
    log(`批量处理 ${urls.length} 个视频 (并发: ${CONCURRENCY})`);
    await asyncPool(urls, CONCURRENCY, async (url) => {
      await processVideo(url);
    });
    return;
  }

  // 博主模式
  if (BLOGGERS.length === 0) {
    console.log("用法:");
    console.log("  node scripts/crawl-douyin.js                         # 爬取所有博主");
    console.log("  node scripts/crawl-douyin.js --url <抖音链接>        # 处理单个视频");
    console.log("  node scripts/crawl-douyin.js --urls-file <文件路径>  # 批量处理");
    console.log("  node scripts/crawl-douyin.js --dry-run               # 发现但不处理");
    console.log("  node scripts/crawl-douyin.js --check                 # 检查状态");
    console.log("  node scripts/crawl-douyin.js --refresh-cookies       # 刷新 cookie");
    return;
  }

  log(`爬取启动 (并发: ${CONCURRENCY})`);

  // 1. 发现所有博主的视频
  const allVideos = [];
  for (const blogger of BLOGGERS) {
    log(`\n===== ${blogger.name} =====`);
    const videos = await discoverVideos(blogger);
    for (const v of videos) {
      allVideos.push({ ...v, author: `@${blogger.name}` });
    }
  }

  // 去重
  const seen = new Set();
  const uniqueVideos = allVideos.filter((v) => {
    if (seen.has(v.id)) return false;
    seen.add(v.id);
    return true;
  });

  log(`\n共发现 ${uniqueVideos.length} 个待处理视频`);

  // --dry-run: 只发现不处理
  if (args.includes("--dry-run")) {
    log("\n===== DRY RUN 模式，不执行处理 =====");
    log("设置 SILICONFLOW_API_KEY 和 LLM_API_KEY 后可开始真实爬取");
    for (const v of uniqueVideos) {
      log(`  ${v.id} | ${v.desc || "(无描述)"} | ${v.author}`);
    }
    return;
  }

  if (uniqueVideos.length === 0) {
    log("没有新视频需要处理");
    markCrawlDone();
    return;
  }

  // 2. 并发处理
  let success = 0;
  let failed = 0;

  await asyncPool(uniqueVideos, CONCURRENCY, async (v, i) => {
    const url = `https://www.douyin.com/video/${v.id}`;
    log(`\n[${i + 1}/${uniqueVideos.length}] ${v.desc || v.id}`);
    try {
      await processVideo(url, v.author);
      success++;
    } catch {
      failed++;
    }
  });

  // 3. 收尾
  markCrawlDone();
  log(`\n===== 爬取完成 =====`);
  log(`成功: ${success} / 失败: ${failed} / 总计: ${uniqueVideos.length}`);
}

/**
 * 从文本中提取抖音分享链接
 */
function extractVideoUrl(text) {
  const m1 = text.match(/https?:\/\/(?:www\.)?douyin\.com\/video\/\S+/i);
  if (m1) return m1[0].split("?")[0];
  const m2 = text.match(/https?:\/\/v\.douyin\.com\/\S+/i);
  if (m2) return m2[0];
  return null;
}

main().catch((e) => {
  console.error("失败:", e.message);
  process.exit(1);
});
