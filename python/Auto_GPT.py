from __future__ import annotations

import asyncio
import json
import math
import random
import sys
import tempfile
import time
import traceback
from datetime import datetime
from pathlib import Path
from typing import Optional

from PyQt6.QtCore import QSettings, QThread, pyqtSignal
from PyQt6.QtGui import QDesktopServices
from PyQt6.QtCore import QUrl
from PyQt6.QtWidgets import (
    QApplication,
    QFileDialog,
    QGridLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMainWindow,
    QMessageBox,
    QPlainTextEdit,
    QProgressBar,
    QPushButton,
    QSpinBox,
    QVBoxLayout,
    QWidget,
)

try:
    import nodriver as uc
except Exception as exc:
    print("Missing nodriver. Install:")
    print("  pip install nodriver")
    raise SystemExit(1) from exc


CHATGPT_URL = "https://chatgpt.com/"
DEFAULT_COOKIE_FILE = Path(__file__).with_name("chatgpt.com_24-02-2026.json")
DEFAULT_OUTPUT_DIR = Path.cwd() / "output" / "ChatGPT"
OUTPUT_CONTAINER_NAME = "ChatGPT"
MAX_TAB_COUNT = 10
PROMPT_TIMEOUT_SEC = 240
SEND_POLL_INTERVAL_SEC = 2.0
POST_TIMEOUT_RELOAD_WAIT_SEC = 10.0
COPY_BUTTON_SETTLE_SEC = 0.5
NEW_MESSAGE_GRACE_SEC = 8.0
CHARS_PER_MINUTE = 1000

TEXTAREA_SELECTORS = [
    'textarea[data-testid="prompt-textarea"]',
    "#prompt-textarea",
    'textarea[placeholder*="Message"]',
    'div[data-testid="prompt-textarea"][contenteditable="true"]',
    'div#prompt-textarea[contenteditable="true"]',
    'div.ProseMirror[contenteditable="true"]',
]

SEND_BUTTON_SELECTORS = [
    'button[data-testid="send-button"]',
    'button[aria-label*="Send"]',
]

ASSISTANT_TEXT_SELECTORS = [
    'div[data-message-author-role="assistant"]',
    '[data-testid^="conversation-turn-"] div[data-message-author-role="assistant"]',
    "article .markdown",
]

GENERATING_SELECTORS = [
    'button[data-testid="stop-button"]',
    'button[aria-label*="Stop"]',
]


# ---------------------------------------------------------------------------
# Browser Fingerprint Generator
# ---------------------------------------------------------------------------

_CHROME_VERSIONS = [
    "120.0.6099.109", "120.0.6099.130", "121.0.6167.85", "121.0.6167.160",
    "122.0.6261.69", "122.0.6261.112", "123.0.6312.58", "123.0.6312.122",
    "124.0.6367.60", "124.0.6367.118", "125.0.6422.60", "125.0.6422.112",
    "126.0.6478.56", "126.0.6478.127", "127.0.6533.72", "127.0.6533.100",
    "128.0.6613.84", "128.0.6613.138", "129.0.6668.58", "129.0.6668.100",
]

_PLATFORMS = [
    ("Win32", "Windows NT 10.0; Win64; x64"),
    ("Win32", "Windows NT 10.0; WOW64"),
    ("Win32", "Windows NT 11.0; Win64; x64"),
]

_LANGUAGES = [
    ["vi-VN", "vi", "en-US", "en"],
    ["vi", "en-US", "en"],
    ["vi-VN", "vi", "en"],
    ["vi", "en"],
    ["vi-VN", "en-US", "en", "vi"],
]

_WEBGL_RENDERERS = [
    ("Google Inc. (NVIDIA)", "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)"),
    ("Google Inc. (NVIDIA)", "ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)"),
    ("Google Inc. (NVIDIA)", "ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Direct3D11 vs_5_0 ps_5_0, D3D11)"),
    ("Google Inc. (NVIDIA)", "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)"),
    ("Google Inc. (NVIDIA)", "ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)"),
    ("Google Inc. (AMD)", "ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)"),
    ("Google Inc. (AMD)", "ANGLE (AMD, AMD Radeon RX 7800 XT Direct3D11 vs_5_0 ps_5_0, D3D11)"),
    ("Google Inc. (Intel)", "ANGLE (Intel, Intel(R) UHD Graphics 770 Direct3D11 vs_5_0 ps_5_0, D3D11)"),
    ("Google Inc. (Intel)", "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)"),
]

_SCREEN_RESOLUTIONS = [
    (1920, 1080), (2560, 1440), (1366, 768), (1536, 864),
    (1440, 900), (1680, 1050), (1600, 900), (3840, 2160),
    (2560, 1080), (3440, 1440),
]

_TIMEZONES = [
    "Asia/Ho_Chi_Minh",
]


def generate_fingerprint(seed: int = 0) -> dict:
    """Generate a unique, realistic browser fingerprint for anti-detection."""
    rng = random.Random(seed + int(time.time() * 1000) + random.randint(0, 99999))

    chrome_ver = rng.choice(_CHROME_VERSIONS)
    platform_js, platform_ua = rng.choice(_PLATFORMS)
    languages = rng.choice(_LANGUAGES)
    webgl_vendor, webgl_renderer = rng.choice(_WEBGL_RENDERERS)
    screen_w, screen_h = rng.choice(_SCREEN_RESOLUTIONS)
    hardware_concurrency = rng.choice([4, 6, 8, 12, 16])
    device_memory = rng.choice([4, 8, 16, 32])
    timezone = rng.choice(_TIMEZONES)
    max_touch_points = rng.choice([0, 0, 0, 1, 5, 10])
    color_depth = rng.choice([24, 30, 32])
    pixel_ratio = rng.choice([1.0, 1.25, 1.5, 2.0])
    canvas_noise_seed = rng.randint(1, 2**31)
    audio_noise_seed = rng.random() * 0.0001

    user_agent = f"Mozilla/5.0 ({platform_ua}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{chrome_ver} Safari/537.36"

    return {
        "user_agent": user_agent,
        "platform": platform_js,
        "languages": languages,
        "webgl_vendor": webgl_vendor,
        "webgl_renderer": webgl_renderer,
        "screen_width": screen_w,
        "screen_height": screen_h,
        "hardware_concurrency": hardware_concurrency,
        "device_memory": device_memory,
        "timezone": timezone,
        "max_touch_points": max_touch_points,
        "color_depth": color_depth,
        "pixel_ratio": pixel_ratio,
        "canvas_noise_seed": canvas_noise_seed,
        "audio_noise_seed": audio_noise_seed,
        "chrome_version": chrome_ver,
    }


