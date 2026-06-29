"use client";

export default function TypeFilter({ types, activeType, onTypeChange }) {
  return (
    <div className="flex flex-wrap gap-2">
      <button
        onClick={() => onTypeChange(null)}
        className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
          activeType === null
            ? "bg-blue-600 text-white"
            : "bg-gray-100 text-gray-600 hover:bg-gray-200"
        }`}
      >
        全部
      </button>
      {types.map((type) => (
        <button
          key={type.id}
          onClick={() => onTypeChange(type.id)}
          className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
            activeType === type.id
              ? "bg-blue-600 text-white"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          {type.name}
        </button>
      ))}
    </div>
  );
}
