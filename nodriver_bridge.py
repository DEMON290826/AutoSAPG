import asyncio
import json
import os
import sys

import nodriver as uc

browser = None
page = None
last_response_text = ""
awaiting_new_response = False

def log(msg: str):
    sys.stderr.write(msg + "\n")
    sys.stderr.flush()

async def get_assistant_text():
    global page
    if not page:
        return ""
    
    script = """
    (() => {
        const nodes = Array.from(document.querySelectorAll('[data-message-author-role="assistant"]'));
        if (!nodes.length) return "";
        const lastNode = nodes[nodes.length - 1];
        
        // Remove reasoning/thought blocks so we only get the real text
        const clone = lastNode.cloneNode(true);
        const thoughts = clone.querySelectorAll('.mt-5.mb-2, details, .thought-block, .reasoning-block, [class*="thought"], [class*="reasoning"]'); 
        thoughts.forEach(t => t.remove());
        
        // Clean up some common artifacts
        return clone.innerText.trim();
    })();
    """
    try:
        result = await page.evaluate(script)
        return str(result or "").strip()
    except Exception as e:
        log(f"Error getting text: {e}")
        return ""

async def wait_for_composer():
    global page
    selectors = [
        "#prompt-textarea",
        "div[contenteditable='true'][role='textbox']",
        "textarea[placeholder*='Message']"
    ]
    
    for _ in range(60): # 30 seconds wait
        for sel in selectors:
            try:
                el = await page.select(sel, timeout=0.1)
                if el: return el
            except:
                pass
                
        # Handle simple popups
        try:
            btn = await page.find("Chấp nhận", best_match=True, timeout=0.1)
            if btn: await btn.click()
        except: pass
        try:
            btn = await page.find("Đóng", best_match=True, timeout=0.1)
            if btn: await btn.click()
        except: pass
        
        await asyncio.sleep(0.5)
        
    raise Exception("Không tìm thấy ô nhập liệu, có thể đang bị chặn hoặc chưa đăng nhập thành công.")

