import Link from "next/link";

export default function NotFound() {
  return (
    <div className="max-w-6xl mx-auto px-4 py-24 text-center">
      <h1 className="text-6xl font-bold text-gray-200 mb-4">404</h1>
      <h2 className="text-xl font-semibold text-gray-700 mb-2">
        英雄未找到
      </h2>
      <p className="text-gray-400 mb-8">这个英雄可能不在当前版本的数据中</p>
      <Link
        href="/"
        className="inline-block px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors"
      >
        返回首页
      </Link>
    </div>
  );
}