def build_fingerprint_injection_script(fp: dict) -> str:
    """Build a JS script that overrides all detectable browser fingerprint APIs."""
    return f"""
    (() => {{
        // === Navigator overrides ===
        const nav = navigator;
        Object.defineProperty(nav, 'platform', {{ get: () => {json.dumps(fp['platform'])} }});
        Object.defineProperty(nav, 'hardwareConcurrency', {{ get: () => {fp['hardware_concurrency']} }});
        Object.defineProperty(nav, 'deviceMemory', {{ get: () => {fp['device_memory']} }});
        Object.defineProperty(nav, 'maxTouchPoints', {{ get: () => {fp['max_touch_points']} }});
        Object.defineProperty(nav, 'languages', {{ get: () => {json.dumps(fp['languages'])} }});
        Object.defineProperty(nav, 'language', {{ get: () => {json.dumps(fp['languages'][0])} }});

        // === WebGL spoofing ===
        const getParamOrig = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function(param) {{
            const UNMASKED_VENDOR = 0x9245;
            const UNMASKED_RENDERER = 0x9246;
            if (param === UNMASKED_VENDOR) return {json.dumps(fp['webgl_vendor'])};
            if (param === UNMASKED_RENDERER) return {json.dumps(fp['webgl_renderer'])};
            return getParamOrig.call(this, param);
        }};
        if (typeof WebGL2RenderingContext !== 'undefined') {{
            const getParam2Orig = WebGL2RenderingContext.prototype.getParameter;
            WebGL2RenderingContext.prototype.getParameter = function(param) {{
                const UNMASKED_VENDOR = 0x9245;
                const UNMASKED_RENDERER = 0x9246;
                if (param === UNMASKED_VENDOR) return {json.dumps(fp['webgl_vendor'])};
                if (param === UNMASKED_RENDERER) return {json.dumps(fp['webgl_renderer'])};
                return getParam2Orig.call(this, param);
            }};
        }}

        // === Canvas fingerprint noise ===
        const noiseSeed = {fp['canvas_noise_seed']};
        const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
        const origToBlob = HTMLCanvasElement.prototype.toBlob;
        const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;

        function addCanvasNoise(canvas) {{
            try {{
                const ctx = canvas.getContext('2d');
                if (!ctx) return;
                const w = canvas.width, h = canvas.height;
                if (w === 0 || h === 0) return;
                const imageData = origGetImageData.call(ctx, 0, 0, w, h);
                const d = imageData.data;
                let s = noiseSeed;
                for (let i = 0; i < d.length; i += 4) {{
                    s = (s * 1103515245 + 12345) & 0x7fffffff;
                    d[i] = (d[i] + ((s % 3) - 1)) & 0xff;
                }}
                ctx.putImageData(imageData, 0, 0);
            }} catch(e) {{}}
        }}

        HTMLCanvasElement.prototype.toDataURL = function() {{
            addCanvasNoise(this);
            return origToDataURL.apply(this, arguments);
        }};

        HTMLCanvasElement.prototype.toBlob = function() {{
            addCanvasNoise(this);
            return origToBlob.apply(this, arguments);
        }};

        // === Screen overrides ===
        Object.defineProperty(screen, 'width', {{ get: () => {fp['screen_width']} }});
        Object.defineProperty(screen, 'height', {{ get: () => {fp['screen_height']} }});
        Object.defineProperty(screen, 'availWidth', {{ get: () => {fp['screen_width']} }});
        Object.defineProperty(screen, 'availHeight', {{ get: () => {fp['screen_height'] - 40} }});
        Object.defineProperty(screen, 'colorDepth', {{ get: () => {fp['color_depth']} }});
        Object.defineProperty(screen, 'pixelDepth', {{ get: () => {fp['color_depth']} }});
        Object.defineProperty(window, 'devicePixelRatio', {{ get: () => {fp['pixel_ratio']} }});
        Object.defineProperty(window, 'outerWidth', {{ get: () => {fp['screen_width']} }});
        Object.defineProperty(window, 'outerHeight', {{ get: () => {fp['screen_height']} }});

        // === AudioContext fingerprint noise ===
        const audioNoise = {fp['audio_noise_seed']};
        if (typeof AudioContext !== 'undefined') {{
            const origGetChannelData = AudioBuffer.prototype.getChannelData;
            AudioBuffer.prototype.getChannelData = function(channel) {{
                const data = origGetChannelData.call(this, channel);
                for (let i = 0; i < data.length; i += 100) {{
                    data[i] += audioNoise;
                }}
                return data;
            }};
        }}

        // === Plugins & MimeTypes (non-empty for Windows) ===
        Object.defineProperty(nav, 'plugins', {{
            get: () => {{
                const arr = [{{ name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer' }},
                             {{ name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer' }}];
                arr.length = 2;
                return arr;
            }}
        }});

        // === WebDriver flag removal ===
        Object.defineProperty(nav, 'webdriver', {{ get: () => undefined }});
        delete nav.__proto__.webdriver;

        // === Chrome runtime mock ===
        if (!window.chrome) window.chrome = {{}};
        if (!window.chrome.runtime) window.chrome.runtime = {{ id: undefined }};

        // === Permission query override ===
        const origQuery = Permissions.prototype.query;
        Permissions.prototype.query = function(desc) {{
            if (desc && desc.name === 'notifications') {{
                return Promise.resolve({{ state: 'denied', onchange: null }});
            }}
            return origQuery.call(this, desc);
        }};
    }})();
    """


def now_stamp() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def ensure_chatgpt_output_root(path_text: str) -> Path:
    raw = (path_text or "").strip()
    base = Path(raw).expanduser().resolve() if raw else DEFAULT_OUTPUT_DIR.resolve()
    if base.name.lower() == OUTPUT_CONTAINER_NAME.lower():
        return base
    return (base / OUTPUT_CONTAINER_NAME).resolve()


def create_run_output_structure(root_dir: Path, frame_count: int) -> tuple[Path, dict[int, Path], str]:
    stamp = now_stamp()
    run_dir = root_dir / f"session_{stamp}"
    run_dir.mkdir(parents=True, exist_ok=True)

    frame_dirs: dict[int, Path] = {}
    for frame_id in range(1, frame_count + 1):
        win_dir = run_dir / f"win{frame_id}_{stamp}"
        win_dir.mkdir(parents=True, exist_ok=True)
        frame_dirs[frame_id] = win_dir

    return run_dir, frame_dirs, stamp


