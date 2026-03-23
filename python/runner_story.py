"""
runner_story.py — Python backend for Story Generator module (chatgpt-sender-ui).
Uses nodriver (real browser, anti-detect) + fingerprint.
Orchestrates: outline prompt → parse chapters → chapter prompts → save files.
Communicates with Electron via JSON lines on stdout.
"""
from __future__ import annotations

import asyncio
import json
import math
import random
import re
import shutil
import sys
import tempfile
import time
import traceback
from datetime import datetime
from pathlib import Path

# Force UTF-8 stdout/stderr on Windows
if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if sys.stderr.encoding != 'utf-8':
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

try:
    import nodriver as uc
except Exception:
    print(json.dumps({"type": "error", "message": "Missing nodriver. pip install nodriver"}))
    sys.exit(1)

# ---------------------------------------------------------------------------
# Locate Auto_GPT.py: packaged app or dev mode
# ---------------------------------------------------------------------------
def _find_auto_gpt_root() -> Path:
    """
    Search order:
    1. Same dir as runner_story.py  (packaged: resources/python/ -> resources/)
    2. Next to python exe           (packaged: resources/Auto_GPT.py)
    3. Dev: Auto_All/               (grandparent of chatgpt-sender-ui/python/)
    """
    candidates = [
        Path(__file__).resolve().parent.parent,          # resources/
        Path(sys.executable).parent,                     # next to python.exe
        Path(__file__).resolve().parent.parent.parent,   # dev: Auto_All/
    ]
    for c in candidates:
        if (c / "Auto_GPT.py").exists():
            return c
    return candidates[-1]

ROOT = _find_auto_gpt_root()
sys.path.insert(0, str(ROOT))

from Auto_GPT import (
    CHATGPT_URL,
    PROMPT_TIMEOUT_SEC,
    load_cookies,
    find_visible,
    wait_for_chat_ready,
    scroll_to_chat_bottom,
    is_generating,
    has_send_button,
    get_assistant_message_count,
    get_last_assistant_text,
    try_send_message_now,
    wait_for_reply_with_reload,
    get_reply_with_retry,
    generate_fingerprint,
    build_fingerprint_injection_script,
)


# ---------------------------------------------------------------------------
# JSON messaging to Electron
# ---------------------------------------------------------------------------
def emit(msg_type: str, **kwargs):
    payload = {"type": msg_type, **kwargs}
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def emit_log(text: str):
    emit("log", message=text)


def emit_progress(done: int, total: int):
    emit("progress", done=done, total=total)


def emit_story_update(idx: int, status: str):
    emit("story_update", idx=idx, status=status)


def emit_done():
    emit("done")


def emit_error(text: str):
    emit("error", message=text)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def safe_filename(s: str) -> str:
    return re.sub(r'[<>:"/\\|?*]', '', s).strip()[:100]


def now_stamp() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def parse_chapters_from_outline(outline_text: str, num_chapters: int) -> list[str]:
    """Try to extract chapter names from outline text."""
    chapters = []
    # Try patterns like "Phần 1:", "Chương 1:", "Chapter 1:", "Part 1:"
    patterns = [
        r'(?:Phần|Chương|Chapter|Part)\s*\d+[:\.\-\s]',
        r'(?:^|\n)\s*\d+[\.\)]\s+',
    ]
    for pat in patterns:
        matches = re.findall(pat, outline_text, re.IGNORECASE | re.MULTILINE)
        if len(matches) >= num_chapters * 0.5:
            chapters = [m.strip().rstrip(':.-)') for m in matches]
            break

    if not chapters or len(chapters) < num_chapters:
        chapters = [f"Phần {i+1}" for i in range(num_chapters)]

    return chapters[:num_chapters]


