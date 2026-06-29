"use client";

import { useState, useMemo } from "react";
import ChampionCard from "@/components/ChampionCard";
import TypeFilter from "@/components/TypeFilter";
import { getChampions, getChampionTypes, getChampionsByType, searchChampions } from "@/lib/utils";

export default function HomePage() {
  const [activeType, setActiveType] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const champions = useMemo(() => getChampions(), []);
  const types = useMemo(() => getChampionTypes(), []);

  const filteredChampions = useMemo(() => {
    let result = activeType ? getChampionsByType(activeType) : champions;
    if (searchQuery.trim()) {
      result = result.filter(
        (c) =>
          c.name.toLowerCase().includes(searchQuery.trim().toLowerCase()) ||
          c.nameEn.toLowerCase().includes(searchQuery.trim().toLowerCase()) ||
          c.title.toLowerCase().includes(searchQuery.trim().toLowerCase()) ||
          c.aliases.some((alias) =>
            alias.toLowerCase().includes(searchQuery.trim().toLowerCase())
          )
      );
    }
    return result;
  }, [activeType, champions, searchQuery]);

  const sortedChampions = useMemo(() => {
    return [...filteredChampions].sort((a, b) => {
      const tierOrder = { S: 0, A: 1, B: 2, C: 3 };
      const tierDiff = (tierOrder[a.tier] ?? 99) - (tierOrder[b.tier] ?? 99);
      if (tierDiff !== 0) return tierDiff;
      return b.winRate - a.winRate;
    });
  }, [filteredChampions]);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          海克斯大乱斗英雄榜单
        </h1>
        <p className="text-gray-500">
          搜索英雄或按类型筛选，查看胜率与海克斯符文推荐
        </p>
      </div>

      {/* 搜索框 */}
      <div className="mb-4">
        <div className="relative max-w-xl">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索英雄（名称 / 别名 / 英文名）"
            className="w-full px-4 py-3 pl-10 rounded-xl border border-gray-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-sm text-base"
          />
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* 类型筛选 */}
      <div className="mb-6">
        <TypeFilter
          types={types}
          activeType={activeType}
          onTypeChange={setActiveType}
        />
      </div>

      {/* 结果统计 */}
      <div className="mb-4 text-sm text-gray-400">
        {searchQuery
          ? `搜索 "${searchQuery}" 共找到 ${sortedChampions.length} 个英雄`
          : `共 ${champions.length} 个英雄`}
      </div>

      {/* 英雄卡片 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {sortedChampions.map((champion) => (
          <ChampionCard key={champion.id} champion={champion} />
        ))}
      </div>

      {sortedChampions.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg mb-2">未找到匹配的英雄</p>
          <p className="text-sm">
            试试其他关键词，例如：&ldquo;亚索&rdquo; &ldquo;ez&rdquo; &ldquo;刺客&rdquo;
          </p>
        </div>
      )}
    </div>
  );
}