def normalize_same_site(value: str | None) -> str | None:
    if not value:
        return None
    v = str(value).strip().lower()
    if v == "lax":
        return "Lax"
    if v == "strict":
        return "Strict"
    if v in {"none", "no_restriction"}:
        return "None"
    return None


def load_cookies(cookie_path: Path) -> list[dict]:
    if not cookie_path.exists():
        raise FileNotFoundError(f"Cookie file not found: {cookie_path}")

    raw = json.loads(cookie_path.read_text(encoding="utf-8"))
    cookie_items: list[dict] = []
    if isinstance(raw, list):
        cookie_items = raw
    elif isinstance(raw, dict):
        cookies = raw.get("cookies")
        if isinstance(cookies, list):
            cookie_items = cookies
        else:
            cookie_items = [raw]

    prepared: list[dict] = []
    for item in cookie_items:
        if not isinstance(item, dict):
            continue
        name = item.get("name")
        value = item.get("value")
        if not name or value is None:
            continue

        cookie: dict = {"name": str(name), "value": str(value)}
        url = item.get("url")
        domain = item.get("domain")
        path = str(item.get("path") or "/")

        if isinstance(url, str) and url.strip():
            cookie["url"] = url.strip()
        elif isinstance(domain, str) and domain.strip():
            cookie["domain"] = domain.strip()
            cookie["path"] = path
        else:
            continue

        if "secure" in item:
            cookie["secure"] = bool(item.get("secure"))
        if "httpOnly" in item:
            cookie["httpOnly"] = bool(item.get("httpOnly"))

        same_site = normalize_same_site(item.get("sameSite"))
        if same_site:
            cookie["sameSite"] = same_site

        if not bool(item.get("session", False)):
            exp = item.get("expirationDate", item.get("expires"))
            if exp is not None:
                try:
                    cookie["expires"] = float(exp)
                except Exception:
                    pass

        prepared.append(cookie)

    if not prepared:
        raise RuntimeError("No valid cookies in cookie file.")
    return prepared


# ---------------------------------------------------------------------------
# nodriver async helpers (real browser, anti-detect)
# ---------------------------------------------------------------------------

async def find_visible(tab, selectors: list[str], timeout_ms: int):
    timeout_val = timeout_ms / 1000.0
    for selector in selectors:
        try:
            elem = await tab.wait_for(selector, timeout=timeout_val)
            if elem:
                return elem
        except Exception:
            continue
    return None


async def wait_for_chat_ready(tab, timeout_sec: int = 90) -> None:
    deadline = time.time() + timeout_sec
    last_error = "unknown"
    while time.time() < deadline:
        try:
            textbox = await find_visible(tab, TEXTAREA_SELECTORS, timeout_ms=1200)
            if textbox:
                return
        except Exception as exc:
            last_error = str(exc)

        try:
            await tab.reload()
            await asyncio.sleep(2)
        except Exception as exc:
            last_error = str(exc)
            await asyncio.sleep(0.8)

    raise RuntimeError(f"Web not ready after {timeout_sec}s. Last error: {last_error}")


async def has_send_button(tab) -> bool:
    script = """
    (() => {
        let stopBtn = document.querySelector('button[data-testid="stop-button"], button[aria-label*="Stop"], button[aria-label*="Dừng"]');
        if (stopBtn && stopBtn.offsetParent !== null) return false;
        let btn = document.querySelector('button[data-testid="send-button"]');
        if (btn && btn.offsetParent !== null) return true;
        let aria = document.querySelector('button[aria-label*="Send"], button[aria-label*="Gửi"]');
        if (aria && aria.offsetParent !== null) return true;
        let textarea = document.querySelector('textarea[data-testid="prompt-textarea"], #prompt-textarea, textarea[placeholder*="Message"], div[data-testid="prompt-textarea"][contenteditable="true"], div#prompt-textarea[contenteditable="true"], div.ProseMirror[contenteditable="true"]');
        if (!textarea) return false;
        if (textarea.offsetParent === null) return false;
        if (textarea.disabled || textarea.readOnly) return false;
        return true;
    })();
    """
    try:
        res = await tab.evaluate(script)
        return res is True
    except Exception:
        return False


async def scroll_to_chat_bottom(tab) -> None:
    script = """
    (() => {
        window.scrollTo(0, document.body.scrollHeight || document.documentElement.scrollHeight || 0);
        return true;
    })();
    """
    try:
        await tab.evaluate(script)
    except Exception:
        pass


async def is_generating(tab) -> bool:
    script = """
    (() => {
        let btn = document.querySelector('button[data-testid="stop-button"]');
        if (btn && btn.offsetParent !== null) return true;
        let aria = document.querySelector('button[aria-label*="Stop"], button[aria-label*="Dừng"]');
        if (aria && aria.offsetParent !== null) return true;
        return false;
    })();
    """
    try:
        res = await tab.evaluate(script)
        return res is True
    except Exception:
        return False


async def get_assistant_message_count(tab) -> int:
    for selector in ASSISTANT_TEXT_SELECTORS:
        try:
            elems = await tab.query_selector_all(selector)
            if elems:
                return len(elems)
        except Exception:
            pass
    return 0