# ---------------------------------------------------------------------------
# Process a single story
# ---------------------------------------------------------------------------
async def process_story(
    story_idx: int,
    story_json: dict,
    cookie_params: list,
    output_dir: Path,
    outline_prompt_template: str,
    chapter_prompt_template: str,
    worker_id: int,
    cols: int,
    screen_w: int = 1920,
    screen_h: int = 1080,
):
    title = story_json.get("story_title", f"Story_{story_idx}")
    safe_title = safe_filename(title)
    story_dir = output_dir / safe_title
    story_dir.mkdir(parents=True, exist_ok=True)

    total_words = story_json.get("total_words", 10000)
    avg_words = story_json.get("avg_words_per_chapter", 5000)
    num_chapters = max(1, math.ceil(total_words / avg_words)) if avg_words > 0 else 2

    emit_log(f"[Truyện {story_idx+1}] '{title}' — {num_chapters} phần, {total_words} từ")
    emit_story_update(story_idx, "Đang xử lý...")

    # Layout
    margin = 10
    rows_total = max(1, int(math.ceil(10 / cols)))
    cell_w = max(480, int((screen_w - margin * (cols + 1)) / cols))
    cell_h = max(360, int((screen_h - margin * (rows_total + 1)) / rows_total))
    row = worker_id // cols
    col = worker_id % cols
    x = margin + col * (cell_w + margin)
    y = margin + row * (cell_h + margin)

    browser = None
    cache_dir = None
    try:
        fp = generate_fingerprint(seed=worker_id + story_idx * 100)
        emit_log(
            f"[Truyện {story_idx+1}] Đang mở trình duyệt... "
            f"(Chrome/{fp['chrome_version']}, "
            f"GPU: {fp['webgl_renderer'][:35]}..., "
            f"Screen: {fp['screen_width']}x{fp['screen_height']})"
        )
        cache_dir = tempfile.mkdtemp(prefix=f'uc_story_{worker_id}_')
        browser = await uc.start(
            headless=False,
            browser_args=[
                f"--window-position={x},{y}",
                f"--window-size={cell_w},{cell_h}",
                f"--user-agent={fp['user_agent']}",
                f"--lang={fp['languages'][0]}",
                f"--disk-cache-dir={cache_dir}",
                "--no-first-run",
                "--no-default-browser-check",
                # Chống throttle khi bị che/mất focus
                "--disable-background-timer-throttling",
                "--disable-backgrounding-occluded-windows",
                "--disable-renderer-backgrounding",
                "--disable-hang-monitor",
                "--disable-features=CalculateNativeWinOcclusion",
            ]
        )
        tab = browser.main_tab
        await tab.sleep(1)

        # Inject fingerprint
        fp_script = build_fingerprint_injection_script(fp)
        try:
            await tab.evaluate(fp_script)
        except Exception:
            pass

        try:
            await tab.send(uc.cdp.emulation.set_timezone_override(
                timezone_id=fp['timezone']
            ))
        except Exception:
            pass

        # Set cookies
        try:
            await tab.send(uc.cdp.network.set_cookies(cookies=cookie_params))
        except Exception:
            pass

        await tab.get(CHATGPT_URL)

        # Giữ tab luôn "focused" dù bị che bởi cửa sổ khác
        try:
            await tab.send(uc.cdp.emulation.set_focus_emulation_enabled(enabled=True))
        except Exception:
            pass

        try:
            await tab.evaluate(fp_script)
        except Exception:
            pass

        try:
            await wait_for_chat_ready(tab, timeout_sec=90)
        except Exception as e:
            emit_log(f"[Truyện {story_idx+1}] Lỗi mở ChatGPT: {e}")
            emit_story_update(story_idx, "Lỗi: Không mở được ChatGPT")
            return

        # ── Step 1: Send outline prompt ──
        json_data_str = json.dumps(story_json, ensure_ascii=False, indent=2)
        outline_prompt = outline_prompt_template.replace("{json_data}", json_data_str)

        emit_log(f"[Truyện {story_idx+1}] Gửi prompt dàn ý...")
        emit_story_update(story_idx, "Gửi dàn ý...")

        before_count = await get_assistant_message_count(tab)
        success = await try_send_message_now(tab, outline_prompt, previous_count=before_count)
        if not success:
            emit_log(f"[Truyện {story_idx+1}] Lỗi gửi prompt dàn ý")
            emit_story_update(story_idx, "Lỗi: Không gửi được dàn ý")
            return

        outline_reply = await get_reply_with_retry(
            tab,
            prompt=outline_prompt,
            previous_count=before_count,
            max_wait_sec=PROMPT_TIMEOUT_SEC,
            max_retries=2,
            log_fn=lambda msg: emit_log(f"[Truyện {story_idx+1}]{msg}"),
            post_reload_fn=lambda: tab.evaluate(fp_script),
        )

        if not outline_reply:
            outline_reply = "[Dàn ý rỗng sau 2 lần retry]"

        # Save outline
        outline_path = story_dir / "00_outline.txt"
        outline_path.write_text(
            f"Story: {title}\nOutline:\n\n{outline_reply}\n",
            encoding="utf-8"
        )
        emit_log(f"[Truyện {story_idx+1}] Dàn ý ({len(outline_reply)} chars) → {outline_path.name}")

        # Parse chapter names
        chapters = parse_chapters_from_outline(outline_reply, num_chapters)
        emit_log(f"[Truyện {story_idx+1}] {len(chapters)} phần: {', '.join(chapters[:5])}...")

        # ── Step 2: Send chapter prompts one by one ──
        for ch_idx, chapter_name in enumerate(chapters):
            emit_story_update(story_idx, f"Viết {chapter_name} ({ch_idx+1}/{len(chapters)})")
            emit_log(f"[Truyện {story_idx+1}] Gửi prompt {chapter_name}...")

            chapter_prompt = chapter_prompt_template.replace(
                "{chapter_name}", chapter_name
            ).replace(
                "{avg_words_per_chapter}", str(avg_words)
            )

            before_count = await get_assistant_message_count(tab)
            success = await try_send_message_now(tab, chapter_prompt, previous_count=before_count)
            if not success:
                emit_log(f"[Truyện {story_idx+1}] Lỗi gửi {chapter_name}")
                continue

            chapter_reply = await get_reply_with_retry(
                tab,
                prompt=chapter_prompt,
                previous_count=before_count,
                max_wait_sec=PROMPT_TIMEOUT_SEC,
                max_retries=2,
                log_fn=lambda msg: emit_log(f"[Truyện {story_idx+1}]{msg}"),
                post_reload_fn=lambda: tab.evaluate(fp_script),
            )

            if not chapter_reply:
                chapter_reply = f"[{chapter_name} - không lấy được sau 2 lần retry]"

            # Save chapter
            ch_file = story_dir / f"{ch_idx+1:02d}_{safe_filename(chapter_name)}.txt"
            ch_file.write_text(
                f"# {chapter_name}\n\n{chapter_reply}\n",
                encoding="utf-8"
            )
            emit_log(f"[Truyện {story_idx+1}] {chapter_name} ({len(chapter_reply)} chars) → {ch_file.name}")

        # ── Step 3: Ghép chỉ các CHƯƠNG thành 1 file đầy đủ ──
        # Lấy tên truyện từ JSON đầu vào (không dùng outline)
        story_title = story_json.get("title", title)

        # Chỉ lấy file chương (01_, 02_...), bỏ qua 00_outline.txt
        chapter_files = sorted(
            cf for cf in story_dir.glob("[0-9]*_*.txt")
            if not cf.name.startswith("00_")
        )

        full_text_parts = [story_title, ""]  # Dòng đầu = tên truyện, dòng trống
        for cf in chapter_files:
            try:
                content = cf.read_text(encoding="utf-8").strip()
                full_text_parts.append(content)
                full_text_parts.append("")  # Dòng trống giữa các chương
            except Exception:
                pass

        full_path = story_dir / f"{safe_title}_full.txt"
        full_path.write_text("\n".join(full_text_parts), encoding="utf-8")
        emit_log(f"[Truyện {story_idx+1}] Đã tạo file đầy đủ ({len(chapter_files)} chương): {full_path.name}")

        emit_story_update(story_idx, f"✅ Hoàn thành ({len(chapters)} phần)")
        emit_log(f"[Truyện {story_idx+1}] '{title}' hoàn thành!")

    except Exception as e:
        emit_log(f"[Truyện {story_idx+1}] Crash: {e}")
        emit_story_update(story_idx, f"Lỗi: {str(e)[:50]}")
    finally:
        if browser:
            try:
                browser._process_pid = None
                await asyncio.wait_for(browser.stop(), timeout=5.0)
            except Exception:
                pass
        if cache_dir and Path(cache_dir).exists():
            try:
                shutil.rmtree(cache_dir, ignore_errors=True)
            except Exception:
                pass


