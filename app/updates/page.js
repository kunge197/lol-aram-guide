import updates from "@/data/updates.json";

const TYPE_LABELS = {
  augment: { label: "海克斯符文", bg: "bg-indigo-50", text: "text-indigo-700", border: "border-indigo-200" },
  champion: { label: "英雄调整", bg: "bg-green-50", text: "text-green-700", border: "border-green-200" },
  system: { label: "系统更新", bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" },
};

export default function UpdatesPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-2">版本更新记录</h1>
      <p className="text-gray-500 mb-8">
        海克斯乱斗模式版本更新日志，记录海克斯符文调整、英雄平衡性改动和系统更新。
      </p>

      <div className="space-y-6">
        {updates.map((update) => (
          <div
            key={update.version}
            className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6"
          >
            {/* Header */}
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <span className="px-3 py-1 text-sm font-bold bg-blue-600 text-white rounded-lg">
                    {update.version}
                  </span>
                  <h2 className="text-xl font-bold text-gray-900">
                    {update.title}
                  </h2>
                </div>
                <p className="text-sm text-gray-400 mt-1">{update.date}</p>
              </div>
            </div>

            {/* Summary */}
            <p className="text-gray-600 mb-5 leading-relaxed">{update.summary}</p>

            {/* Changes */}
            <div className="space-y-3">
              {update.changes.map((change, i) => {
                const typeStyle = TYPE_LABELS[change.type] || TYPE_LABELS.system;
                return (
                  <div
                    key={i}
                    className="flex items-start gap-3 p-3 rounded-xl border border-gray-100 bg-gray-50/50"
                  >
                    <span
                      className={`shrink-0 px-2.5 py-0.5 text-xs font-medium rounded-full border ${typeStyle.bg} ${typeStyle.text} ${typeStyle.border}`}
                    >
                      {typeStyle.label}
                    </span>
                    <p className="text-sm text-gray-700 leading-relaxed">
                      {change.content}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