async def start_browser(url: str, cookie_file: str, window_index: int = 0):
    global browser, page
    try:
        log(f"Khởi chạy Chromium với nodriver (Window Index: {window_index})...")
        if window_index is not None:
            try:
                idx = int(window_index) % 10  # Max 10 frames
                # 5 columns x 2 rows
                col = idx % 5
                row = (idx // 5) % 2
                
                # Assume 1920x1080 screen
                w = 1920 // 5  # 384
                h = 1080 // 2  # 540
                x = col * w
                y = row * h
                browser_args = [f"--window-size={w},{h}", f"--window-position={x},{y}"]
                browser = await uc.start(browser_args=browser_args)
            except Exception as ex:
                log(f"Lỗi setup geometry, fallback: {ex}")
                browser = await uc.start()
        else:
            browser = await uc.start()
        
        log(f"Đang truy cập {url} ...")
        page = await browser.get(url)
        await asyncio.sleep(3) # Wait for CF passing or initial load
        
        # Cookie Injection
        if cookie_file and os.path.exists(cookie_file):
            log("Đang nạp Cookie từ JSON...")
            try:
                with open(cookie_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                cookies = data if isinstance(data, list) else data.get('cookies', [])
                
                for c in cookies:
                    name = c.get('name')
                    value = c.get('value')
                    domain = c.get('domain')
                    if not name or value is None: continue
                    
                    params = {
                        "name": str(name),
                        "value": str(value),
                        "domain": str(domain) if domain else ".chatgpt.com",
                        "path": str(c.get("path", "/")),
                        "secure": bool(c.get("secure", True)),
                        "http_only": bool(c.get("httpOnly", False))
                    }
                    
                    same_site_str = str(c.get("sameSite", "Lax")).upper()
                    if hasattr(uc.cdp.network.CookieSameSite, same_site_str):
                        params["same_site"] = getattr(uc.cdp.network.CookieSameSite, same_site_str)
                        
                    expires = c.get("expirationDate") or c.get("expires")
                    if expires:
                        params["expires"] = uc.cdp.network.TimeSinceEpoch(float(expires))
                        
                    try:
                        await page.send(uc.cdp.network.set_cookie(**params))
                    except Exception as e:
                        log(f"Lỗi nạp cookie {name}: {e}")
                        
                log(f"Đã nạp {len(cookies)} cookie xong. Đang tải lại trang...")
                await page.reload()
                await asyncio.sleep(5) # Wait for page to reload with session
            except Exception as e:
                log(f"Lỗi khi đọc file json cookie: {e}")
        else:
            log("Không có file cookie, yêu cầu tự đăng nhập.")
            
        return {"status": "started", "url": page.url}
    except Exception as e:
        log(f"Lỗi khởi chạy: {e}")
        return {"error": str(e)}

async def send_prompt(prompt: str, new_conversation: bool = True):
    global page, last_response_text, awaiting_new_response
    if not page:
        return {"error": "Trình duyệt chưa khởi chạy."}
        
    try:
        if new_conversation:
            log("Tạo trang chat mới...")
            await page.get("https://chatgpt.com/")
            await asyncio.sleep(2)
            
        log("Đang tìm ô nhập liệu...")
        await wait_for_composer()
        
        # Capture current chat state
        last_response_text = await get_assistant_text()
        
        log("Đang chép prompt bằng Javascript (Copy-Paste simulation)...")
        import json
        safe_prompt = json.dumps(prompt)
        paste_script = f"""
        (() => {{
            const text = {safe_prompt};
            const selectors = [
                '#prompt-textarea',
                'div[contenteditable="true"][role="textbox"]',
                'textarea[placeholder*="Message"]'
            ];
            for (let sel of selectors) {{
                let el = document.querySelector(sel);
                if (el) {{
                    el.focus();
                    try {{
                        const selection = window.getSelection();
                        const range = document.createRange();
                        range.selectNodeContents(el);
                        range.collapse(false);
                        selection.removeAllRanges();
                        selection.addRange(range);
                    }} catch(e) {{}}
                    
                    const dataTransfer = new DataTransfer();
                    dataTransfer.setData('text/plain', text);
                    const pasteEvent = new ClipboardEvent('paste', {{
                        clipboardData: dataTransfer,
                        bubbles: true,
                        cancelable: true
                    }});
                    
                    el.dispatchEvent(pasteEvent);
                    
                    // Fallback to execCommand if ProseMirror didn't catch it
                    if (!el.textContent.trim()) {{
                         document.execCommand('insertText', false, text);
                    }}
                    el.dispatchEvent(new Event('input', {{bubbles: true, cancelable: true}}));
                    return true;
                }}
            }}
            return false;
        }})()
        """
        await page.evaluate(paste_script)
        await asyncio.sleep(1) # Let React process the paste
        
        log("Đang tìm nút Gửi...")
        # Use JS to click the send button since it's more reliable
        send_script = """
        (() => {
            const btnSelectors = [
                "button[data-testid='send-button']",
                "button[aria-label*='Send']",
                "button[aria-label*='send']"
            ];
            for (let sel of btnSelectors) {
                const btn = document.querySelector(sel);
                if (btn && !btn.disabled) {
                    btn.click();
                    return true;
                }
            }
            return false;
        })()
        """
        sent = await page.evaluate(send_script)
                
        if not sent:
            log("Không tìm thấy nút gửi, thử dùng hàm JS gửi phím Enter...")
            enter_script = """
            (() => {
                const el = document.querySelector('#prompt-textarea') || document.querySelector('div[contenteditable="true"][role="textbox"]');
                if(el) {
                    const ke = new KeyboardEvent('keydown', {bubbles: true, cancelable: true, key: 'Enter', code: 'Enter'});
                    el.dispatchEvent(ke);
                }
            })()
            """
            await page.evaluate(enter_script)
            
        awaiting_new_response = True
        return {"status": "sent"}
    except Exception as e:
        log(f"Lỗi gửi prompt: {e}")
        return {"error": str(e)}

async def get_response():
    global page, last_response_text, awaiting_new_response
    if not page: return {"error": "Trình duyệt chưa khởi chạy."}
    
    try:
        # Check if stop button is present (means still generating)
        generating = False
        stop_selectors = [
            "button[data-testid='stop-button']", 
            "button[aria-label*='Stop']"
        ]
        for sel in stop_selectors:
            try:
                # Use querySelector directly for speed
                btn = await page.evaluate(f"document.querySelector('{sel}') !== null")
                if btn:
                    generating = True
                    break
            except: pass
                
        # Check for technical errors in the UI
        error_script = """
        (() => {
            const errorTexts = [
                "Luồng stream bị gián đoạn",
                "There was an error generating",
                "Something went wrong",
                "Failed to fetch",
                "error in providing a response",
                "vấn đề khi xử lý văn bản",
                "tin nhắn đầy đủ"
            ];
            
            // Check for specific error banners or blocks
            const nodes = document.querySelectorAll('.text-red-500, .bg-red-500, .bg-token-main-surface-tertiary, .bg-gray-50, [class*="error"]');
            for (let node of nodes) {
                const text = node.innerText;
                if (errorTexts.some(t => text.includes(t))) {
                    return text.trim();
                }
            }
            return "";
        })()
        """
        detected_error = await page.evaluate(error_script)
        if detected_error:
            log(f"Detected ChatGPT error: {detected_error}")
            return {"status": "error_retryable", "error": detected_error}

        curr_text = await get_assistant_text()
        
        # Check for send button (means done and ready for next)
        is_ready = False
        send_selectors = [
            "button[data-testid='send-button']",
            "button[data-testid='fruit-juice-send-button']",
            "button[aria-label*='Send']"
        ]
        for sel in send_selectors:
            try:
                # Check for presence and enabled state
                ready_check = f"""
                (() => {{
                    const btn = document.querySelector('{sel}');
                    return !!(btn && !btn.disabled);
                }})()
                """
                if await page.evaluate(ready_check):
                    is_ready = True
                    break
            except: pass

        # Consider it done if:
        # 1. No stop button AND send button is back
        # 2. OR we have solid text and it's been idle (not implemented yet, but is_ready usually suffices)
        
        is_completed = not generating and is_ready
        
        if curr_text:
            if awaiting_new_response:
                if is_completed:
                    awaiting_new_response = False
                    last_response_text = curr_text
                    return {"status": "completed", "text": curr_text}
                
                # If still generating or stop button present
                if generating or not is_ready:
                    return {"status": "generating", "text": curr_text}
            else:
                # Safety check: if text changed significantly and we are ready
                if curr_text != last_response_text and is_completed:
                    last_response_text = curr_text
                    return {"status": "completed", "text": curr_text}

        return {"status": "waiting"}
    except Exception as e:
        log(f"Lỗi get_response: {e}")
        return {"error": str(e)}

async def main():
    while True:
        try:
            line = await asyncio.get_event_loop().run_in_executor(None, sys.stdin.readline)
            if not line: break
            
            data = json.loads(line)
            cmd = data.get("cmd")
            
            if cmd == "start":
                res = await start_browser(data.get("url", "https://chatgpt.com"), data.get("cookie_file"), data.get("window_index"))
                print(json.dumps(res, ensure_ascii=False), flush=True)
            elif cmd == "send":
                res = await send_prompt(data.get("prompt", ""), data.get("new_conversation", True))
                print(json.dumps(res, ensure_ascii=False), flush=True)
            elif cmd == "get_response":
                res = await get_response()
                print(json.dumps(res, ensure_ascii=False), flush=True)
            elif cmd == "exit":
                if browser: await browser.stop()
                break
        except Exception as e:
            print(json.dumps({"error": str(e)}, ensure_ascii=False), flush=True)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
    except Exception as e:
        sys.stderr.write(f"Fatal error: {e}\n")