# ---------------------------------------------------------------------------
# Main async runner
# ---------------------------------------------------------------------------
async def run(config: dict):
    cookie_path = Path(config["cookie_file"]).expanduser().resolve()
    output_dir = Path(config.get("output_dir", "output/ChatGPT_Stories"))
    output_dir.mkdir(parents=True, exist_ok=True)

    json_list_raw = config.get("json_list", [])
    max_threads = max(1, min(10, int(config.get("max_threads", 2))))
    outline_prompt = config.get("outline_prompt", "Tạo dàn ý:\n{json_data}")
    chapter_prompt = config.get("chapter_prompt", "Viết {chapter_name}.")

    # Parse story JSONs, skip "SKIP" entries
    stories_to_process = []
    for idx, raw in enumerate(json_list_raw):
        if isinstance(raw, str) and raw.strip().upper() == "SKIP":
            continue
        try:
            parsed = json.loads(raw) if isinstance(raw, str) else raw
            stories_to_process.append((idx, parsed))
        except Exception as e:
            emit_log(f"[Truyện {idx+1}] JSON parse error: {e}")
            emit_story_update(idx, f"Lỗi JSON: {e}")

    if not stories_to_process:
        emit_log("Không có truyện nào cần xử lý.")
        emit_done()
        return

    # Load cookies
    cookies = load_cookies(cookie_path)
    emit_log(f"Loaded {len(cookies)} cookies from {cookie_path.name}")

    # Build CDP cookie params
    cookie_params = []
    for item in cookies:
        c = uc.cdp.network.CookieParam(
            name=item["name"],
            value=item["value"],
            domain=item.get("domain"),
            path=item.get("path", "/"),
            secure=item.get("secure"),
            http_only=item.get("httpOnly"),
        )
        if "url" in item:
            c.url = item["url"]
        ss = str(item.get("sameSite", "")).lower()
        if ss == "lax":
            c.same_site = uc.cdp.network.CookieSameSite.LAX
        elif ss == "strict":
            c.same_site = uc.cdp.network.CookieSameSite.STRICT
        elif ss in ("none", "no_restriction"):
            c.same_site = uc.cdp.network.CookieSameSite.NONE
        if "expires" in item:
            c.expires = uc.cdp.network.TimeSinceEpoch(float(item["expires"]))
        cookie_params.append(c)

    emit_log(f"Bắt đầu xử lý {len(stories_to_process)} truyện (max {max_threads} luồng)")

    cols = max(1, int(math.ceil(math.sqrt(max_threads))))

    # Process stories with concurrency limit
    semaphore = asyncio.Semaphore(max_threads)

    async def limited_process(story_idx, story_json, worker_slot):
        async with semaphore:
            await process_story(
                story_idx=story_idx,
                story_json=story_json,
                cookie_params=cookie_params,
                output_dir=output_dir,
                outline_prompt_template=outline_prompt,
                chapter_prompt_template=chapter_prompt,
                worker_id=worker_slot,
                cols=cols,
            )

    tasks = [
        limited_process(idx, sjson, slot)
        for slot, (idx, sjson) in enumerate(stories_to_process)
    ]
    await asyncio.gather(*tasks)

    emit_done()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
def main():
    import warnings
    warnings.filterwarnings(
        "ignore",
        message="unclosed transport",
        category=ResourceWarning,
    )

    if len(sys.argv) < 2:
        emit_error("Usage: python runner_story.py <config.json>")
        sys.exit(1)

    config_path = Path(sys.argv[1])
    if not config_path.exists():
        emit_error(f"Config not found: {config_path}")
        sys.exit(1)

    config = json.loads(config_path.read_text(encoding="utf-8"))

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(run(config))
    except Exception:
        emit_error(traceback.format_exc())
    finally:
        try:
            pending = asyncio.all_tasks(loop)
            for task in pending:
                task.cancel()
            if pending:
                loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
        except Exception:
            pass
        try:
            loop.run_until_complete(asyncio.sleep(0.25))
        except Exception:
            pass
        try:
            loop.run_until_complete(loop.shutdown_asyncgens())
        except Exception:
            pass
        try:
            loop.run_until_complete(loop.shutdown_default_executor())
        except Exception:
            pass
        loop.close()


if __name__ == "__main__":
    main()
