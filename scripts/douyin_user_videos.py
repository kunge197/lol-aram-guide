"""
抖音博主视频列表爬取助手 (兜底方案)

当 crawl-douyin.js 的 API 直连模式失败时，用 Playwright 兜底获取视频列表。

用法: uv run --script scripts/douyin_user_videos.py <博主URL> [--days N]
输出: JSON 格式的视频列表 (stdout)
"""

# /// script
# requires-python = ">=3.12"
# dependencies = ["playwright>=1.51"]
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
            print(f"[DEBUG] Response: {url[:120]}", file=sys.stderr)
            if "aweme/post" in url or "aweme/v1" in url or "aweme" in url:
                try:
                    data = await response.json()
                    api_responses.append(data)
                    api_event.set()
                    print(f"[DEBUG] Captured API response: {url[:80]}", file=sys.stderr)
                except Exception as e:
                    # Try text fallback
                    try:
                        txt = await response.text()
                        if len(txt) < 500:
                            print(f"[DEBUG] Non-JSON response: {txt[:200]}", file=sys.stderr)
                    except:
                        pass

        async def on_request(request):
            url = request.url
            if "aweme" in url.lower():
                print(f"[DEBUG] Request: {url[:150]}", file=sys.stderr)

        page.on("response", on_response)
        page.on("request", on_request)

        # 导航到博主主页（超时不影响，数据已在回调中捕获）
        try:
            await page.goto(user_url, wait_until="domcontentloaded", timeout=30000)
        except Exception as e:
            print(f"[DEBUG] goto exception: {e}", file=sys.stderr)

        # 等待视频数据加载
        print(f"[DEBUG] Waiting 8s for API responses...", file=sys.stderr)
        await asyncio.sleep(8)

        # 截图看看页面实际内容
        try:
            await page.screenshot(path="C:\\Users\\坤哥\\AppData\\Local\\Temp\\douyin_debug.png", full_page=True)
            print(f"[DEBUG] Screenshot saved", file=sys.stderr)
        except Exception as e:
            print(f"[DEBUG] Screenshot failed: {e}", file=sys.stderr)

        # 从 DOM 提取视频 ID（兜底）
        dom_ids = set()
        try:
            links = await page.evaluate("""
                () => Array.from(document.querySelectorAll('a[href*="/video/"]'))
                    .map(el => el.getAttribute('href'))
                    .filter(Boolean)
            """)
            print(f"[DEBUG] DOM video links found: {len(links)}", file=sys.stderr)
            for link in links[:5]:
                print(f"[DEBUG]   Link: {link[:100]}", file=sys.stderr)
            for link in links:
                vid = link.split("/video/")[-1].split("?")[0].split("/")[0]
                if vid and vid.isdigit():
                    dom_ids.add(vid)
        except Exception as e:
            print(f"[DEBUG] DOM extraction error: {e}", file=sys.stderr)

        # Also try getting page title / content info
        try:
            title = await page.title()
            print(f"[DEBUG] Page title: {title}", file=sys.stderr)
            url_now = page.url
            print(f"[DEBUG] Current URL: {url_now}", file=sys.stderr)
        except:
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
    # ensure_ascii=True 使中文转义为 \uXXXX，避免 Windows 管道编码问题
    print(json.dumps(result, ensure_ascii=True, indent=2))


if __name__ == "__main__":
    main()
