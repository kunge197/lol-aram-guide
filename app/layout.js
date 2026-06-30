import { Geist } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata = {
  title: "海克斯乱斗资料库 - Hextech ARAM Guide",
  description: "查询英雄联盟海克斯大乱斗模式的英雄胜率、海克斯符文套路",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN" className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-gray-50">
        <Navbar />
        <main className="flex-1">{children}</main>
        <footer className="text-center text-sm text-gray-400 py-6 border-t border-gray-100 space-y-1">
          <p>数据来源：Riot Games API &middot; 仅供学习参考</p>
          <p>如有侵权请联系删除（电话：19700180062），本站将立即关闭</p>
        </footer>
      </body>
    </html>
  );
}
