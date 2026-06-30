"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import ChampionCard from "@/components/ChampionCard";
import { getChampionsWithBuilds } from "@/lib/utils";
import otherBuilds from "@/data/other-builds.json";

export default function HomePage() {
  const [searchQuery, setSearchQuery] = useState("");
  const champions = useMemo(() => getChampionsWithBuilds(), []);

  const filteredChampions = useMemo(() => {
    if (!searchQuery.trim()) return champions;
    const q = searchQuery.trim().toLowerCase();
    return champions.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.nameEn.toLowerCase().includes(q) ||
        c.title.toLowerCase().includes(q) ||
        c.aliases.some((alias) => alias.toLowerCase().includes(q))
    );
  }, [searchQuery, champions]);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          海克斯乱斗资料库
        </h1>
        <p className="text-gray-500">
          来自抖音博主的社区套路合集，搜索英雄查看推荐出装与海克斯符文
        </p>
      </div>

      {/* 未分类套路提示 */}
      {otherBuilds.length > 0 && (
        <Link
          href="/other-builds"
          className="block mb-6 p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 hover:bg-amber-100 transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="font-medium">
              📦 还有 {otherBuilds.length} 个未分类套路
            </span>
            <span className="text-sm text-amber-600">查看详情 →</span>
          </div>
        </Link>
      )}

      {/* 搜索框 */}
      <div className="mb-6">
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

      {/* 结果统计 */}
      <div className="mb-4 text-sm text-gray-400">
        {searchQuery
          ? `搜索 "${searchQuery}" 共找到 ${filteredChampions.length} 个英雄`
          : `共 ${champions.length} 个英雄有社区套路`}
      </div>

      {/* 英雄卡片 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filteredChampions.map((champion) => (
          <ChampionCard key={champion.id} champion={champion} />
        ))}
      </div>

      {filteredChampions.length === 0 && (
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
