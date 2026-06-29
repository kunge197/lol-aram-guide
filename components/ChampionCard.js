import Link from "next/link";

export default function ChampionCard({ champion }) {
  const builds = champion.builds || [];
  const buildCount = builds.length;

  return (
    <Link
      href={`/champions/${champion.id}`}
      className="block bg-white rounded-xl shadow-sm border border-gray-100 hover:shadow-md hover:border-blue-200 transition-all duration-200 overflow-hidden group"
    >
      <div className="p-5">
        <div className="mb-3">
          <h3 className="font-bold text-lg text-gray-900 group-hover:text-blue-600 transition-colors">
            {champion.name}
          </h3>
          <p className="text-sm text-gray-500">{champion.title}</p>
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

        <div className="text-sm pt-3 border-t border-gray-50">
          {buildCount > 0 ? (
            <div className="text-blue-600 font-medium">
              {buildCount} 个套路
              {builds[0] && (
                <p className="text-gray-400 font-normal truncate mt-0.5">
                  {builds[0].title}
                </p>
              )}
            </div>
          ) : (
            <span className="text-gray-400">暂无套路</span>
          )}
        </div>
      </div>
    </Link>
  );
}
