import { useState, useEffect } from 'react';

function SettingsModule({ addLog }) {
  const normalizePath = (p) => p ? p.replace(/\\\\/g, '\\') : p;

  // Auto-clear bad pythonDir (project path mistakenly saved as Python runtime)
  const getInitialPythonDir = () => {
    const raw = normalizePath(localStorage.getItem('settings_python_dir')) || '';
    const lower = raw.toLowerCase();
    if (raw && (lower.includes('auto_all') || lower.includes('chatgpt-sender') ||
                lower.includes('runner') || lower.endsWith('\\python') || lower.endsWith('/python'))) {
      localStorage.removeItem('settings_python_dir');
      return '';
    }
    return raw;
  };

  const [pythonDir, setPythonDir] = useState(() => getInitialPythonDir());
  const [cookieFile, setCookieFile] = useState(
    () => normalizePath(localStorage.getItem('settings_cookie')) || 
         'C:\\Users\\doran\\OneDrive\\Documents\\Auto_All\\chatgpt.com_24-02-2026.json'
  );
  const [testOutputDir, setTestOutputDir] = useState(
    () => normalizePath(localStorage.getItem('settings_test_output')) || 
         'C:\\Users\\doran\\OneDrive\\Documents\\Auto_All\\output\\ChatGPT'
  );
  const [storyOutputDir, setStoryOutputDir] = useState(
    () => normalizePath(localStorage.getItem('settings_story_output')) || 
         'C:\\Users\\doran\\OneDrive\\Documents\\Auto_All\\output\\ChatGPT_Stories'
  );
  const [scriptsDir, setScriptsDir] = useState(
    () => normalizePath(localStorage.getItem('settings_scripts_dir')) || ''
  );
  const [sitePkgDir, setSitePkgDir] = useState(
    () => normalizePath(localStorage.getItem('settings_site_pkg_dir')) || ''
  );
  const [installing, setInstalling] = useState(false);
  const [installStatus, setInstallStatus] = useState('');

  // Sync settings to localStorage
  useEffect(() => {
    localStorage.setItem('settings_python_dir', pythonDir);
    localStorage.setItem('settings_scripts_dir', scriptsDir);
    localStorage.setItem('settings_site_pkg_dir', sitePkgDir);
    localStorage.setItem('settings_cookie', cookieFile);
    localStorage.setItem('settings_test_output', testOutputDir);
    localStorage.setItem('settings_story_output', storyOutputDir);
    // Also sync to module-specific keys for backward compat
    localStorage.setItem('test_cookie', cookieFile);
    localStorage.setItem('test_output', testOutputDir);
    localStorage.setItem('story_cookie', cookieFile);
    localStorage.setItem('story_output', storyOutputDir);
    localStorage.setItem('python_dir', pythonDir);
  }, [pythonDir, scriptsDir, sitePkgDir, cookieFile, testOutputDir, storyOutputDir]);

  const browseSitePkgDir = async () => {
    if (window.electronAPI) {
      const p = await window.electronAPI.browseDir();
      if (p) setSitePkgDir(p);
    }
  };

  const browseScriptsDir = async () => {
    if (window.electronAPI) {
      const p = await window.electronAPI.browseDir();
      if (p) setScriptsDir(p);
    }
  };

  const browseCookie = async () => {
    if (window.electronAPI) {
      const p = await window.electronAPI.browseFile();
      if (p) setCookieFile(p);
    }
  };

  const browseTestOutput = async () => {
    if (window.electronAPI) {
      const p = await window.electronAPI.browseDir();
      if (p) setTestOutputDir(p);
    }
  };

  const browseStoryOutput = async () => {
    if (window.electronAPI) {
      const p = await window.electronAPI.browseDir();
      if (p) setStoryOutputDir(p);
    }
  };

  const browsePythonDir = async () => {
    if (window.electronAPI) {
      const p = await window.electronAPI.browseDir();
      if (p) {
        // Warn if user picks a project folder instead of Python runtime
        const lower = p.toLowerCase();
        if (lower.includes('runner') || lower.includes('auto_all') || lower.includes('chatgpt-sender')) {
          alert('⚠️ Đây có vẻ là thư mục project, không phải Python runtime.\nHãy chọn thư mục cài Python, ví dụ: C:\\Python313\\nHoặc để trống để dùng Python hệ thống (PATH).');
          return;
        }
        setPythonDir(p);
      }
    }
  };

  const handleInstallDeps = async () => {
    if (!window.electronAPI) return;
    setInstalling(true);
    setInstallStatus('Đang cài đặt thư viện...');
    addLog?.('🔧 Bắt đầu cài đặt thư viện Python...');
    try {
      const result = await window.electronAPI.installDeps(pythonDir || null);
      if (result.success) {
        setInstallStatus('✅ Cài đặt thành công!');
        addLog?.('✅ Cài thư viện thành công!');
      } else {
        setInstallStatus('❌ Lỗi: ' + result.error);
        addLog?.('❌ Lỗi cài thư viện: ' + result.error);
      }
    } catch (e) {
      setInstallStatus('❌ ' + e.message);
      addLog?.('❌ ' + e.message);
    }
    setInstalling(false);
  };

  const field = {
    display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '20px'
  };
  const label = {
    fontSize: '11px', fontWeight: 700, letterSpacing: '1.5px',
    color: 'var(--text-dim)', textTransform: 'uppercase'
  };
  const row = {
    display: 'flex', gap: '8px', alignItems: 'center'
  };
  const input = {
    flex: 1, padding: '9px 12px', background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px',
    color: 'var(--text-main)', fontSize: '13px',
    outline: 'none', fontFamily: 'monospace'
  };
  const btnSmall = {
    padding: '8px 14px', background: 'rgba(255,255,255,0.1)',
    border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px',
    color: 'var(--text-main)', fontSize: '12px', cursor: 'pointer',
    whiteSpace: 'nowrap', transition: 'all 0.2s'
  };

  return (
    <div style={{ padding: '24px 32px', maxWidth: '780px', margin: '0 auto' }}>
      <h2 style={{ color: 'var(--text-main)', marginBottom: '6px', fontSize: '20px', fontWeight: 700 }}>
        ⚙️ Cài Đặt Chung
      </h2>
      <p style={{ color: 'var(--text-dim)', fontSize: '13px', marginBottom: '28px' }}>
        Cấu hình được áp dụng cho tất cả module. Thay đổi tự động lưu.
      </p>

      {/* Divider */}
      <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--accent)', letterSpacing: '2px', 
                    marginBottom: '16px', textTransform: 'uppercase' }}>
        🔑 Cookie & Thư Mục Lưu
      </div>

      <div style={field}>
        <span style={label}>Cookie JSON (dùng chung cho Test & Tạo Truyện)</span>
        <div style={row}>
          <input
            style={input} value={cookieFile}
            onChange={e => setCookieFile(e.target.value)}
            placeholder="Đường dẫn file Cookie JSON..."
          />
          <button style={btnSmall} onClick={browseCookie}>Chọn File</button>
        </div>
      </div>

      <div style={field}>
        <span style={label}>Thư mục lưu kết quả Test</span>
        <div style={row}>
          <input
            style={input} value={testOutputDir}
            onChange={e => setTestOutputDir(e.target.value)}
            placeholder="Thư mục output cho Test..."
          />
          <button style={btnSmall} onClick={browseTestOutput}>Chọn Thư Mục</button>
          <button style={{...btnSmall, background: 'rgba(59,130,246,0.2)', borderColor: 'rgba(59,130,246,0.4)', color: '#93c5fd'}}
            onClick={() => window.electronAPI?.openOutputDir(testOutputDir)}>Mở</button>
        </div>
      </div>

      <div style={field}>
        <span style={label}>Thư mục lưu Truyện</span>
        <div style={row}>
          <input
            style={input} value={storyOutputDir}
            onChange={e => setStoryOutputDir(e.target.value)}
            placeholder="Thư mục output cho Truyện..."
          />
          <button style={btnSmall} onClick={browseStoryOutput}>Chọn Thư Mục</button>
          <button style={{...btnSmall, background: 'rgba(59,130,246,0.2)', borderColor: 'rgba(59,130,246,0.4)', color: '#93c5fd'}}
            onClick={() => window.electronAPI?.openOutputDir(storyOutputDir)}>Mở</button>
        </div>
      </div>

      {/* Python section */}
      <div style={{ height: '1px', background: 'rgba(255,255,255,0.07)', margin: '8px 0 24px' }} />
      <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--accent)', letterSpacing: '2px', 
                    marginBottom: '16px', textTransform: 'uppercase' }}>
        📂 Thư Mục Scripts Python
      </div>

      <div style={field}>
        <span style={label}>Thư mục chứa runner.py (để trống = dùng scripts đi kèm app)</span>
        <div style={row}>
          <input
            style={input} value={scriptsDir}
            onChange={e => setScriptsDir(e.target.value)}
            placeholder="Để trống → app tự tìm runner.py... (khuyến nghị)"
          />
          <button style={btnSmall} onClick={browseScriptsDir}>Chọn Thư Mục</button>
          {scriptsDir && (
            <button
              style={{...btnSmall, color: '#fca5a5', borderColor: 'rgba(239,68,68,0.3)'}}
              onClick={() => setScriptsDir('')}
              title="Xóa — dùng scripts mặc định"
            >✕ Xóa</button>
          )}
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '2px' }}>
          Chỉ điền khi chạy trên máy khác và muốn chỉ định thư mục chứa{' '}
          <code style={{background:'rgba(255,255,255,0.08)', padding:'1px 5px', borderRadius:'3px'}}>runner.py</code>
          {' '}và{' '}
          <code style={{background:'rgba(255,255,255,0.08)', padding:'1px 5px', borderRadius:'3px'}}>runner_story.py</code>.
        </div>
      </div>

      <div style={{ height: '1px', background: 'rgba(255,255,255,0.07)', margin: '8px 0 24px' }} />
      <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--accent)', letterSpacing: '2px', 
                    marginBottom: '16px', textTransform: 'uppercase' }}>
        🐍 Python Runtime
      </div>

      <div style={field}>
        <span style={label}>Thư mục chứa Python (để trống = dùng Python hệ thống)</span>
        <div style={row}>
          <input
            style={{
              ...input,
              borderColor: pythonDir && !pythonDir.toLowerCase().includes('python') 
                ? 'rgba(250,100,100,0.5)' : 'rgba(255,255,255,0.1)'
            }}
            value={pythonDir}
            onChange={e => setPythonDir(e.target.value)}
            placeholder="Để trống → dùng Python trong PATH hệ thống..."
          />
          <button style={btnSmall} onClick={browsePythonDir}>Chọn Thư Mục</button>
          {pythonDir && (
            <button 
              style={{...btnSmall, color: '#fca5a5', borderColor: 'rgba(239,68,68,0.3)'}}
              onClick={() => setPythonDir('')}
              title="Xóa — dùng Python hệ thống"
            >✕ Xóa</button>
          )}
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '2px' }}>
          Ví dụ: <code style={{background:'rgba(255,255,255,0.08)', padding:'1px 5px', borderRadius:'3px'}}>C:\Python313</code>
          &nbsp;— Chỉ điền khi Python không nằm trong PATH. <strong style={{color:'#fbbf24'}}>Không chọn thư mục project!</strong>
        </div>
        {pythonDir && !pythonDir.toLowerCase().includes('python') && (
          <div style={{ fontSize: '12px', color: '#fca5a5', marginTop: '4px', fontWeight: 600 }}>
            ⚠️ Đường dẫn không có chữ "python" — kiểm tra lại!
          </div>
        )}
      </div>

      <div style={field}>
        <span style={label}>Thư mục site-packages (chứa nodriver)</span>
        <div style={row}>
          <input
            style={input}
            value={sitePkgDir}
            onChange={e => setSitePkgDir(e.target.value)}
            placeholder="Để trống → dùng site-packages mặc định..."
          />
          <button style={btnSmall} onClick={browseSitePkgDir}>Chọn Thư Mục</button>
          {sitePkgDir && (
            <button
              style={{...btnSmall, color: '#fca5a5', borderColor: 'rgba(239,68,68,0.3)'}}
              onClick={() => setSitePkgDir('')}
              title="Xóa"
            >✕ Xóa</button>
          )}
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '2px' }}>
          Điền khi nodriver báo thiếu dù đã cài. Ví dụ:{' '}
          <code style={{background:'rgba(255,255,255,0.08)', padding:'1px 5px', borderRadius:'3px'}}>
            C:\Python313\Lib\site-packages
          </code>
          {' '}hoặc{' '}
          <code style={{background:'rgba(255,255,255,0.08)', padding:'1px 5px', borderRadius:'3px'}}>
            C:\Users\admin\AppData\Roaming\Python\Python313\site-packages
          </code>
        </div>
      </div>

      <div style={{ 
        background: 'rgba(59,130,246,0.08)', borderRadius: '12px', 
        border: '1px solid rgba(59,130,246,0.2)', padding: '20px',
        display: 'flex', alignItems: 'flex-start', gap: '16px'
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, color: 'var(--text-main)', marginBottom: '4px' }}>
            Cài đặt thư viện Python
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-dim)', lineHeight: '1.6' }}>
            Tự động cài <code style={{ background: 'rgba(255,255,255,0.1)', padding: '1px 6px', borderRadius: '4px' }}>nodriver</code> nếu chưa có.
            Cần có internet và Python đã cài trên máy.
          </div>
          {installStatus && (
            <div style={{ 
              marginTop: '10px', fontSize: '13px', fontWeight: 600,
              color: installStatus.startsWith('✅') ? '#6ee7b7' : 
                     installStatus.startsWith('❌') ? '#fca5a5' : '#93c5fd'
            }}>
              {installStatus}
            </div>
          )}
        </div>
        <button
          onClick={handleInstallDeps}
          disabled={installing}
          style={{
            padding: '10px 22px', borderRadius: '8px', border: 'none', cursor: installing ? 'not-allowed' : 'pointer',
            background: installing ? 'rgba(255,255,255,0.1)' : 'linear-gradient(135deg, #3b82f6, #2563eb)',
            color: 'white', fontWeight: 700, fontSize: '13px', whiteSpace: 'nowrap',
            opacity: installing ? 0.6 : 1, transition: 'all 0.2s'
          }}
        >
          {installing ? '⏳ Đang cài...' : '⬇ Cài Thư Viện'}
        </button>
      </div>
    </div>
  );
}

export default SettingsModule;
