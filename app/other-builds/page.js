import Link from "next/link";
import otherBuilds from "@/data/other-builds.json";

export default function OtherBuildsPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-2">其他套路</h1>
      <p className="text-gray-500 mb-8">
        暂未识别出对应英雄的套路，如果你知道是哪个英雄的，欢迎补充。
      </p>

      {otherBuilds.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg mb-2">暂无未分类套路</p>
          <p className="text-sm">所有已爬取的套路都已匹配到对应英雄</p>
        </div>
      ) : (
        <div className="space-y-5">
          {otherBuilds.map((build, i) => (
            <div
              key={build.id || i}
              className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h2 className="font-semibold text-gray-900">{build.title}</h2>
                  <p className="text-sm text-gray-500">
                    来源: {build.author} · {build.source}
                  </p>
                </div>
                {build.dateAdded && (
                  <span className="text-xs text-gray-400">{build.dateAdded}</span>
                )}
              </div>

              {build.description && (
                <p className="text-sm text-gray-600 mb-3">{build.description}</p>
              )}

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-medium text-gray-400 uppercase mb-2">
                    推荐出装顺序
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {(build.items || []).map((item) => (
                      <span
                        key={item}
                        className="px-2.5 py-1 text-sm bg-amber-50 text-amber-800 rounded-lg border border-amber-200"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-400 uppercase mb-2">
                    海克斯符文
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {(build.hextechAugments || []).map((aug) => (
                      <span
                        key={aug}
                        className="px-2.5 py-1 text-sm bg-indigo-50 text-indigo-800 rounded-lg border border-indigo-200"
                      >
                        {aug}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {build.sourceUrl && (
                <a
                  href={build.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block mt-3 text-xs text-blue-500 hover:text-blue-700"
                >
                  查看原视频 →
                </a>
              )}

              {build.possibleChampions && build.possibleChampions.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <p className="text-xs text-gray-400">
                    可能英雄: {build.possibleChampions.join(", ")}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
