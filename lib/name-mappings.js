/**
 * 英雄名称映射工具
 *
 * 从 data/name-mappings.json 读取统一映射表，
 * 同时被 scripts/crawl-douyin.js 和 scripts/update-data.js 引用。
 * 避免两处各自维护一份、不同步的问题。
 */

const fs = require("fs");
const path = require("path");

const MAPPINGS_FILE = path.join(__dirname, "..", "data", "name-mappings.json");

/** 缓存，避免反复读文件 */
let _mappings = null;

function loadMappings() {
  if (_mappings) return _mappings;
  if (!fs.existsSync(MAPPINGS_FILE)) {
    console.error(`[name-mappings] ⚠️ 文件不存在: ${MAPPINGS_FILE}，返回空映射`);
    _mappings = { nicknameToId: {}, championAliases: {} };
    return _mappings;
  }
  _mappings = JSON.parse(fs.readFileSync(MAPPINGS_FILE, "utf-8"));
  return _mappings;
}

/**
 * 获取 nickname → championId 映射表
 * @returns {Object<string, string>}
 */
function getNicknameMap() {
  return loadMappings().nicknameToId || {};
}

/**
 * 获取 championId → 别名数组 映射表
 * @returns {Object<string, string[]>}
 */
function getAliasesMap() {
  return loadMappings().championAliases || {};
}

module.exports = { getNicknameMap, getAliasesMap, loadMappings };
