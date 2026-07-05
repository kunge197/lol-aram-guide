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


async def extract_user_videos(user_url: str, max_videos: int = 100) -> list[dict]:
    """访问抖音博主主页，提取视频列表"""
    videos = []
    api_responses = []
    seen_api_urls = set()

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
            # 捕获 aweme/post 接口（博主视频列表）
            if "/aweme/v1/web/aweme/post/" in url:
                if url in seen_api_urls:
                    return
                seen_api_urls.add(url)
                try:
                    data = await response.json()
                    api_responses.append(data)
                    aweme_list = data.get("aweme_list") or []
                    print(f"[DEBUG] Captured aweme/post: {len(aweme_list)} videos, has_more={data.get('has_more')}", file=sys.stderr)
                except Exception as e:
                    print(f"[DEBUG] aweme/post JSON error: {e}", file=sys.stderr)

        def on_request(request):
            url = request.url
            if "/aweme/v1/web/aweme/post/" in url:
                print(f"[DEBUG] Request aweme/post", file=sys.stderr)

        page.on("response", on_response)
        page.on("request", on_request)

        # 导航到博主主页
        try:
            await page.goto(user_url, wait_until="domcontentloaded", timeout=30000)
        except Exception as e:
            print(f"[DEBUG] goto exception: {e}", file=sys.stderr)

        # 智能等待：等视频链接出现或 API 响应到来，最多 8s
        print(f"[DEBUG] Waiting for video content to load...", file=sys.stderr)
        try:
            await page.wait_for_selector('a[href*="/video/"]', timeout=8000)
            print(f"[DEBUG] Video links appeared", file=sys.stderr)
        except Exception:
            print(f"[DEBUG] Video links not found via selector, continuing...", file=sys.stderr)

        # 额外等待 API 响应
        await asyncio.sleep(3)

        # 逐小步滚动，每次检查 API 是否有新响应
        video_count_before = 0
        stale_scrolls = 0
        MAX_STALE_SCROLLS = 3

        print(f"[DEBUG] Scrolling to load more videos...", file=sys.stderr)
        for scroll_i in range(15):
            prev_api_count = len(api_responses)
            prev_dom_count = len(videos)

            # 小步滚动触发懒加载
            await page.evaluate("window.scrollBy(0, 800)")
            await asyncio.sleep(1.5)

            # 检查是否有新 API 响应
            if len(api_responses) > prev_api_count:
                print(f"[DEBUG] Scroll {scroll_i + 1}: new API response", file=sys.stderr)
                await asyncio.sleep(2)  # 等数据加载完成
                stale_scrolls = 0
            else:
                # 无新 API 响应，尝试更大步长
                await page.evaluate("window.scrollBy(0, 1500)")
                await asyncio.sleep(2)
                if len(api_responses) > prev_api_count:
                    print(f"[DEBUG] Scroll {scroll_i + 1}: new API (big scroll)", file=sys.stderr)
                    stale_scrolls = 0
                else:
                    stale_scrolls += 1
                    print(f"[DEBUG] Scroll {scroll_i + 1}: no more data ({stale_scrolls}/{MAX_STALE_SCROLLS})", file=sys.stderr)
                    if stale_scrolls >= MAX_STALE_SCROLLS:
                        # 到底了，再试一次滚到底部
                        await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                        await asyncio.sleep(2)
                        if len(api_responses) > prev_api_count:
                            print(f"[DEBUG] Bottom scroll: new data!", file=sys.stderr)
                            stale_scrolls = 0
                            continue
                        print(f"[DEBUG] Reached bottom, stopping", file=sys.stderr)
                        break

        # 截图调试
        try:
            import tempfile
            screenshot_path = os.path.join(tempfile.gettempdir(), "douyin_debug.png")
            await page.screenshot(path=screenshot_path, full_page=True)
            print(f"[DEBUG] Screenshot saved to {screenshot_path}", file=sys.stderr)
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

        # 也尝试从页面嵌入的 JSON 数据提取视频
        try:
            script_data = await page.evaluate("""
                () => {
                    const scripts = document.querySelectorAll('script');
                    for (const s of scripts) {
                        if (s.textContent.includes('aweme_list') || s.textContent.includes('video')) {
                            return s.textContent.substring(0, 5000);
                        }
                    }
                    return null;
                }
            """)
            if script_data:
                print(f"[DEBUG] Found script data with video references", file=sys.stderr)
        except:
            pass

        # 页面信息
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

    # 合并 DOM 视频 ID
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
        # 保留 DOM 提取的视频（create_time=0），只过滤 API 返回的有时间戳的视频
        videos = [v for v in videos if v.get("create_time") == 0 or (v.get("create_time") or 0) >= cutoff]

    result = {"url": user_url, "total": len(videos), "videos": videos}
    print(json.dumps(result, ensure_ascii=True, indent=2))


if __name__ == "__main__":
    main()
