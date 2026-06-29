import Link from "next/link";

export default function Navbar() {
  return (
    <nav className="bg-gradient-to-r from-blue-900 via-blue-800 to-indigo-900 text-white shadow-lg">
      <div className="max-w-6xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between">
          <Link href="/" className="text-xl font-bold tracking-wide">
            ⚡ 海克斯乱斗资料库
          </Link>
          <div className="flex items-center gap-4">
            <Link
              href="/updates"
              className="text-sm text-blue-200 hover:text-white transition-colors"
            >
              更新日志
            </Link>
            <span className="text-sm text-blue-200">v16.13.1</span>
          </div>
        </div>
      </div>
    </nav>
  );
}