async def get_last_assistant_text(tab) -> str:
    """Extract last assistant text — NO clipboard, pure DOM only."""
    await scroll_to_chat_bottom(tab)
    await asyncio.sleep(0.3)

    # ── Method 1: Simple synchronous JS (var syntax for max compat) ──
    js = (
        "var nodes = document.querySelectorAll("
        "'div[data-message-author-role=\"assistant\"] .markdown'"
        "); "
        "if (nodes.length > 0) { nodes[nodes.length - 1].innerText; } "
        "else { '' }"
    )
    try:
        result = await tab.evaluate(js)
        if result and isinstance(result, str) and len(result.strip()) > 2:
            return result.strip()
    except Exception as e:
        print(f"[DEBUG-extract] Method1 error: {e}")

    # ── Method 2: Try multiple selectors one-by-one via JS ──
    selectors_to_try = [
        'div[data-message-author-role="assistant"] .markdown',
        '.markdown',
        'div[data-message-author-role="assistant"]',
        'article .markdown',
        '.agent-turn .markdown',
        '[data-testid^="conversation-turn-"]',
    ]
    for sel in selectors_to_try:
        try:
            escaped = sel.replace("'", "\\'")
            check_js = f"document.querySelectorAll('{escaped}').length"
            count = await tab.evaluate(check_js)
            if count and int(count) > 0:
                text_js = (
                    f"var _n = document.querySelectorAll('{escaped}'); "
                    f"_n[_n.length - 1].innerText"
                )
                text = await tab.evaluate(text_js)
                if text and isinstance(text, str) and len(text.strip()) > 2:
                    print(f"[DEBUG-extract] Method2 OK via '{sel}', len={len(text.strip())}")
                    return text.strip()
                else:
                    print(f"[DEBUG-extract] Method2 sel='{sel}' count={count} but text empty/short, type={type(text)}")
        except Exception as e:
            print(f"[DEBUG-extract] Method2 sel='{sel}' error: {e}")

    # ── Method 3: nodriver native element API ──
    for sel in list(selectors_to_try)[:4]:
        try:
            elems = await tab.query_selector_all(sel)
            if elems:
                last = elems[-1]
                # nodriver Element might have .text or .text_all
                t = getattr(last, 'text_all', None) or getattr(last, 'text', None) or ''
                if callable(t):
                    t = t()
                t = str(t).strip() if t else ''
                if len(t) > 2:
                    print(f"[DEBUG-extract] Method3 OK via '{sel}', len={len(t)}")
                    return t
                print(f"[DEBUG-extract] Method3 sel='{sel}' found {len(elems)} elems but text empty")
        except Exception as e:
            print(f"[DEBUG-extract] Method3 sel='{sel}' error: {e}")

    print("[DEBUG-extract] ALL methods failed, returning empty")
    return ""


async def wait_for_generation_start(tab, previous_count: int, timeout_sec: float = 8.0) -> bool:
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        try:
            if await is_generating(tab):
                return True
        except Exception:
            pass
        try:
            if await get_assistant_message_count(tab) > previous_count:
                return True
        except Exception:
            pass
        await asyncio.sleep(0.4)
    return False


async def inject_prompt_text(tab, text: str) -> bool:
    payload = json.dumps(text)
    script = f"""
    (() => {{
        const prompt = {payload};
        const selectors = [
            'textarea[data-testid="prompt-textarea"]',
            '#prompt-textarea',
            'textarea[placeholder*="Message"]',
            'div[data-testid="prompt-textarea"][contenteditable="true"]',
            'div#prompt-textarea[contenteditable="true"]',
            'div.ProseMirror[contenteditable="true"]'
        ];

        const target = selectors
            .map((selector) => document.querySelector(selector))
            .find((node) => node && node.offsetParent !== null);
        if (!target) return false;

        target.focus();

        if (target instanceof HTMLTextAreaElement) {{
            target.value = '';
            target.dispatchEvent(new Event('input', {{ bubbles: true }}));
            target.value = prompt;
            target.dispatchEvent(new Event('input', {{ bubbles: true }}));
            target.dispatchEvent(new Event('change', {{ bubbles: true }}));
            return true;
        }}

        target.innerHTML = '';
        const lines = String(prompt).split(/\\n/);
        for (const line of lines) {{
            const p = document.createElement('p');
            p.textContent = line || '';
            target.appendChild(p);
        }}
        target.dispatchEvent(new InputEvent('input', {{
            bubbles: true,
            inputType: 'insertText',
            data: prompt
        }}));
        return true;
    }})();
    """
    try:
        res = await tab.evaluate(script)
        return res is True
    except Exception:
        return False


async def try_send_message_now(tab, text: str, previous_count: int | None = None) -> bool:
    await scroll_to_chat_bottom(tab)
    textbox = await find_visible(tab, TEXTAREA_SELECTORS, timeout_ms=1500)
    if textbox is None:
        return False

    sent = False
    injected = await inject_prompt_text(tab, text)
    if not injected:
        try:
            await textbox.click()
            await textbox.send_keys(text)
        except Exception:
            return False

    await asyncio.sleep(0.25)

    send_btn = await find_visible(tab, SEND_BUTTON_SELECTORS, timeout_ms=120)
    if send_btn is not None:
        try:
            await send_btn.click()
            sent = True
        except Exception:
            pass

    if not sent:
        try:
            await textbox.send_keys("\n")
            sent = True
        except Exception:
            return False

    if previous_count is None:
        return sent
    return await wait_for_generation_start(tab, previous_count=previous_count, timeout_sec=15.0)


def estimate_wait_seconds(expected_chars: int, minimum_wait_sec: float = 0.0) -> float:
    try:
        expected = max(0, int(expected_chars))
    except Exception:
        expected = 0
    estimated = (expected / float(CHARS_PER_MINUTE)) * 60.0 if expected else 0.0
    return max(estimated, float(minimum_wait_sec))


async def wait_for_new_assistant_message(tab, previous_count: int, timeout_sec: float = NEW_MESSAGE_GRACE_SEC) -> bool:
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        try:
            if await get_assistant_message_count(tab) > previous_count:
                return True
        except Exception:
            pass
        try:
            if await get_last_assistant_text(tab):
                return True
        except Exception:
            pass
        await asyncio.sleep(0.4)
    return False


async def capture_last_response(tab, previous_count: int | None = None) -> str:
    await scroll_to_chat_bottom(tab)
    if previous_count is not None:
        await wait_for_new_assistant_message(tab, previous_count=previous_count)
    reply = await get_last_assistant_text(tab)
    if reply:
        return reply
    return ""


async def wait_for_reply_by_send_button(
    tab,
    previous_count: int,
    max_wait_sec: float,
    poll_interval_sec: float = SEND_POLL_INTERVAL_SEC,
) -> str:
    deadline = time.time() + max_wait_sec
    while time.time() < deadline:
        await asyncio.sleep(poll_interval_sec)
        try:
            if await is_generating(tab):
                continue
            if await has_send_button(tab):
                reply = await capture_last_response(tab, previous_count=previous_count)
                if reply:
                    return reply
        except Exception:
            pass
    return ""


async def recover_reply_after_timeout(tab, previous_count: int) -> str:
    try:
        await tab.reload()
        await asyncio.sleep(POST_TIMEOUT_RELOAD_WAIT_SEC)
        await scroll_to_chat_bottom(tab)
        if await is_generating(tab):
            return ""
        if await has_send_button(tab):
            return await capture_last_response(tab, previous_count=previous_count)
    except Exception:
        return ""
    return ""


