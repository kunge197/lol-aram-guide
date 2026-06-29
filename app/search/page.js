"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useMemo } from "react";
import ChampionCard from "@/components/ChampionCard";
import { searchChampions } from "@/lib/utils";

function SearchResults() {
  const searchParams = useSearchParams();
  const query = searchParams.get("q") || "";

  const results = useMemo(() => searchChampions(query), [query]);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          搜索结果
        </h1>
        <p className="text-gray-500">
          {query ? (
            <>关键词 &ldquo;<span className="font-medium text-gray-700">{query}</span>&rdquo; 共找到 {results.length} 个英雄</>
          ) : (
            "请输入搜索关键词"
          )}
        </p>
      </div>

      {results.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {results.map((champion) => (
            <ChampionCard key={champion.id} champion={champion} />
          ))}
        </div>
      ) : (
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

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-6xl mx-auto px-4 py-8">
          <p className="text-gray-400">搜索中...</p>
        </div>
      }
    >
      <SearchResults />
    </Suspense>
  );
}
