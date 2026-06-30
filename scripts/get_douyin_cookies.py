"""
生成抖音公开访客 cookie 供 yt-dlp 使用 (兜底方案)

当 crawl-douyin.js 的 HTTP 自动获取 cookie 失败时，用 Playwright 兜底生成。
主脚本已内置 HTTP 获取方式，通常无需手动调用此脚本。

用法: uv run --script scripts/get_douyin_cookies.py [输出路径]
默认输出: data/.crawl-cache/douyin_cookies.txt
"""

# /// script
# requires-python = ">=3.12"
# dependencies = ["playwright>=1.51"]
# ///

import asyncio
import json
import os
import sys
from playwright.async_api import async_playwright


COOKIE_FILE = os.path.join(
    os.path.dirname(__file__), "..", "data", ".crawl-cache", "douyin_cookies.txt"
)


def netscape_format(cookies):
    """将 Playwright cookies 转为 Netscape cookie 文件格式"""
    now = __import__("time").time()
    lines = ["# Netscape HTTP Cookie File"]
    for c in cookies:
        domain = c.get("domain", ".douyin.com")
        flag = "TRUE" if domain.startswith(".") else "FALSE"
        path = c.get("path", "/")
        secure = "TRUE" if c.get("secure", False) else "FALSE"
        expires = c.get("expires", -1)
        # yt-dlp 需要正数 expires，session cookie 设为1年后
        if expires is None or expires <= 0:
            expires = now + 86400 * 365
        expires = str(int(expires))
        name = c.get("name", "")
        value = c.get("value", "")
        lines.append(f"{domain}\t{flag}\t{path}\t{secure}\t{expires}\t{name}\t{value}")
    return "\n".join(lines)


async def get_cookies(output_path=None):
    if output_path is None:
        output_path = COOKIE_FILE

    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--no-sandbox"])
        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            locale="zh-CN",
        )
        page = await context.new_page()
        try:
            await page.goto("https://www.douyin.com/video/7648442431981079849", timeout=15000)
        except Exception:
            pass
        await asyncio.sleep(3)

        cookies = await context.cookies()
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(netscape_format(cookies))

        # 检查关键 cookie
        names = {c["name"] for c in cookies}
        print(f"Cookies saved: {len(cookies)} total", file=sys.stderr)
        print(f"Has s_v_web_id: {'s_v_web_id' in names}", file=sys.stderr)
        print(f"Output: {output_path}", file=sys.stderr)

        await browser.close()

    return output_path


def main():
    output = sys.argv[1] if len(sys.argv) > 1 else None
    asyncio.run(get_cookies(output))


if __name__ == "__main__":
    main()