async def wait_for_reply_with_reload(
    tab,
    previous_count: int,
    max_wait_sec: float,
    poll_interval_sec: float = SEND_POLL_INTERVAL_SEC,
) -> str:
    reply = await wait_for_reply_by_send_button(
        tab,
        previous_count=previous_count,
        max_wait_sec=max_wait_sec,
        poll_interval_sec=poll_interval_sec,
    )
    if reply:
        return reply
    return await recover_reply_after_timeout(tab, previous_count=previous_count)


async def get_reply_with_retry(
    tab,
    prompt: str,
    previous_count: int,
    max_wait_sec: float = PROMPT_TIMEOUT_SEC,
    max_retries: int = 2,
    log_fn=None,
    post_reload_fn=None,
) -> str:
    """Get reply with full retry logic:
    1. Wait for reply normally
    2. If empty → reload page → try DOM extraction
    3. If still empty → re-send prompt and wait again
    Repeats up to max_retries times.
    post_reload_fn: async callable run after every reload (e.g. re-inject fingerprint)
    """
    def _log(msg):
        if log_fn:
            log_fn(msg)
        else:
            print(msg)

    async def _post_reload():
        if post_reload_fn:
            try:
                await post_reload_fn()
            except Exception:
                pass

    for attempt in range(max_retries + 1):
        if attempt == 0:
            # First attempt: normal wait
            reply = await wait_for_reply_with_reload(
                tab, previous_count=previous_count, max_wait_sec=max_wait_sec
            )
        else:
            # Retry: re-send prompt
            _log(f"  ↻ Retry {attempt}/{max_retries}: gửi lại prompt...")
            before = await get_assistant_message_count(tab)
            success = await try_send_message_now(tab, prompt, previous_count=before)
            if not success:
                _log(f"  ↻ Retry {attempt}: không gửi được, thử reload...")
                try:
                    await tab.reload()
                    await asyncio.sleep(5)
                    await _post_reload()
                    await wait_for_chat_ready(tab, timeout_sec=30)
                except Exception:
                    pass
                before = await get_assistant_message_count(tab)
                success = await try_send_message_now(tab, prompt, previous_count=before)
                if not success:
                    continue
            reply = await wait_for_reply_with_reload(
                tab, previous_count=before, max_wait_sec=max_wait_sec
            )

        # Check if we got a valid reply
        if reply and len(reply.strip()) > 5:
            return reply.strip()

        # Reply empty → try DOM extraction directly
        _log(f"  ⚠ Reply rỗng (attempt {attempt+1}), thử DOM trực tiếp...")
        try:
            reply = await get_last_assistant_text(tab)
            if reply and len(reply.strip()) > 5:
                return reply.strip()
        except Exception:
            pass

        # Still empty → reload page and try again
        _log(f"  ⚠ DOM cũng rỗng, reload page...")
        try:
            await tab.reload()
            await asyncio.sleep(POST_TIMEOUT_RELOAD_WAIT_SEC)
            await _post_reload()
            await scroll_to_chat_bottom(tab)
            reply = await get_last_assistant_text(tab)
            if reply and len(reply.strip()) > 5:
                return reply.strip()
        except Exception:
            pass

        if attempt < max_retries:
            _log(f"  ⚠ Vẫn rỗng sau reload, sẽ gửi lại prompt...")

    _log(f"  ✗ Hết {max_retries} lần retry, trả về rỗng")
    return ""


def save_reply(
    output_dir: Path,
    index: int,
    frame_id: int,
    frame_prompt_index: int,
    prompt: str,
    reply: str,
) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    file_path = output_dir / f"{index:03d}_p{frame_prompt_index}_{now_stamp()}.txt"
    payload = (
        f"Global Prompt #{index}\n"
        f"Frame: {frame_id}\n"
        f"Prompt in frame: {frame_prompt_index}\n\n"
        f"Prompt:\n{prompt}\n\nReply:\n{reply}\n"
    )
    file_path.write_text(payload, encoding="utf-8")
    return file_path


# ---------------------------------------------------------------------------
# SendWorker — nodriver async, real Chrome browser
# ---------------------------------------------------------------------------

