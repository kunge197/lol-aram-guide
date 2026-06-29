/**
 * 数据更新脚本
 * 从 Riot Data Dragon API 获取英雄数据，生成前端所需的 JSON 文件
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
};

// 胜率基准值 (按类型分，后续可被比赛数据覆盖)
const BASE_WIN_RATES = {
  ADC: { base: 50.5, range: 3 },
  法师: { base: 51.5, range: 3 },
  刺客: { base: 49.0, range: 3 },
  战士: { base: 51.0, range: 3 },
  坦克: { base: 52.5, range: 2.5 },
  辅助: { base: 51.0, range: 2.5 },
};

// 选取率基准值
const BASE_PICK_RATES = {
  ADC: { base: 16, range: 8 },
  法师: { base: 14, range: 7 },
  刺客: { base: 14, range: 6 },
  战士: { base: 13, range: 6 },
  坦克: { base: 11, range: 5 },
  辅助: { base: 11, range: 5 },
};

// 海克斯符文推荐 (按类型)
const HEXTECH_AUGMENTS_BY_TYPE = {
  ADC: {
    recommended: ["海克斯弹射", "致命节奏海克斯", "狂风之刃"],
    description:
      "ADC 优先选择攻速和暴击强化符文，最大化持续输出能力。",
  },
  法师: {
    recommended: ["海克斯法阵", "光束强化", "法力涌动"],
    description:
      "法师选择法术强度与冷却强化符文，最大化技能爆发伤害。",
  },
  刺客: {
    recommended: ["海克斯突袭", "暗影打击", "穿甲利刃"],
    description:
      "刺客选择穿甲与技能急速符文，追求瞬间秒杀后排。",
  },
  战士: {
    recommended: ["海克斯铁拳", "回音击强化", "坚韧护盾"],
    description:
      "战士选择攻防兼备的符文，确保持续作战能力。",
  },
  坦克: {
    recommended: ["金刚不坏", "反伤甲胄", "韧性增幅"],
    description:
      "坦克优先选择生命值与双抗强化符文，冲乱敌方阵型。",
  },
  远程消耗: {
    recommended: ["超距射击", "海克斯导弹升级", "弹射炸弹"],
    description:
      "消耗型英雄选择射程与技能强化符文，在安全位置持续压制。",
  },
  辅助: {
    recommended: ["海克斯护盾", "团队之光", "护盾增幅"],
    description:
      "辅助选择功能性与保护型符文，为团队提供最大支持。",
  },
};

// 通用符文评级
const GENERAL_AUGMENTS = {
  s: ["海克斯弹射", "金刚不坏", "致命节奏海克斯", "海克斯法阵"],
  a: [
    "超距射击",
    "光束强化",
    "海克斯突袭",
    "海克斯铁拳",
    "暗影打击",
    "回血强化",
  ],
  b: [
    "攻速增幅",
    "冷却缩减",
    "韧性增幅",
    "技能急速",
    "移速加成",
    "法力涌动",
    "法术迸发",
  ],
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

function seededRandom(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  }
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateStats(championId, types) {
  const rng = seededRandom(championId);

  // 根据英雄类型确定主类型 (取第一个)
  const primaryType = types[0];

  // 胜率
  const rateCfg = BASE_WIN_RATES[primaryType] || { base: 50, range: 3 };
  const winRate = parseFloat(
    (rateCfg.base + (rng() - 0.5) * rateCfg.range * 2).toFixed(1)
  );

  // 选取率
  const pickCfg = BASE_PICK_RATES[primaryType] || { base: 12, range: 6 };
  const pickRate = parseFloat(
    (pickCfg.base + (rng() - 0.5) * pickCfg.range * 2).toFixed(1)
  );

  // Tier
  let tier;
  if (winRate >= 53) tier = "S";
  else if (winRate >= 51) tier = "A";
  else if (winRate >= 49) tier = "B";
  else tier = "C";

  return { winRate: Math.max(44, Math.min(58, winRate)), pickRate: Math.max(3, Math.min(30, pickRate)), tier };
}

function generateHextechAugments(championId, types) {
  const augments = { byType: {} };

  for (const type of types) {
    const typeAugment = HEXTECH_AUGMENTS_BY_TYPE[type];
    if (typeAugment) {
      augments.byType[type] = { ...typeAugment };
    }
  }

  // 如果远程消耗或远程角色，增加远程推荐
  if (!types.includes("远程消耗")) {
    const hasRanged = types.includes("ADC") || types.includes("法师");
    if (hasRanged) {
      augments.byType["远程消耗"] = {
        recommended: ["超距射击", "海克斯导弹升级", "弹射炸弹"],
        description:
          "利用远程优势持续消耗对手，在安全位置打出伤害。",
      };
    }
  }

  augments.general = { ...GENERAL_AUGMENTS };

  return augments;
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

  // 3. 转换为我们的格式
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

    // 英文 ID (移除空格和特殊字符)
    const id = champ.id;

    // 别名
    const aliases = ALIASES[id] || [];

    // 生成胜率/选取率/Tier
    const stats = generateStats(id, types);

    // 生成海克斯符文推荐
    const hextechAugments = generateHextechAugments(id, types);

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
      ...stats,
      hextechAugments,
    };
  });

  // 4. 排序：先按 Tier (S > A > B > C)，再按胜率降序
  const tierOrder = { S: 0, A: 1, B: 2, C: 3 };
  champions.sort((a, b) => {
    const tDiff = (tierOrder[a.tier] ?? 99) - (tierOrder[b.tier] ?? 99);
    if (tDiff !== 0) return tDiff;
    return b.winRate - a.winRate;
  });

  // 5. 写入 data/champions.json
  console.log("4. 写入文件...");
  const outputPath = path.join(DATA_DIR, "champions.json");
  const existingRaw = fs.existsSync(outputPath)
    ? fs.readFileSync(outputPath, "utf-8")
    : "[]";
  const existingData = JSON.parse(existingRaw);

  fs.writeFileSync(outputPath, JSON.stringify(champions, null, 2), "utf-8");

  const oldCount = existingData.length;
  const newCount = champions.length;
  console.log(`   写入 ${newCount} 个英雄到 data/champions.json`);

  // 6. 写入类型数据 (如果还不存在)
  const typePath = path.join(DATA_DIR, "types.json");
  if (!fs.existsSync(typePath)) {
    const typesData = [
      { id: "ADC", name: "ADC", description: "远程物理核心" },
      { id: "刺客", name: "刺客", description: "高爆发单体击杀" },
      { id: "战士", name: "战士", description: "近战持续输出" },
      { id: "坦克", name: "坦克", description: "前排吸收伤害" },
      { id: "法师", name: "法师", description: "法术爆发输出" },
      { id: "远程消耗", name: "远程消耗", description: "远距离持续消耗" },
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
        dataVersion: "1.0.0",
        updatedAt: new Date().toISOString(),
        source: "Riot Data Dragon API",
        championCount: newCount,
        note: "胜率/选取率为基于英雄类型的估算值，接入比赛数据后可替换",
      },
      null,
      2
    ),
    "utf-8"
  );

  console.log(`   游戏版本: ${latestVersion}`);
  console.log(`   更新时间: ${new Date().toISOString()}`);
  console.log(`\n[Phase 2] 数据更新完成!`);

  // 对比
  if (oldCount > 0) {
    console.log(`\n   旧数据: ${oldCount} 个英雄`);
    console.log(`   新数据: ${newCount} 个英雄`);
    if (newCount > oldCount) {
      const newNames = champions
        .filter(
          (c) => !existingData.find((e) => e.id === c.id)
        )
        .map((c) => c.name);
      if (newNames.length > 0) {
        console.log(`   新增英雄: ${newNames.join(", ")}`);
      }
    }
  }
}

main().catch((err) => {
  console.error("数据更新失败:", err.message);
  process.exit(1);
});
