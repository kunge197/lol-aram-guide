/**
 * 数据更新脚本
 * 从 Riot Data Dragon API 获取英雄基础信息
 *
 * 使用方法:
 *   node scripts/update-data.js
 *
 * 环境变量:
 *   RIOT_API_KEY - Riot API 密钥 (可选，目前只需 Data Dragon)
 */

const https = require("https");
const fs = require("fs");
const path = require("path");

// ==================== 配置 ====================

const DATA_DIR = path.join(__dirname, "..", "data");
const DD_BASE = "https://ddragon.leagueoflegends.com";

// 英雄类型映射 (Riot 标签 → 我们的中文类型)
const TAG_MAP = {
  Marksman: "ADC",
  Mage: "法师",
  Assassin: "刺客",
  Fighter: "战士",
  Tank: "坦克",
  Support: "辅助",
};

// 英雄别名 (手动维护，Data Dragon 不提供别名)
// ⚠️ 同步维护: 此映射与 scripts/crawl-douyin.js 的 NICKNAME_MAP 需保持一致
const ALIASES = {
  Jinx: ["金克斯"],
  Ezreal: ["EZ", "伊泽"],
  LeeSin: ["盲僧", "瞎子"],
  Zed: ["zed"],
  Yasuo: ["风男", "托儿索", "疾风剑豪"],
  Lux: ["光辉", "光女"],
  Garen: ["德玛西亚"],
  KaiSa: ["Kaisa"],
  Akali: ["AKL"],
  Thresh: ["灯笼怪"],
  Ziggs: ["炸弹人"],
  Draven: ["文", "荣耀行刑官"],
  Katarina: ["卡特", "Kat"],
  Sett: ["劲夫", "腕豪"],
  Ashe: ["寒冰"],
  Viktor: ["三只手"],
  Nami: ["人鱼"],
  DrMundo: ["蒙多医生"],
  MasterYi: ["剑圣", "无极剑圣", "JS"],
  Orianna: ["发条魔灵"],
  Brand: ["火男"],
  Mordekaiser: ["铁男"],
  Nidalee: ["豹女"],
  Lillia: ["莉莉亚"],
  Maokai: ["大树"],
  Malphite: ["石头人"],
  Fiddlesticks: ["稻草人"],
  Kassadin: ["卡萨丁"],
  Riven: ["瑞文"],
  Rumble: ["兰博"],
  Vayne: ["VN"],
  Lucian: ["奥巴马"],
  Swain: ["乌鸦"],
  Singed: ["炼金"],
  Taric: ["宝石"],
  Nocturne: ["梦魇"],
  TwistedFate: ["卡牌"],
  Trundle: ["巨魔"],
  Sion: ["塞恩"],
  Teemo: ["提莫"],
  Zilean: ["时光"],
  Vladimir: ["吸血鬼"],
  JarvanIV: ["嘉文", "皇子"],
  Hecarim: ["人马"],
  Fizz: ["鱼人"],
  Velkoz: ["大眼"],
};

// ==================== 工具函数 ====================

function fetch(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "lol-aram-guide/1.0" } }, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error(`JSON parse error: ${url}`));
          }
        });
      })
      .on("error", reject);
  });
}

// ==================== 主流程 ====================