class SendWorker(QThread):
    sig_log = pyqtSignal(str)
    sig_progress = pyqtSignal(int, int)
    sig_done = pyqtSignal()
    sig_error = pyqtSignal(str)

    def __init__(
        self,
        cookie_file: str,
        output_dir: str,
        prompts_by_frame: list[list[str]],
        frame_count: int,
        screen_rect: tuple[int, int, int, int],
    ):
        super().__init__()
        self.cookie_file = Path(cookie_file).expanduser().resolve()
        self.output_root = ensure_chatgpt_output_root(output_dir)
        self.frame_count = max(1, min(MAX_TAB_COUNT, int(frame_count)))
        normalized: list[list[str]] = []
        for i in range(self.frame_count):
            src = prompts_by_frame[i] if i < len(prompts_by_frame) else []
            normalized.append([str(x).strip() for x in src if str(x).strip()])
        self.prompts_by_frame = normalized
        self.screen_rect = screen_rect
        self.run_dir: Optional[Path] = None
        self.frame_output_dirs: dict[int, Path] = {}
        self._stop_requested = False

    def stop(self) -> None:
        self._stop_requested = True

    def _log(self, text: str) -> None:
        self.sig_log.emit(text)

    def _build_window_layout(self) -> list[tuple[int, int, int, int]]:
        sx, sy, sw, sh = self.screen_rect
        count = self.frame_count
        margin = 10

        cols = max(1, int(math.ceil(math.sqrt(count))))
        rows = max(1, int(math.ceil(count / cols)))

        cell_w = max(480, int((sw - margin * (cols + 1)) / cols))
        cell_h = max(360, int((sh - margin * (rows + 1)) / rows))

        rects: list[tuple[int, int, int, int]] = []
        for i in range(count):
            row = i // cols
            col = i % cols
            x = sx + margin + col * (cell_w + margin)
            y = sy + margin + row * (cell_h + margin)
            rects.append((x, y, cell_w, cell_h))
        return rects

    def run(self) -> None:
        try:
            self._loop = asyncio.new_event_loop()
            asyncio.set_event_loop(self._loop)
            self._loop.run_until_complete(self._async_run())
        except Exception:
            self.sig_error.emit(traceback.format_exc())
        finally:
            try:
                # Cancel all pending tasks to avoid 'Task was destroyed' warnings
                pending = asyncio.all_tasks(self._loop)
                for task in pending:
                    task.cancel()
                if pending:
                    self._loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
            except Exception:
                pass
            try:
                self._loop.run_until_complete(self._loop.shutdown_asyncgens())
            except Exception:
                pass
            self._loop.close()

    async def _async_run(self) -> None:
        try:
            cookies = load_cookies(self.cookie_file)
            self._log(f"Loaded {len(cookies)} cookies from {self.cookie_file.name}")

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

            windows = self._build_window_layout()

            total = sum(len(queue) for queue in self.prompts_by_frame)
            done_count = [0]
            self.sig_progress.emit(0, total)

            if total == 0:
                self._log("No prompts to send.")
                self.sig_done.emit()
                return

            self.output_root.mkdir(parents=True, exist_ok=True)
            self.run_dir, self.frame_output_dirs, run_stamp = create_run_output_structure(
                self.output_root,
                self.frame_count,
            )
            self._log(f"Run folder: {self.run_dir}")
            self._log(f"Session started: {run_stamp}")

            async def process_frame(worker_id):
                if worker_id >= len(windows):
                    return

                x, y, w, h = windows[worker_id]
                prompts = self.prompts_by_frame[worker_id] if worker_id < len(self.prompts_by_frame) else []
                if not prompts:
                    return

                browser = None
                try:
                    await asyncio.sleep(worker_id * 1)
                    fp = generate_fingerprint(seed=worker_id)
                    self._log(
                        f"Đang mở Khung {worker_id+1}... "
                        f"(UA: Chrome/{fp['chrome_version']}, "
                        f"GPU: {fp['webgl_renderer'][:40]}..., "
                        f"Screen: {fp['screen_width']}x{fp['screen_height']})"
                    )
                    # Unique cache dir per browser to avoid 'Access is denied' conflicts
                    cache_dir = tempfile.mkdtemp(prefix=f'uc_cache_{worker_id}_')
                    browser = await uc.start(
                        headless=False,
                        browser_args=[
                            f"--window-position={x},{y}",
                            f"--window-size={w},{h}",
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

                    # Set timezone via CDP
                    try:
                        await tab.send(uc.cdp.emulation.set_timezone_override(
                            timezone_id=fp['timezone']
                        ))
                    except Exception:
                        pass


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

                    # Re-inject fingerprint after page load (page navigation resets JS context)
                    try:
                        await tab.evaluate(fp_script)
                    except Exception:
                        pass

                    try:
                        await wait_for_chat_ready(tab, timeout_sec=90)
                    except Exception as e:
                        self._log(f"[Khung {worker_id+1}] Start error: {e}")
                        return

                    for prompt_idx, p in enumerate(prompts):
                        if self._stop_requested:
                            self._log(f"[Khung {worker_id+1}] Dừng theo yêu cầu.")
                            break

                        before_count = await get_assistant_message_count(tab)
                        self._log(f"[Khung {worker_id+1}] Gửi prompt {prompt_idx+1}...")
                        success = await try_send_message_now(tab, p, previous_count=before_count)

                        if not success:
                            self._log(f"[Khung {worker_id+1}] Lỗi: Không tìm thấy ô nhập liệu.")
                            await asyncio.sleep(2)
                            continue

                        final_reply = await get_reply_with_retry(
                            tab,
                            prompt=p,
                            previous_count=before_count,
                            max_wait_sec=PROMPT_TIMEOUT_SEC,
                            max_retries=2,
                            log_fn=lambda msg: self._log(f"[Khung {worker_id+1}]{msg}"),
                        )

                        if not final_reply:
                            final_reply = "[Không lấy được nội dung sau 2 lần retry]"

                        # Luôn lưu file (kể cả reply rỗng để debug)
                        saved = save_reply(
                            self.frame_output_dirs.get(worker_id+1, self.run_dir or self.output_root),
                            prompt_idx+1,
                            worker_id+1,
                            prompt_idx+1,
                            p,
                            final_reply,
                        )
                        self._log(f"[Khung {worker_id+1}] Đã lưu ({len(final_reply)} chars): {saved}")

                        done_count[0] += 1
                        self.sig_progress.emit(done_count[0], total)

                except Exception as e:
                    self._log(f"[Khung {worker_id+1}] Crash: {e}")
                finally:
                    if browser:
                        try:
                            self._log(f"[Khung {worker_id+1}] Đóng trình duyệt...")
                            browser._process_pid = None  # prevent kill errors
                            await asyncio.wait_for(browser.stop(), timeout=5.0)
                        except Exception:
                            pass
                    # Clean up cache dir
                    try:
                        import shutil
                        if 'cache_dir' in dir() and Path(cache_dir).exists():
                            shutil.rmtree(cache_dir, ignore_errors=True)
                    except Exception:
                        pass

            tasks = [process_frame(i) for i in range(self.frame_count)]
            await asyncio.gather(*tasks)

            if self.run_dir is not None:
                summary_path = self.run_dir / "run_summary.json"
                summary_payload = {
                    "session": self.run_dir.name,
                    "frame_count": self.frame_count,
                    "total_prompts": total,
                    "completed_prompts": done_count[0],
                    "stopped": self._stop_requested,
                    "created_at": datetime.now().isoformat(timespec="seconds"),
                }
                summary_path.write_text(
                    json.dumps(summary_payload, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )
                self._log(f"Summary: {summary_path}")

            self.sig_done.emit()
        except Exception:
            self.sig_error.emit(traceback.format_exc())


# ---------------------------------------------------------------------------
# MainWindow — PyQt6 GUI (unchanged)
# ---------------------------------------------------------------------------

class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("ChatGPT Auto Sender")
        self.resize(980, 700)
        self.setMinimumSize(840, 620)

        self.settings = QSettings("AutoWhisk", "ChatGPTAutoSender")
        self.worker: Optional[SendWorker] = None
        self.prompt_boxes: list[QPlainTextEdit] = []

        self._build_ui()
        self._bind_events()
        self._load_state()
        self._apply_style()

    def _build_ui(self) -> None:
        root = QWidget(self)
        self.setCentralWidget(root)
        layout = QVBoxLayout(root)
        layout.setContentsMargins(10, 10, 10, 10)
        layout.setSpacing(8)

        cookie_row = QHBoxLayout()
        cookie_row.setSpacing(6)
        cookie_row.addWidget(QLabel("Cookie ChatGPT"))
        self.cookie_edit = QLineEdit(str(DEFAULT_COOKIE_FILE))
        self.cookie_browse_btn = QPushButton("Chon file")
        cookie_row.addWidget(self.cookie_edit, 1)
        cookie_row.addWidget(self.cookie_browse_btn)

        out_row = QHBoxLayout()
        out_row.setSpacing(6)
        out_row.addWidget(QLabel("Thu muc output"))
        self.output_edit = QLineEdit(str(DEFAULT_OUTPUT_DIR))
        self.output_browse_btn = QPushButton("Chon thu muc")
        self.open_output_btn = QPushButton("Mo output")
        out_row.addWidget(self.output_edit, 1)
        out_row.addWidget(self.output_browse_btn)
        out_row.addWidget(self.open_output_btn)

        frame_row = QHBoxLayout()
        frame_row.setSpacing(6)
        frame_row.addWidget(QLabel("So khung trinh duyet"))
        self.frame_count_spin = QSpinBox()
        self.frame_count_spin.setRange(1, MAX_TAB_COUNT)
        self.frame_count_spin.setValue(2)
        self.frame_count_spin.setSuffix(" khung")
        self.frame_count_spin.setToolTip("Toi da 10 khung")
        frame_row.addWidget(self.frame_count_spin)
        frame_row.addWidget(QLabel("(max 10)"))
        frame_row.addStretch(1)

        prompt_label = QLabel("O prompt (1 o = 1 khung, moi dong = 1 prompt)")
        self.prompt_boxes_host = QWidget()
        self.prompt_boxes_layout = QGridLayout(self.prompt_boxes_host)
        self.prompt_boxes_layout.setContentsMargins(0, 0, 0, 0)
        self.prompt_boxes_layout.setHorizontalSpacing(8)
        self.prompt_boxes_layout.setVerticalSpacing(8)
        self._rebuild_prompt_boxes(int(self.frame_count_spin.value()))

        action_row = QHBoxLayout()
        action_row.setSpacing(6)
        self.start_btn = QPushButton("Bat dau gui")
        self.start_btn.setObjectName("startBtn")
        self.stop_btn = QPushButton("Dung")
        self.stop_btn.setObjectName("stopBtn")
        self.stop_btn.setDisabled(True)
        action_row.addWidget(self.start_btn)
        action_row.addWidget(self.stop_btn)
        action_row.addStretch(1)

        self.progress = QProgressBar()
        self.progress.setValue(0)
        self.progress_text = QLabel("0/0")

        self.log_edit = QPlainTextEdit()
        self.log_edit.setReadOnly(True)
        self.log_edit.setMaximumBlockCount(1500)

        layout.addLayout(cookie_row)
        layout.addLayout(out_row)
        layout.addLayout(frame_row)
        layout.addWidget(prompt_label)
        layout.addWidget(self.prompt_boxes_host, 1)
        layout.addLayout(action_row)
        layout.addWidget(self.progress)
        layout.addWidget(self.progress_text)
        layout.addWidget(QLabel("Nhat ky"))
        layout.addWidget(self.log_edit, 1)

    def _apply_style(self) -> None:
        self.setStyleSheet(
            """
            QWidget {
                font-family: "Segoe UI";
                font-size: 12px;
            }
            QLabel {
                color: #dbe7ff;
            }
            QMainWindow, QWidget {
                background-color: #0f1622;
            }
            QLineEdit, QPlainTextEdit, QSpinBox {
                background-color: #0c1320;
                color: #e9f0ff;
                border: 1px solid #2b3b56;
                border-radius: 7px;
                padding: 6px;
            }
            QPushButton {
                background-color: #1b2940;
                color: #deebff;
                border: 1px solid #35517f;
                border-radius: 7px;
                padding: 6px 10px;
                min-height: 28px;
            }
            QPushButton:hover {
                background-color: #263858;
            }
            QPushButton#startBtn {
                background-color: #1f8f4e;
                border-color: #2fb86a;
                color: #f3fff8;
                font-weight: 600;
            }
            QPushButton#startBtn:hover {
                background-color: #28a65d;
            }
            QPushButton#stopBtn {
                background-color: #9e3a3a;
                border-color: #c95d5d;
                color: #fff5f5;
                font-weight: 600;
            }
            QPushButton#stopBtn:hover {
                background-color: #b24646;
            }
            QPushButton:disabled {
                background-color: #1a2436;
                color: #798aa8;
                border-color: #2a3444;
            }
            QProgressBar {
                border: 1px solid #2b3b56;
                border-radius: 7px;
                text-align: center;
                min-height: 18px;
                color: #dbe7ff;
                background: #0c1320;
            }
            QProgressBar::chunk {
                border-radius: 6px;
                background: #2f81f7;
            }
            QScrollBar:vertical {
                width: 10px;
                background: transparent;
                margin: 2px;
            }
            QScrollBar::handle:vertical {
                background: #2a3f62;
                border-radius: 5px;
            }
            QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {
                height: 0px;
            }
            """
        )

    def _collect_prompt_box_texts(self) -> list[str]:
        return [box.toPlainText() for box in self.prompt_boxes]

    def _rebuild_prompt_boxes(self, frame_count: int, restore_texts: Optional[list[str]] = None) -> None:
        texts = restore_texts if restore_texts is not None else self._collect_prompt_box_texts()

        while self.prompt_boxes_layout.count():
            item = self.prompt_boxes_layout.takeAt(0)
            w = item.widget()
            if w is not None:
                w.deleteLater()

        self.prompt_boxes = []
        count = max(1, min(MAX_TAB_COUNT, int(frame_count)))
        cols = 2 if count > 1 else 1
        rows = int(math.ceil(count / cols))

        for idx in range(count):
            holder = QWidget()
            holder_layout = QVBoxLayout(holder)
            holder_layout.setContentsMargins(0, 0, 0, 0)
            holder_layout.setSpacing(4)

            title = QLabel(f"Khung {idx + 1}")
            editor = QPlainTextEdit()
            editor.setPlaceholderText(f"Prompt cho khung {idx + 1} (moi dong 1 prompt)")
            editor.setMinimumHeight(120 if rows > 1 else 180)
            if idx < len(texts):
                editor.setPlainText(texts[idx])
            self.prompt_boxes.append(editor)

            holder_layout.addWidget(title)
            holder_layout.addWidget(editor, 1)

            row = idx // cols
            col = idx % cols
            self.prompt_boxes_layout.addWidget(holder, row, col)

    def _bind_events(self) -> None:
        self.cookie_browse_btn.clicked.connect(self._pick_cookie_file)
        self.output_browse_btn.clicked.connect(self._pick_output_dir)
        self.open_output_btn.clicked.connect(self._open_output_dir)
        self.frame_count_spin.valueChanged.connect(self._on_frame_count_changed)
        self.start_btn.clicked.connect(self._start)
        self.stop_btn.clicked.connect(self._stop)

    def _on_frame_count_changed(self, value: int) -> None:
        self._rebuild_prompt_boxes(value)

    def _load_state(self) -> None:
        cookie = str(self.settings.value("cookie_file", self.cookie_edit.text()) or "").strip()
        out_dir = str(self.settings.value("output_dir", self.output_edit.text()) or "").strip()
        prompts_json = str(self.settings.value("prompts_by_frame", "") or "").strip()
        legacy_prompts = str(self.settings.value("prompts", "") or "")
        frame_count = int(
            self.settings.value(
                "frame_count",
                self.settings.value("tab_count", self.frame_count_spin.value()),
            )
        )
        if cookie:
            self.cookie_edit.setText(cookie)
        normalized_out = ensure_chatgpt_output_root(out_dir)
        self.output_edit.setText(str(normalized_out))
        frame_count = max(1, min(MAX_TAB_COUNT, frame_count))
        self.frame_count_spin.setValue(frame_count)

        restored: list[str] = []
        if prompts_json:
            try:
                parsed = json.loads(prompts_json)
                if isinstance(parsed, list):
                    restored = [str(x) for x in parsed]
            except Exception:
                restored = []

        if not restored and legacy_prompts:
            restored = [legacy_prompts]
        if not restored:
            restored = ["xin chao"]

        self._rebuild_prompt_boxes(frame_count, restore_texts=restored)

    def _save_state(self) -> None:
        self.settings.setValue("cookie_file", self.cookie_edit.text().strip())
        self.settings.setValue("output_dir", str(ensure_chatgpt_output_root(self.output_edit.text().strip())))
        prompts_by_frame = self._collect_prompt_box_texts()
        self.settings.setValue("prompts_by_frame", json.dumps(prompts_by_frame, ensure_ascii=False))
        self.settings.setValue("prompts", "\n".join(prompts_by_frame))
        self.settings.setValue("frame_count", int(self.frame_count_spin.value()))
        self.settings.sync()

    def _log(self, text: str) -> None:
        ts = datetime.now().strftime("%H:%M:%S")
        self.log_edit.appendPlainText(f"[{ts}] {text}")

    def _pick_cookie_file(self) -> None:
        selected, _ = QFileDialog.getOpenFileName(
            self,
            "Select cookie JSON",
            str(Path.cwd()),
            "JSON files (*.json);;All files (*.*)",
        )
        if selected:
            self.cookie_edit.setText(selected)

    def _pick_output_dir(self) -> None:
        selected = QFileDialog.getExistingDirectory(
            self,
            "Select output directory",
            self.output_edit.text().strip() or str(Path.cwd()),
        )
        if selected:
            self.output_edit.setText(str(ensure_chatgpt_output_root(selected)))

    def _open_output_dir(self) -> None:
        path = ensure_chatgpt_output_root(self.output_edit.text().strip() or str(DEFAULT_OUTPUT_DIR))
        path.mkdir(parents=True, exist_ok=True)
        QDesktopServices.openUrl(QUrl.fromLocalFile(str(path)))

    def _parse_prompts_by_frame(self) -> list[list[str]]:
        queues: list[list[str]] = []
        for box in self.prompt_boxes:
            lines = box.toPlainText().splitlines()
            queues.append([line.strip() for line in lines if line.strip()])
        return queues

    def _set_busy(self, busy: bool) -> None:
        self.start_btn.setDisabled(busy)
        self.stop_btn.setDisabled(not busy)
        self.cookie_edit.setDisabled(busy)
        self.output_edit.setDisabled(busy)
        self.frame_count_spin.setDisabled(busy)
        for box in self.prompt_boxes:
            box.setDisabled(busy)
        self.cookie_browse_btn.setDisabled(busy)
        self.output_browse_btn.setDisabled(busy)

    def _start(self) -> None:
        if self.worker and self.worker.isRunning():
            QMessageBox.warning(self, "Running", "Task is already running.")
            return

        cookie_file = self.cookie_edit.text().strip()
        output_path = ensure_chatgpt_output_root(self.output_edit.text().strip() or str(DEFAULT_OUTPUT_DIR))
        self.output_edit.setText(str(output_path))
        output_dir = str(output_path)
        prompts_by_frame = self._parse_prompts_by_frame()
        total_prompts = sum(len(x) for x in prompts_by_frame)
        frame_count = int(self.frame_count_spin.value())

        if not cookie_file:
            QMessageBox.warning(self, "Missing cookie file", "Please choose cookie JSON file.")
            return
        if total_prompts <= 0:
            QMessageBox.warning(self, "Missing prompts", "Enter prompt in at least one frame box.")
            return

        self._save_state()
        self.log_edit.clear()
        self._set_busy(True)
        self.progress.setValue(0)
        self.progress_text.setText(f"0/{total_prompts}")
        self._log(
            f"Starting automation with {frame_count} window(s), "
            "send immediately when chat is ready..."
        )
        self._log(f"Output root: {output_dir}")

        screen = QApplication.primaryScreen()
        if screen is not None:
            g = screen.availableGeometry()
            screen_rect = (g.x(), g.y(), g.width(), g.height())
        else:
            screen_rect = (0, 0, 1920, 1080)

        self.worker = SendWorker(cookie_file, output_dir, prompts_by_frame, frame_count, screen_rect)
        self.worker.sig_log.connect(self._log)
        self.worker.sig_progress.connect(self._on_progress)
        self.worker.sig_done.connect(self._on_done)
        self.worker.sig_error.connect(self._on_error)
        self.worker.start()

    def _stop(self) -> None:
        if self.worker and self.worker.isRunning():
            self.worker.stop()
            self._log("Stop requested.")

    def _on_progress(self, done: int, total: int) -> None:
        total_safe = max(1, total)
        self.progress.setValue(int((done * 100) / total_safe))
        self.progress_text.setText(f"{done}/{total}")

    def _on_done(self) -> None:
        self._set_busy(False)
        self._log("Completed.")
        QMessageBox.information(self, "Done", "Auto send finished.")

    def _on_error(self, err_text: str) -> None:
        self._set_busy(False)
        self._log("Error occurred.")
        self._log(err_text)
        QMessageBox.critical(self, "Error", err_text)

    def closeEvent(self, event) -> None:  # type: ignore[override]
        self._save_state()
        if self.worker and self.worker.isRunning():
            self.worker.stop()
            self.worker.wait(3000)
        super().closeEvent(event)


def main() -> None:
    app = QApplication(sys.argv)
    win = MainWindow()
    win.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
