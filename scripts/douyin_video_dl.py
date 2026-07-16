"""
抖音视频下载脚本 (Playwright + 登录态 Cookie)

用 Playwright 加载浏览器会话 cookie，打开抖音视频页，从页面嵌入数据提取视频地址并下载。

用法: uv run --script scripts/douyin_video_dl.py <视频URL> <输出路径>
输出: JSON 到 stdout
"""

# /// script
# requires-python = ">=3.12"
# dependencies = ["playwright>=1.51,<1.62"]
# ///

import asyncio
import json
import os
import re
import sys
import urllib.request
from playwright.async_api import async_playwright

COOKIE_FILE = os.path.join(
    os.path.dirname(__file__), "..", "data", ".crawl-cache", "douyin_cookies.txt"
)


def load_netscape_cookies(filepath):
    """读取 Netscape 格式 cookie 文件，返回 Playwright 兼容的 cookies 列表"""
    cookies = []
    if not os.path.exists(filepath):
        return cookies
    with open(filepath, "r") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split("\t")
            if len(parts) < 7:
                continue
            domain = parts[0]
            path = parts[2]
            secure = parts[3].upper() == "TRUE"
            name = parts[5]
            value = parts[6].rstrip("\r")
            if not name:
                continue
            cookies.append({
                "name": name,
                "value": value,
                "domain": domain,
                "path": path,
                "secure": secure,
                "httpOnly": False,
                "sameSite": "Lax",
            })
    return cookies


async def download_video(video_url: str, output_path: str) -> dict:
    """打开抖音视频页，提取视频地址并下载"""
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

        # 加载登录态 cookie
        cookies = load_netscape_cookies(COOKIE_FILE)
        if cookies:
            await context.add_cookies(cookies)
            print(f"[PLAYWRIGHT] 加载了 {len(cookies)} 个 cookie（含 sessionid）", file=sys.stderr)
        else:
            print(f"[PLAYWRIGHT] ⚠️ 未找到 cookie 文件: {COOKIE_FILE}", file=sys.stderr)

        page = await context.new_page()

        # 拦截 API 响应获取视频信息
        async def on_response(response):
            url = response.url
            if "/aweme/v1/web/aweme/detail/" in url:
                try:
                    data = await response.json()
                    aweme = data.get("aweme_detail") or {}
                    if aweme:
                        video_info["id"] = aweme.get("aweme_id", "")
                        video_info["title"] = (aweme.get("desc") or "").strip()
                        video = aweme.get("video", {})
                        play_addr = video.get("play_addr", {})
                        url_list = play_addr.get("url_list", [])
                        if url_list:
                            video_info["url"] = url_list[0].replace("playwm", "play")
                except Exception:
                    pass

        page.on("response", on_response)

        try:
            await page.goto(video_url, wait_until="domcontentloaded", timeout=30000)
        except Exception as e:
            print(f"[PLAYWRIGHT] goto 异常: {e}", file=sys.stderr)

        # 等待页面加载，给 API 响应时间
        for _ in range(30):
            if video_info.get("url"):
                break
            await asyncio.sleep(0.5)

        # 兜底: 从 window._ROUTER_DATA 提取视频地址
        if not video_info.get("url"):
            print(f"[PLAYWRIGHT] API 未拦截到，尝试 _ROUTER_DATA 提取...", file=sys.stderr)
            try:
                router_data = await page.evaluate("""() => {
                    try {
                        const scripts = document.querySelectorAll('script');
                        for (const s of scripts) {
                            if (s.textContent.includes('window._ROUTER_DATA')) {
                                return s.textContent;
                            }
                        }
                        // 也可能直接挂载在 window 上
                        if (window._ROUTER_DATA) {
                            return JSON.stringify(window._ROUTER_DATA);
                        }
                    } catch(e) {}
                    return null;
                }""")
                if router_data:
                    # 提取 JSON
                    match = re.search(r'window\._ROUTER_DATA\s*=\s*({.*?});\s*\n', router_data, re.DOTALL)
                    if not match:
                        match = re.search(r'({.*})', router_data, re.DOTALL)
                    if match:
                        data = json.loads(match.group(1))
                        # 遍历 loaderData 查找视频信息
                        loader_data = data.get("loaderData", {})
                        for key in loader_data:
                            item = loader_data[key]
                            # 尝试各种可能的视频数据路径
                            for field in ["videoInfoRes", "videoData", "aweme", "data"]:
                                sub = item.get(field, item)
                                if isinstance(sub, dict):
                                    item_list = sub.get("item_list", [])
                                    if not item_list and isinstance(sub.get("data"), dict):
                                        item_list = sub["data"].get("item_list", [])
                                    if item_list:
                                        video_item = item_list[0]
                                        v = video_item.get("video", {})
                                        play_addr = v.get("play_addr", {})
                                        url_list = play_addr.get("url_list", [])
                                        if url_list:
                                            video_info["url"] = url_list[0].replace("playwm", "play")
                                            video_info["id"] = video_item.get("aweme_id", "")
                                            video_info["title"] = (video_item.get("desc") or "").strip()
                                            print(f"[PLAYWRIGHT] 从 _ROUTER_DATA.{field} 提取到视频", file=sys.stderr)
                                            break
                            if video_info.get("url"):
                                break
            except Exception as e:
                print(f"[PLAYWRIGHT] _ROUTER_DATA 解析失败: {e}", file=sys.stderr)

        # 再兜底: 查找 <video> 元素的 src
        if not video_info.get("url"):
            print(f"[PLAYWRIGHT] 尝试从 <video> 元素提取...", file=sys.stderr)
            try:
                video_src = await page.evaluate("""() => {
                    const v = document.querySelector('video source');
                    if (v && v.src) return v.src;
                    const v2 = document.querySelector('video');
                    if (v2 && v2.src) return v2.src;
                    return null;
                }""")
                if video_src:
                    video_info["url"] = video_src
                    print(f"[PLAYWRIGHT] 从 <video> 元素提取到地址", file=sys.stderr)
            except Exception as e:
                print(f"[PLAYWRIGHT] <video> 提取失败: {e}", file=sys.stderr)

        await browser.close()

    if not video_info.get("url"):
        print(f"[PLAYWRIGHT] 无法获取视频地址", file=sys.stderr)
        return result

    # 下载视频
    try:
        if not (os.path.exists(output_path) and os.path.getsize(output_path) > 100000):
            url_to_download = video_info["url"]
            # 如果地址是 uri 格式（无协议），补全
            if url_to_download.startswith("//"):
                url_to_download = "https:" + url_to_download
            print(f"[PLAYWRIGHT] 下载视频: {url_to_download[:80]}...", file=sys.stderr)
            headers = {
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                ),
                "Referer": "https://www.douyin.com/",
            }
            req = urllib.request.Request(url_to_download, headers=headers)
            with urllib.request.urlopen(req, timeout=180) as resp:
                with open(output_path, "wb") as f:
                    while True:
                        chunk = resp.read(8192)
                        if not chunk:
                            break
                        f.write(chunk)

        size = os.path.getsize(output_path)
        if size > 100000:
            result["id"] = video_info.get("id", "")
            result["title"] = video_info.get("title", "")
            result["url"] = video_info["url"]
            result["success"] = True
            print(f"[PLAYWRIGHT] 下载成功: {size} bytes", file=sys.stderr)
        else:
            print(f"[PLAYWRIGHT] 下载文件过小: {size} bytes", file=sys.stderr)
    except Exception as e:
        print(f"[PLAYWRIGHT] 下载失败: {e}", file=sys.stderr)

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