async function main() {
  console.log("[Phase 2] 开始更新数据...\n");

  // 1. 获取最新版本号
  console.log("1. 获取 Data Dragon 版本号...");
  const versions = await fetch(`${DD_BASE}/api/versions.json`);
  const latestVersion = versions[0];
  console.log(`   最新版本: ${latestVersion}\n`);

  // 2. 获取所有英雄 (中文)
  console.log("2. 获取英雄列表...");
  const championData = await fetch(
    `${DD_BASE}/cdn/${latestVersion}/data/zh_CN/champion.json`
  );
  const rawChampions = Object.values(championData.data);
  console.log(`   共获取 ${rawChampions.length} 个英雄\n`);

  // 3. 转换为我们的格式（仅基础信息，无推算数据）
  console.log("3. 转换数据格式...");
  const champions = rawChampions.map((champ) => {
    // 映射类型
    const riotTags = champ.tags || [];
    const types = [];
    for (const tag of riotTags) {
      const mapped = TAG_MAP[tag];
      if (mapped && !types.includes(mapped)) {
        types.push(mapped);
      }
    }

    // 英文 ID
    const id = champ.id;

    // 别名
    const aliases = ALIASES[id] || [];

    return {
      id: id
        .replace(/([a-z])([A-Z])/g, "$1-$2")
        .replace(/['.]/g, "")
        .toLowerCase(),
      name: champ.name,
      nameEn: id,
      title: champ.title,
      aliases,
      types,
    };
  });

  // 4. 合并已存在的套路数据
  console.log("4. 合并已有的套路数据...");
  const outputPath = path.join(DATA_DIR, "champions.json");
  const existingRaw = fs.existsSync(outputPath)
    ? fs.readFileSync(outputPath, "utf-8")
    : "[]";
  const existingData = JSON.parse(existingRaw);

  for (const newChamp of champions) {
    const oldChamp = existingData.find((c) => c.id === newChamp.id);
    if (oldChamp) {
      // 保留已有的套路
      if (oldChamp.builds && oldChamp.builds.length > 0) {
        newChamp.builds = oldChamp.builds;
      }
      // 保留手动添加的别名
      if (oldChamp.aliases && oldChamp.aliases.length > 0) {
        const merged = [...new Set([...oldChamp.aliases, ...newChamp.aliases])];
        newChamp.aliases = merged;
      }
    }
  }

  // 5. 写入 data/champions.json
  console.log("5. 写入文件...");
  fs.writeFileSync(outputPath, JSON.stringify(champions, null, 2), "utf-8");

  const oldCount = existingData.length;
  const newCount = champions.length;
  const withBuilds = champions.filter((c) => c.builds && c.builds.length > 0).length;
  console.log(`   写入 ${newCount} 个英雄到 data/champions.json`);
  console.log(`   其中有套路的英雄: ${withBuilds} 个`);

  // 6. 写入类型数据（如果还不存在）
  const typePath = path.join(DATA_DIR, "types.json");
  if (!fs.existsSync(typePath)) {
    const typesData = [
      { id: "ADC", name: "ADC", description: "远程物理核心" },
      { id: "刺客", name: "刺客", description: "高爆发单体击杀" },
      { id: "战士", name: "战士", description: "近战持续输出" },
      { id: "坦克", name: "坦克", description: "前排吸收伤害" },
      { id: "法师", name: "法师", description: "法术爆发输出" },
      { id: "辅助", name: "辅助", description: "保护和增益队友" },
    ];
    fs.writeFileSync(typePath, JSON.stringify(typesData, null, 2), "utf-8");
  }

  // 7. 写入版本信息
  const versionPath = path.join(DATA_DIR, "version.json");
  fs.writeFileSync(
    versionPath,
    JSON.stringify(
      {
        gameVersion: latestVersion,
        updatedAt: new Date().toISOString(),
        championCount: newCount,
      },
      null,
      2
    ),
    "utf-8"
  );

  console.log(`   游戏版本: ${latestVersion}`);
  console.log(`   更新时间: ${new Date().toISOString()}`);
  console.log(`\n数据更新完成!`);

  // 对比
  if (oldCount > 0) {
    if (newCount > oldCount) {
      const newNames = champions
        .filter((c) => !existingData.find((e) => e.id === c.id))
        .map((c) => c.name);
      if (newNames.length > 0) {
        console.log(`   新增英雄: ${newNames.join(", ")}`);
      }
    }
    const oldBuildCount = existingData.filter(
      (c) => c.builds && c.builds.length > 0
    ).length;
    if (withBuilds !== oldBuildCount) {
      console.log(`   有套路的英雄: ${oldBuildCount} → ${withBuilds}`);
    }
  }
}

main().catch((err) => {
  console.error("数据更新失败:", err.message);
  process.exit(1);
});
