"""
抖音博主视频列表爬取助手

使用 Playwright 渲染博主主页，从 API 响应中提取视频列表。

用法: uv run --script scripts/douyin_user_videos.py <博主URL> [--days N]
输出: JSON 格式的视频列表 (stdout)
"""

# /// script
# requires-python = ">=3.12"
# dependencies = ["playwright"]
# ///

import asyncio
import json
import os
import sys
import time
from playwright.async_api import async_playwright


async def extract_user_videos(user_url: str, max_videos: int = 50) -> list[dict]:
    """访问抖音博主主页，提取视频列表"""
    videos = []
    api_responses = []
    api_event = asyncio.Event()

    # 从环境变量读取代理配置 (如 HTTPS_PROXY=http://127.0.0.1:7890)
    proxy_args = []
    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("HTTP_PROXY")
    if proxy:
        proxy_args = [f"--proxy-server={proxy}"]

    launch_args = ["--no-sandbox", "--disable-setuid-sandbox"] + proxy_args

    async with async_playwright() as p:
        # 优先用系统 Chrome，没有则用 Playwright Chromium
        try:
            browser = await p.chromium.launch(
                channel="chrome",
                headless=True,
                args=launch_args,
            )
        except Exception:
            browser = await p.chromium.launch(
                headless=True,
                args=launch_args,
            )
        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            locale="zh-CN",
            viewport={"width": 1920, "height": 1080},
        )
        page = await context.new_page()

        async def on_response(response):
            url = response.url
            if "aweme/post" in url:
                try:
                    data = await response.json()
                    api_responses.append(data)
                    api_event.set()
                except Exception:
                    pass

        page.on("response", on_response)

        # 导航到博主主页（超时不影响，数据已在回调中捕获）
        try:
            await page.goto(user_url, wait_until="networkidle", timeout=50000)
        except Exception:
            pass

        # 等待视频数据加载
        await asyncio.sleep(5)

        # 从 DOM 提取视频 ID（兜底）
        dom_ids = set()
        try:
            links = await page.evaluate("""
                () => Array.from(document.querySelectorAll('a[href*="/video/"]'))
                    .map(el => el.getAttribute('href'))
                    .filter(Boolean)
            """)
            for link in links:
                vid = link.split("/video/")[-1].split("?")[0].split("/")[0]
                if vid and vid.isdigit():
                    dom_ids.add(vid)
        except Exception:
            pass

        await browser.close()

    # 从 API 响应提取视频数据
    for data in api_responses:
        aweme_list = data.get("aweme_list") or data.get("data", {}).get("aweme_list") or []
        for item in aweme_list:
            videos.append({
                "id": item.get("aweme_id"),
                "desc": (item.get("desc") or "").strip(),
                "create_time": item.get("create_time"),
                "author": (item.get("author", {}).get("nickname", "")),
            })

    # 合并 DOM 视频 ID（无 desc/create_time 的排在后面）
    api_ids = {v["id"] for v in videos if v["id"]}
    for vid in sorted(dom_ids):
        if vid not in api_ids:
            videos.append({"id": vid, "desc": "", "create_time": 0, "author": ""})

    # 去重 + 按时间排序
    seen = set()
    unique = []
    for v in videos:
        if v["id"] and v["id"] not in seen:
            seen.add(v["id"])
            unique.append(v)
    unique.sort(key=lambda x: x.get("create_time", 0), reverse=True)

    return unique[:max_videos]


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "请提供博主主页URL"}, ensure_ascii=False))
        sys.exit(1)

    user_url = sys.argv[1]
    days = None
    if "--days" in sys.argv:
        idx = sys.argv.index("--days")
        if idx + 1 < len(sys.argv):
            days = int(sys.argv[idx + 1])

    cutoff = None
    if days:
        cutoff = int(time.time()) - days * 86400

    videos = asyncio.run(extract_user_videos(user_url))

    if cutoff:
        videos = [v for v in videos if (v.get("create_time") or 0) >= cutoff]

    result = {"url": user_url, "total": len(videos), "videos": videos}
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
