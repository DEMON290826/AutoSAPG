import { useState, useRef, useEffect } from 'react';

function TestModule({ addLog }) {
  const splitPrompts = (value) =>
    String(value ?? '')
      .split(/\r?\n|\\n/g)
      .map((line) => line.trim())
      .filter(Boolean);

  const defaultOutput = "C:\\Users\\doran\\OneDrive\\Documents\\Auto_All\\output\\ChatGPT";
  const defaultCookie = "C:\\Users\\doran\\OneDrive\\Documents\\Auto_All\\chatgpt.com_24-02-2026.json";

  // Fix double-backslash paths from old localStorage
  const normalizePath = (p) => p ? p.replace(/\\\\/g, '\\') : p;

  const [cookieFile, setCookieFile] = useState(() => normalizePath(localStorage.getItem('test_cookie')) || defaultCookie);
  const [outputDir, setOutputDir] = useState(() => normalizePath(localStorage.getItem('test_output')) || defaultOutput);
  const [frameCount, setFrameCount] = useState(() => parseInt(localStorage.getItem('test_frames')) || 2);
  const [prompts, setPrompts] = useState(() => {
    const saved = localStorage.getItem('test_prompts');
    return saved ? JSON.parse(saved) : Array(2).fill('Xin chao\nPrompt thu 2');
  });
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [totalPrompts, setTotalPrompts] = useState(0);
  
  const MAX_FRAMES = 10;

  const handleFrameCountChange = (e) => {
    let val = parseInt(e.target.value) || 1;
    if (val < 1) val = 1;
    if (val > MAX_FRAMES) val = MAX_FRAMES;
    setFrameCount(val);
    localStorage.setItem('test_frames', val);
    
    setPrompts(prev => {
      const newPrompts = [...prev];
      if (val > prev.length) {
        for(let i=prev.length; i<val; i++) newPrompts.push('');
      } else {
        newPrompts.length = val;
      }
      localStorage.setItem('test_prompts', JSON.stringify(newPrompts));
      return newPrompts;
    });
  };

  const handlePromptChange = (index, value) => {
    const newPrompts = [...prompts];
    newPrompts[index] = value;
    setPrompts(newPrompts);
    localStorage.setItem('test_prompts', JSON.stringify(newPrompts));
  };

  useEffect(() => {
    if (window.electronAPI) {
      const unsubLog = window.electronAPI.onLog((msg) => addLog(msg));
      const unsubProgress = window.electronAPI.onProgress((stats) => {
        setProgress(stats.done);
        setTotalPrompts(stats.total);
      });
      const unsubDone = window.electronAPI.onDone(() => {
        setIsRunning(false);
        addLog("Python backend finished.");
      });
      const unsubError = window.electronAPI.onError((err) => {
        setIsRunning(false);
        addLog("Python ERROR: " + err);
      });
      
      return () => {
        if(unsubLog) unsubLog();
        if(unsubProgress) unsubProgress();
        if(unsubDone) unsubDone();
        if(unsubError) unsubError();
      }
    }
  }, [addLog]);

  const handleStart = async () => {
    if (!cookieFile.trim()) {
      alert("Please select a cookie JSON file.");
      return;
    }
    const q = prompts.reduce((acc, curr) => acc + splitPrompts(curr).length, 0);
    if (q === 0) {
      alert("Please enter prompts in at least one frame.");
      return;
    }

    setTotalPrompts(q);
    setProgress(0);
    setIsRunning(true);
    addLog(`Đang gọi Python Backend với ${frameCount} window(s)...`);
    
    if (window.electronAPI) {
      try {
        const payload = {
            cookiePath: cookieFile.trim(),
            outputDir: outputDir.trim(),
            frameCount,
            promptsByFrame: prompts.map((p) => splitPrompts(p)),
            pythonDir: localStorage.getItem('settings_python_dir') || '',
            scriptsDir: localStorage.getItem('settings_scripts_dir') || '',
            sitePkgDir: localStorage.getItem('settings_site_pkg_dir') || '',
        };
        const result = await window.electronAPI.startAutomation(payload);
        
        if(!result.success) {
           addLog("Lỗi khi mở script: " + result.error);
           setIsRunning(false);
        }
      } catch (err) {
        addLog("IPC Error: " + err.message);
        setIsRunning(false);
      }
    } else {
       addLog("Chỉ hoạt động qua Electron Desktop App.");
       setIsRunning(false);
    }
  };

  const handleStop = async () => {
    if (window.electronAPI) {
       await window.electronAPI.stopAutomation();
    }
    setIsRunning(false);
    addLog("Stop requested by user.");
  };

  const handleBrowseCookie = async () => {
    if (window.electronAPI) {
      const path = await window.electronAPI.browseFile();
      if (path) {
        setCookieFile(path);
        localStorage.setItem('test_cookie', path);
      }
    } else {
      addLog("System File Dialog Mock (Cookie)");
    }
  };

  const handleBrowseDir = async () => {
    if (window.electronAPI) {
      const path = await window.electronAPI.browseDir();
      if (path) {
        setOutputDir(path);
        localStorage.setItem('test_output', path);
      }
    } else {
      addLog("System Directory Dialog Mock");
    }
  };

  const handleOpenOutput = () => {
    if (window.electronAPI) {
      window.electronAPI.openOutputDir(outputDir.trim());
    } else {
      addLog("Opening directory...");
    }
  };

  return (
    <div className="module-container">
      <header>
        <h1>Auto-GPT Control Center</h1>
      </header>

      <section className="panel">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
          <div className="input-group">
            <label>Cookie JSON</label>
            <div className="file-input-wrapper">
              <input 
                type="text" 
                value={cookieFile} 
                onChange={e => {
                  setCookieFile(e.target.value);
                  localStorage.setItem('test_cookie', e.target.value);
                }} 
                disabled={isRunning}
              />
              <button className="btn secondary" disabled={isRunning} onClick={handleBrowseCookie}>Chọn File</button>
            </div>
          </div>

          <div className="input-group">
            <label>Output Directory</label>
            <div className="file-input-wrapper">
              <input 
                type="text" 
                value={outputDir} 
                onChange={e => {
                  setOutputDir(e.target.value);
                  localStorage.setItem('test_output', e.target.value);
                }} 
                disabled={isRunning}
              />
              <button className="btn secondary" disabled={isRunning} onClick={handleBrowseDir}>Chọn Thư Mục</button>
              <button className="btn info" onClick={handleOpenOutput}>Mở Output</button>
            </div>
          </div>
        </div>

        <div className="input-group" style={{ marginTop: '20px' }}>
          <label>Trình duyệt (Max 10 Frames)</label>
          <input 
            type="number" 
            min="1" 
            max="10" 
            value={frameCount} 
            onChange={handleFrameCountChange}
            disabled={isRunning}
            style={{ width: '120px' }}
          />
        </div>
      </section>

      <section className="panel">
        <label style={{display: 'block', fontSize: '13px', color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.5px', marginBottom: '16px'}}>
          Ô prompt (1 ô = 1 khung, mỗi dòng = 1 prompt tuần tự)
        </label>
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
          {prompts.map((p, idx) => (
            <div className="input-group" key={idx}>
              <label style={{color: 'var(--primary)', fontWeight: 700}}>Khung {idx + 1}</label>
              <textarea 
                value={p}
                onChange={e => handlePromptChange(idx, e.target.value)}
                placeholder={`Prompt cho khung ${idx + 1} (mỗi dòng 1 prompt)`}
                disabled={isRunning}
                style={{height: '140px', fontFamily: 'var(--font-mono)'}}
              />
            </div>
          ))}
        </div>
      </section>

      <section className="panel" style={{display: 'flex', flexDirection: 'column'}}>
        <div className="action-row" style={{marginTop: 0, marginBottom: '20px'}}>
          <button className="btn primary" disabled={isRunning} onClick={handleStart} style={{flex: 1, padding: '14px', fontSize: '16px'}}>
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            Bắt đầu gửi
          </button>
          <button className="btn danger" disabled={!isRunning} onClick={handleStop} style={{flex: 1, padding: '14px', fontSize: '16px'}}>
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>
            Dừng
          </button>
        </div>

        <div className="progress-container">
          <div 
            className="progress-bar" 
            style={{width: totalPrompts === 0 ? '0%' : `${(progress / totalPrompts) * 100}%`}}
          ></div>
        </div>
        <div className="progress-text" style={{fontWeight: 600, marginTop: '10px'}}>{progress} / {totalPrompts} Prompts Hoàn Thành</div>
      </section>
    </div>
  );
}

export default TestModule;
