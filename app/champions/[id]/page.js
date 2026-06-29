import { notFound } from "next/navigation";
import { getChampionById, getChampionTypeName, getWinRateColor } from "@/lib/utils";
import TierBadge from "@/components/TierBadge";
import championsData from "@/data/champions.json";

export function generateStaticParams() {
  return championsData.map((c) => ({ id: c.id }));
}

export default async function ChampionPage({ params }) {
  const { id } = await params;
  const champion = getChampionById(id);

  if (!champion) {
    notFound();
  }

  const { hextechAugments } = champion;
  const augmentTypes = Object.keys(hextechAugments.byType).filter(
    (t) => champion.types.includes(t)
  );

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-3xl font-bold text-gray-900">
                {champion.name}
              </h1>
              <TierBadge tier={champion.tier} size="lg" />
            </div>
            <p className="text-lg text-gray-500">
              {champion.title} &middot; {champion.nameEn}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          {champion.types.map((type) => (
            <span
              key={type}
              className="px-3 py-1 text-sm rounded-full bg-blue-50 text-blue-700 border border-blue-100"
            >
              {getChampionTypeName(type)}
            </span>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-4 sm:gap-8">
          <div className="bg-gray-50 rounded-xl p-4 text-center">
            <p className="text-sm text-gray-500 mb-1">胜率</p>
            <p className={`text-3xl font-bold ${getWinRateColor(champion.winRate)}`}>
              {champion.winRate}%
            </p>
          </div>
          <div className="bg-gray-50 rounded-xl p-4 text-center">
            <p className="text-sm text-gray-500 mb-1">选取率</p>
            <p className="text-3xl font-bold text-gray-700">
              {champion.pickRate}%
            </p>
          </div>
        </div>
      </div>

      {/* Hextech Augments Section */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">
          海克斯符文推荐
        </h2>

        {/* Type-specific recommendations */}
        {augmentTypes.length > 0 ? (
          augmentTypes.map((type) => (
            <div key={type} className="mb-6 last:mb-0">
              <h3 className="text-lg font-semibold text-blue-800 mb-3">
                {getChampionTypeName(type)} 推荐
              </h3>
              <div className="bg-blue-50 rounded-xl p-4 mb-3">
                <p className="text-sm text-gray-700 leading-relaxed">
                  {hextechAugments.byType[type].description}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {hextechAugments.byType[type].recommended.map((augment) => (
                  <span
                    key={augment}
                    className="px-3 py-1.5 text-sm font-medium bg-indigo-100 text-indigo-800 rounded-lg border border-indigo-200"
                  >
                    {augment}
                  </span>
                ))}
              </div>
            </div>
          ))
        ) : (
          <div className="bg-blue-50 rounded-xl p-4">
            <h3 className="text-lg font-semibold text-blue-800 mb-3">
              {champion.types[0]} 推荐
            </h3>
            <p className="text-sm text-gray-700 leading-relaxed mb-3">
              {hextechAugments.byType[champion.types[0]]?.description}
            </p>
            <div className="flex flex-wrap gap-2">
              {hextechAugments.byType[champion.types[0]]?.recommended.map((augment) => (
                <span
                  key={augment}
                  className="px-3 py-1.5 text-sm font-medium bg-indigo-100 text-indigo-800 rounded-lg border border-indigo-200"
                >
                  {augment}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* All Augments Tier List */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">
          符文强度评级
        </h2>

        {["s", "a", "b"].map((tier) => (
          <div key={tier} className="mb-4 last:mb-0">
            <div className="flex items-center gap-2 mb-2">
              <TierBadge tier={tier.toUpperCase()} size="sm" />
              <span className="text-sm text-gray-500">
                {tier === "s" ? "强力推荐" : tier === "a" ? "推荐" : "可用"}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {(hextechAugments.general[tier] || []).map((augment) => (
                <span
                  key={augment}
                  className={`px-3 py-1 text-sm rounded-lg border ${
                    tier === "s"
                      ? "bg-red-50 text-red-700 border-red-200"
                      : tier === "a"
                        ? "bg-orange-50 text-orange-700 border-orange-200"
                        : "bg-gray-50 text-gray-600 border-gray-200"
                  }`}
                >
                  {augment}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
