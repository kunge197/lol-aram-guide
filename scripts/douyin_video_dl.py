"""
抖音视频下载脚本 (兜底方案)

当 yt-dlp 下载失败时，用 Playwright 拦截抖音 API 获取无水印视频地址并下载。

用法: uv run --script scripts/douyin_video_dl.py <视频URL> <输出路径>
输出: 下载的视频文件 + stdout 输出 JSON 元信息
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
import urllib.request
from playwright.async_api import async_playwright


async def download_video(video_url: str, output_path: str) -> dict:
    """打开抖音视频页，从 API 拦截视频地址并下载"""
    result = {"id": "", "title": "", "url": "", "success": False}
    video_info = {}

    proxy_args = []
    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("HTTP_PROXY")
    if proxy:
        proxy_args = [f"--proxy-server={proxy}"]

    launch_args = ["--no-sandbox", "--disable-setuid-sandbox"] + proxy_args

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=launch_args)
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
            # 捕获视频详情 API
            if "aweme/v1/web/aweme/detail" in url:
                try:
                    data = await response.json()
                    aweme = data.get("aweme_detail") or {}
                    if aweme:
                        video_info["id"] = aweme.get("aweme_id", "")
                        video_info["title"] = (aweme.get("desc") or "").strip()
                        video = aweme.get("video", {})
                        # 获取无水印视频地址
                        play_addr = video.get("play_addr", {})
                        url_list = play_addr.get("url_list", [])
                        if url_list:
                            video_info["url"] = url_list[0].replace("playwm", "play")
                        # 获取单独的音频地址
                        music = aweme.get("music", {})
                        audio_urls = []
                        if music.get("play_url", {}).get("uri"):
                            audio_urls.append(music["play_url"]["uri"])
                        if isinstance(music.get("play_url", {}).get("url_list"), list):
                            audio_urls.extend(music["play_url"]["url_list"])
                        if audio_urls:
                            video_info["audio_url"] = audio_urls[0]
                except Exception:
                    pass

        page.on("response", on_response)

        try:
            await page.goto(video_url, wait_until="domcontentloaded", timeout=30000)
        except Exception:
            pass

        # 等待 API 响应
        for _ in range(20):
            if video_info.get("url"):
                break
            await asyncio.sleep(0.5)

        # 兜底：从页面 DOM 检查是否有 _ROUTER_DATA
        if not video_info.get("url"):
            try:
                data = await page.evaluate("""
                    () => {
                        try {
                            const scripts = document.querySelectorAll('script');
                            for (const s of scripts) {
                                if (s.textContent.includes('_ROUTER_DATA')) {
                                    return s.textContent;
                                }
                            }
                        } catch(e) {}
                        return null;
                    }
                """)
                if data:
                    import re
                    match = re.search(r'window\._ROUTER_DATA\s*=\s*({.*?});', data, re.DOTALL)
                    if match:
                        router = json.loads(match.group(1))
                        for key in router.get("loaderData", {}):
                            item = router["loaderData"][key]
                            # 尝试多种可能的结构
                            vr = item.get("videoInfoRes") or item.get("videoInfoRes") or {}
                            il = vr.get("item_list") or []
                            if il:
                                play_addr = il[0].get("video", {}).get("play_addr", {})
                                ul = play_addr.get("url_list", [])
                                if ul:
                                    video_info["url"] = ul[0].replace("playwm", "play")
                                    video_info["id"] = il[0].get("aweme_id", "")
                                    video_info["title"] = (il[0].get("desc") or "").strip()
            except Exception:
                pass

        await browser.close()

    if not video_info.get("url"):
        return result

    # 下载视频（如果文件已存在则跳过）
    try:
        if not (os.path.exists(output_path) and os.path.getsize(output_path) > 100000):
            headers = {
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                ),
                "Referer": "https://www.douyin.com/",
            }
            req = urllib.request.Request(video_info["url"], headers=headers)
            with urllib.request.urlopen(req, timeout=120) as resp:
                with open(output_path, "wb") as f:
                    while True:
                        chunk = resp.read(8192)
                        if not chunk:
                            break
                        f.write(chunk)

        result["id"] = video_info.get("id", "")
        result["title"] = video_info.get("title", "")
        result["url"] = video_info["url"]
        result["audio_url"] = video_info.get("audio_url", "")
        result["success"] = True
    except Exception as e:
        print(f"Download failed: {e}", file=sys.stderr)

    return result


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "用法: douyin_video_dl.py <视频URL> <输出路径>"}, ensure_ascii=False))
        sys.exit(1)

    video_url = sys.argv[1]
    output_path = sys.argv[2]

    result = asyncio.run(download_video(video_url, output_path))
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
