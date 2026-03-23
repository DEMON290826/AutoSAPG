"""
runner.py — Python backend for Test module (chatgpt-sender-ui).
Uses nodriver (real browser, anti-detect) + fingerprint.
Communicates with Electron via JSON lines on stdout.
"""
from __future__ import annotations

import asyncio
import json
import math
import random
import shutil
import sys
import tempfile
import time
import traceback
from datetime import datetime
from pathlib import Path

# Force UTF-8 stdout/stderr on Windows (avoid charmap codec errors)
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
    1. Same dir as runner.py (packaged: resources/python/ -> resources/)
    2. Next to python exe (packaged: resources/Auto_GPT.py)
    3. Dev: Auto_All/ (grandparent of chatgpt-sender-ui/python/)
    """
    candidates = [
        Path(__file__).resolve().parent.parent,          # resources/
        Path(sys.executable).parent,                     # next to python.exe
        Path(__file__).resolve().parent.parent.parent,   # dev: Auto_All/
    ]
    for c in candidates:
        if (c / "Auto_GPT.py").exists():
            return c
    # Last resort: let Python raise ImportError naturally
    return candidates[-1]

ROOT = _find_auto_gpt_root()
sys.path.insert(0, str(ROOT))

from Auto_GPT import (
    CHATGPT_URL,
    PROMPT_TIMEOUT_SEC,
    load_cookies,
    ensure_chatgpt_output_root,
    create_run_output_structure,
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
    save_reply,
    generate_fingerprint,
    build_fingerprint_injection_script,
    TEXTAREA_SELECTORS,
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


def emit_done():
    emit("done")


def emit_error(text: str):
    emit("error", message=text)


# ---------------------------------------------------------------------------
# Main async runner
# ---------------------------------------------------------------------------
async def run(config: dict):
    cookie_path = Path(config["cookie_file"]).expanduser().resolve()
    output_dir_str = config.get("output_dir", "")
    frame_count = max(1, min(10, int(config.get("frame_count", 1))))
    prompts_by_frame_raw = config.get("prompts_by_frame", [])

    # Normalize prompts
    prompts_by_frame: list[list[str]] = []
    for i in range(frame_count):
        src = prompts_by_frame_raw[i] if i < len(prompts_by_frame_raw) else []
        prompts_by_frame.append([str(x).strip() for x in src if str(x).strip()])

    total = sum(len(q) for q in prompts_by_frame)
    if total == 0:
        emit_log("No prompts to send.")
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

    # Prepare output
    output_root = ensure_chatgpt_output_root(output_dir_str)
    output_root.mkdir(parents=True, exist_ok=True)
    run_dir, frame_dirs, run_stamp = create_run_output_structure(output_root, frame_count)
    emit_log(f"Run folder: {run_dir}")
    emit_log(f"Session started: {run_stamp}")

    # Screen layout
    screen_w, screen_h = 1920, 1080
    margin = 10
    cols = max(1, int(math.ceil(math.sqrt(frame_count))))
    rows = max(1, int(math.ceil(frame_count / cols)))
    cell_w = max(480, int((screen_w - margin * (cols + 1)) / cols))
    cell_h = max(360, int((screen_h - margin * (rows + 1)) / rows))

    done_count = [0]
    emit_progress(0, total)

    async def process_frame(worker_id: int):
        prompts = prompts_by_frame[worker_id] if worker_id < len(prompts_by_frame) else []
        if not prompts:
            return

        row = worker_id // cols
        col = worker_id % cols
        x = margin + col * (cell_w + margin)
        y = margin + row * (cell_h + margin)

        browser = None
        try:
            await asyncio.sleep(worker_id * 1)
            fp = generate_fingerprint(seed=worker_id)
            emit_log(
                f"Đang mở Khung {worker_id+1}... "
                f"(Chrome/{fp['chrome_version']}, "
                f"GPU: {fp['webgl_renderer'][:35]}..., "
                f"Screen: {fp['screen_width']}x{fp['screen_height']})"
            )
            # Unique cache dir per browser to avoid 'Access is denied' conflicts
            cache_dir = tempfile.mkdtemp(prefix=f'uc_cache_{worker_id}_')
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

            # Inject fingerprint BEFORE navigating
            fp_script = build_fingerprint_injection_script(fp)
            try:
                await tab.evaluate(fp_script)
            except Exception:
                pass

            # Set timezone
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

            # Re-inject fingerprint after page load
            try:
                await tab.evaluate(fp_script)
            except Exception:
                pass

            try:
                await wait_for_chat_ready(tab, timeout_sec=90)
            except Exception as e:
                emit_log(f"[Khung {worker_id+1}] Start error: {e}")
                return

            for prompt_idx, p in enumerate(prompts):
                before_count = await get_assistant_message_count(tab)
                emit_log(f"[Khung {worker_id+1}] Gửi prompt {prompt_idx+1}/{len(prompts)}...")
                success = await try_send_message_now(tab, p, previous_count=before_count)

                if not success:
                    emit_log(f"[Khung {worker_id+1}] Lỗi: Không tìm thấy ô nhập liệu.")
                    await asyncio.sleep(2)
                    continue

                final_reply = await get_reply_with_retry(
                    tab,
                    prompt=p,
                    previous_count=before_count,
                    max_wait_sec=PROMPT_TIMEOUT_SEC,
                    max_retries=2,
                    log_fn=lambda msg: emit_log(f"[Khung {worker_id+1}]{msg}"),
                )

                if not final_reply:
                    final_reply = "[Không lấy được nội dung sau 2 lần retry]"

                saved = save_reply(
                    frame_dirs.get(worker_id + 1, run_dir),
                    prompt_idx + 1,
                    worker_id + 1,
                    prompt_idx + 1,
                    p,
                    final_reply,
                )
                emit_log(f"[Khung {worker_id+1}] Đã lưu ({len(final_reply)} chars): {saved.name}")

                done_count[0] += 1
                emit_progress(done_count[0], total)

        except Exception as e:
            emit_log(f"[Khung {worker_id+1}] Crash: {e}")
        finally:
            if browser:
                try:
                    emit_log(f"[Khung {worker_id+1}] Đóng trình duyệt...")
                    browser._process_pid = None
                    await asyncio.wait_for(browser.stop(), timeout=5.0)
                except Exception:
                    pass
            # Clean up cache dir
            try:
                if 'cache_dir' in dir() and Path(cache_dir).exists():
                    shutil.rmtree(cache_dir, ignore_errors=True)
            except Exception:
                pass

    tasks = [process_frame(i) for i in range(frame_count)]
    await asyncio.gather(*tasks)

    # Summary
    if run_dir:
        summary_path = run_dir / "run_summary.json"
        summary = {
            "session": run_dir.name,
            "frame_count": frame_count,
            "total_prompts": total,
            "completed_prompts": done_count[0],
            "created_at": datetime.now().isoformat(timespec="seconds"),
        }
        summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
        emit_log(f"Summary: {summary_path}")

    emit_done()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
def main():
    if len(sys.argv) < 2:
        emit_error("Usage: python runner.py <config.json>")
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
        # Cancel all pending tasks to avoid 'Task was destroyed' warnings
        try:
            pending = asyncio.all_tasks(loop)
            for task in pending:
                task.cancel()
            if pending:
                loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
        except Exception:
            pass
        try:
            loop.run_until_complete(loop.shutdown_asyncgens())
        except Exception:
            pass
        loop.close()


if __name__ == "__main__":
    main()
