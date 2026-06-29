export default function TierBadge({ tier, size = "md" }) {
  const colors = {
    S: "bg-red-500",
    A: "bg-orange-500",
    B: "bg-yellow-500",
    C: "bg-gray-500",
  };

  const sizeClasses = {
    sm: "w-6 h-6 text-xs",
    md: "w-8 h-8 text-sm",
    lg: "w-10 h-10 text-base",
  };

  return (
    <span
      className={`inline-flex items-center justify-center font-bold text-white rounded-lg ${colors[tier] || "bg-gray-500"} ${sizeClasses[size]}`}
    >
      {tier}
    </span>
  );
}
