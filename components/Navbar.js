import Link from "next/link";

export default function Navbar() {
  return (
    <nav className="bg-gradient-to-r from-blue-900 via-blue-800 to-indigo-900 text-white shadow-lg">
      <div className="max-w-6xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between">
          <Link href="/" className="text-xl font-bold tracking-wide">
            ⚡ 海克斯乱斗资料库
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href="/other-builds"
              className="px-3 py-1.5 text-sm font-medium bg-amber-500/20 text-amber-200 hover:bg-amber-500/30 hover:text-white rounded-lg transition-colors border border-amber-400/30"
            >
              + 其他套路
            </Link>
            <span className="text-xs text-blue-300">v16.13.1</span>
          </div>
        </div>
      </div>
    </nav>
  );
}
