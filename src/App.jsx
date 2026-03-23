import { useState, useRef, useEffect } from 'react';
import TestModule from './components/TestModule';
import StoryGeneratorModule from './components/StoryGeneratorModule';
import ElementsModule from './components/ElementsModule';
import SettingsModule from './components/SettingsModule';

function App() {
  const [activeTab, setActiveTab] = useState('story');
  const [logs, setLogs] = useState([
    { time: new Date().toLocaleTimeString(), text: 'System initialized. Ready.' }
  ]);
  const [isLogMinimized, setIsLogMinimized] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  const [appVersion, setAppVersion] = useState('loading...');
  const logsEndRef = useRef(null);

  useEffect(() => {
    if (window.electronAPI?.getVersion) {
      window.electronAPI.getVersion().then(v => setAppVersion(v));
    } else {
      setAppVersion('dev');
    }
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const addLog = (text) => {
    setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), text }]);
  };

  useEffect(() => {
    if (window.electronAPI) {
      const unsubLog = window.electronAPI.onLog((msg) => addLog(msg));
      const unsubError = window.electronAPI.onError((err) => {
        addLog("Python ERROR: " + err);
      });
      const unsubDone = window.electronAPI.onDone(() => {
        addLog("Python backend finished.");
      });
      return () => {
        if(unsubLog) unsubLog();
        if(unsubError) unsubError();
        if(unsubDone) unsubDone();
      }
    }
  }, []);

  useEffect(() => {
    if (window.electronAPI?.onUpdateReady) {
      const unsub = window.electronAPI.onUpdateReady(() => {
        setUpdateReady(true);
        addLog('✅ Bản cập nhật đã tải xong. Tự động cài khi đóng app.');
      });
      return () => { if (unsub) unsub(); };
    }
  }, []);

  const tabs = [
    {
      id: 'story', label: 'Auto Tạo Truyện',
      icon: <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"></path></svg>
    },
    {
      id: 'elements', label: 'Quản Lý Yếu Tố',
      icon: <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>
    },
    {
      id: 'test', label: 'Test App',
      icon: <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
    },
    {
      id: 'settings', label: 'Cài Đặt',
      icon: <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
    },
  ];

  return (
    <div className="layout-container">
      <nav className="sidebar">
        <div className="sidebar-header" style={{ 
          display: 'flex', flexDirection: 'column', alignItems: 'center', 
          padding: '24px 16px 20px', gap: '10px',
          borderBottom: '1px solid rgba(255,255,255,0.07)'
        }}>
          {/* Use relative path — works in both Vite dev server and packaged Electron via loadFile */}
          <img src="./icon.png" alt="AG" style={{ 
            width: '72px', height: '72px', borderRadius: '18px',
            boxShadow: '0 4px 24px rgba(59,130,246,0.35)',
          }} />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontWeight: 800, fontSize: '18px', color: 'var(--text-main)', letterSpacing: '1px' }}>AG</div>
            <div style={{ fontSize: '11px', color: 'var(--text-dim)', letterSpacing: '2px', marginTop: '2px' }}>v{appVersion}</div>
            {updateReady && (
              <div style={{
                marginTop: '8px', fontSize: '10px', color: '#6ee7b7',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px'
              }}>
                <span style={{
                  width: '7px', height: '7px', borderRadius: '50%',
                  background: '#10b981', display: 'inline-block',
                  animation: 'pulse 1.5s infinite'
                }}/>
                Cập nhật sẵn sàng
              </div>
            )}
          </div>
        </div>
        <ul className="sidebar-menu">
          {tabs.map(tab => (
            <li
              key={tab.id}
              className={activeTab === tab.id ? 'active' : ''}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.icon}
              {tab.label}
            </li>
          ))}
        </ul>
      </nav>
      
      <div className="content-wrapper">
        <main className="main-content">
          <div style={{ display: activeTab === 'test' ? 'block' : 'none' }}>
            <TestModule addLog={addLog} />
          </div>
          <div style={{ display: activeTab === 'story' ? 'block' : 'none' }}>
            <StoryGeneratorModule />
          </div>
          <div style={{ display: activeTab === 'elements' ? 'block' : 'none' }}>
            <ElementsModule />
          </div>
          <div style={{ display: activeTab === 'settings' ? 'block' : 'none' }}>
            <SettingsModule addLog={addLog} />
          </div>
        </main>
        
        <div className="global-logs" style={isLogMinimized ? { height: 'auto', minHeight: 'auto', padding: '16px 32px' } : {}}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isLogMinimized ? '0' : '12px' }}>
            <h3 style={{ margin: 0 }}>Nhật ký (Logs Hệ Thống)</h3>
            <button 
              onClick={() => setIsLogMinimized(!isLogMinimized)}
              style={{
                background: 'rgba(255,255,255,0.1)', border: 'none', color: 'var(--text-main)', 
                cursor: 'pointer', width: '24px', height: '24px', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}
              title={isLogMinimized ? "Mở rộng Logs" : "Thu gọn Logs"}
            >
              {isLogMinimized ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
              )}
            </button>
          </div>
          {!isLogMinimized && (
            <div className="log-viewer">
              {logs.map((log, i) => (
                <div className="log-entry" key={i}>
                  <span className="log-time">[{log.time}]</span> 
                  <span className="log-msg">{log.text}</span>
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
