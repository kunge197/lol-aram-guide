import Link from "next/link";
import TierBadge from "./TierBadge";
import { getWinRateColor } from "@/lib/utils";

export default function ChampionCard({ champion }) {
  return (
    <Link
      href={`/champions/${champion.id}`}
      className="block bg-white rounded-xl shadow-sm border border-gray-100 hover:shadow-md hover:border-blue-200 transition-all duration-200 overflow-hidden group"
    >
      <div className="p-5">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="font-bold text-lg text-gray-900 group-hover:text-blue-600 transition-colors">
              {champion.name}
            </h3>
            <p className="text-sm text-gray-500">{champion.title}</p>
          </div>
          <TierBadge tier={champion.tier} size="md" />
        </div>

        <div className="flex flex-wrap gap-1.5 mb-3">
          {champion.types.map((type) => (
            <span
              key={type}
              className="px-2 py-0.5 text-xs rounded-full bg-blue-50 text-blue-700 border border-blue-100"
            >
              {type}
            </span>
          ))}
        </div>

        <div className="flex items-center justify-between text-sm pt-3 border-t border-gray-50">
          <span>
            胜率{" "}
            <span className={`font-semibold ${getWinRateColor(champion.winRate)}`}>
              {champion.winRate}%
            </span>
          </span>
          <span className="text-gray-400">选取率 {champion.pickRate}%</span>
        </div>
      </div>
    </Link>
  );
}
