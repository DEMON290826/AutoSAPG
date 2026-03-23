import { useState, useEffect } from 'react';

function StoryGeneratorModule() {
  const defaultJson = `{
  "story_title": "Tín Hiệu Cuối Cùng Trên Chuyến Bay Mất Tích MH370",
  "genre": "creepypasta_nosleep",
  "styles": ["dieu_tra", "nhat_ky", "hien_thuc_u_am", "tin_hieu_cuc_am"],
  "length_mode": "total_words",
  "total_words": 40000,
  "avg_words_per_chapter": 8000,
  "story_language": "tiếng Việt",
  "character_name_language": "English",
  "target_intensity": "cao",
  "ending_type": "du_am_bat_an",
  "additional_settings": {}
}`;

  const defaultOutlinePrompt = `Đây là thông tin JSON truyện. Hãy tạo cho tôi một dàn ý chi tiết bám sát JSON này:\n{json_data}`;
  const defaultChapterPrompt = `Dựa vào dàn ý trên và JSON, hãy viết chi tiết {chapter_name}.`;

  const [fullscreenText, setFullscreenText] = useState({ isOpen: false, title: '', text: '', fieldName: '' });

  const [newJson, setNewJson] = useState(() => localStorage.getItem('story_new_json') || defaultJson);
  const [outlinePrompt, setOutlinePrompt] = useState(() => localStorage.getItem('outline_prompt') || defaultOutlinePrompt);
  const [chapterPrompt, setChapterPrompt] = useState(() => localStorage.getItem('chapter_prompt') || defaultChapterPrompt);
  
  const defaultOutput = "C:\\Users\\doran\\OneDrive\\Documents\\Auto_All\\output\\ChatGPT_Stories";
  const defaultCookie = "C:\\Users\\doran\\OneDrive\\Documents\\Auto_All\\chatgpt.com_24-02-2026.json";

  const normalizePath = (p) => p ? p.replace(/\\\\/g, '\\') : p;

  const [cookieFile, setCookieFile] = useState(() => normalizePath(localStorage.getItem('story_cookie')) || defaultCookie);
  const [outputDir, setOutputDir] = useState(() => normalizePath(localStorage.getItem('story_output')) || defaultOutput);

  const [maxThreads, setMaxThreads] = useState(() => parseInt(localStorage.getItem('story_threads')) || 2);
  const [stories, setStories] = useState(() => {
    const saved = localStorage.getItem('story_list');
    return saved ? JSON.parse(saved) : [];
  });

  const [isRunning, setIsRunning] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedIndices, setSelectedIndices] = useState([]);

  const parseJsonMultiple = (str) => {
      if (!str || !str.trim()) return [];
      try {
          const parsed = JSON.parse(str);
          if (Array.isArray(parsed)) return parsed;
          return [parsed];
      } catch (e) {
          try {
              let wrapped = "[" + str.replace(/}\s*\{/g, "},{") + "]";
              return JSON.parse(wrapped);
          } catch (e2) {
              return null; // Return null to indicate parsing failed
          }
      }
  }

  let computedChapters = 0;
  let parsedArr = parseJsonMultiple(newJson);
  if (parsedArr) {
      parsedArr.forEach(parsed => {
          if (parsed.total_words && parsed.avg_words_per_chapter) {
              computedChapters += Math.ceil(parsed.total_words / parsed.avg_words_per_chapter);
          }
      });
  }

  useEffect(() => {
    if (window.electronAPI) {
      const unsubUpdate = window.electronAPI.onStoryUpdate((data) => {
        setStories(prev => {
          const next = [...prev];
          if (next[data.idx]) {
            next[data.idx] = { ...next[data.idx], status: data.status };
          }
          localStorage.setItem('story_list', JSON.stringify(next));
          return next;
        });
      });
      const unsubDone = window.electronAPI.onDone(() => {
        setIsRunning(false);
      });
      const unsubError = window.electronAPI.onError(() => {
        setIsRunning(false);
      });
      
      return () => {
        if(unsubUpdate) unsubUpdate();
        if(unsubDone) unsubDone();
        if(unsubError) unsubError();
      }
    }
  }, []);

  const handleBrowseCookie = async () => {
    if (window.electronAPI) {
      const filePath = await window.electronAPI.browseFile();
      if (filePath) {
        setCookieFile(filePath);
        localStorage.setItem('story_cookie', filePath);
      }
    }
  };

  const handleBrowseOutput = async () => {
     if (window.electronAPI) {
        const dirPath = await window.electronAPI.browseDir();
        if (dirPath) {
          setOutputDir(dirPath);
          localStorage.setItem('story_output', dirPath);
        }
     }
  };

  const handleOpenOutput = async () => {
     if (window.electronAPI) {
        const res = await window.electronAPI.openOutputDir(outputDir);
        if (res && res.success === false) {
            alert(res.error);
        }
     }
  };

  const handleAddStory = () => {
    try {
      if (!parsedArr) throw new Error("Chắc chắn bạn đã nhập đúng định dạng JSON.");
      if (parsedArr.length === 0) throw new Error("Nội dung JSON trổng.");

      let nextStories = [...stories];
      
      parsedArr.forEach(parsed => {
          if (!parsed.story_title) throw new Error("Một JSON (hoặc nhiều hơn) thiếu trường 'story_title'");
          let chapters = 0;
          if (parsed.total_words && parsed.avg_words_per_chapter) {
             chapters = Math.ceil(parsed.total_words / parsed.avg_words_per_chapter);
          }
          let baseTitle = parsed.title || parsed.story_title || `Truyện_${Date.now()}`;
          let newTitle = baseTitle;
          let counter = 1;
          const existingTitles = nextStories.map(s => s.title);
          while (existingTitles.includes(newTitle)) {
             newTitle = `${baseTitle} ${counter}`;
             counter++;
          }
          parsed.story_title = newTitle; // Update inside object for Python payload

          const elementsJson = localStorage.getItem('story_elements');
          let actElem = [];
          if(elementsJson) {
             try {
                actElem = JSON.parse(elementsJson).filter(x => x.defaultEnabled).map(x => x.name);
             } catch(e){}
          }
          const newStory = {
            id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
            jsonText: JSON.stringify(parsed, null, 2),
            title: newTitle,
            chapters: chapters,
            genre: parsed.genre || '',
            styles: parsed.styles ? parsed.styles.join(', ') : '',
            elements: actElem.length > 0 ? actElem.join(', ') : 'Trống',
            status: 'Đang chờ'
          };
          nextStories.push(newStory);
      });
      
      setStories(nextStories);
      localStorage.setItem('story_list', JSON.stringify(nextStories));
    } catch (e) {
      alert("JSON không hợp lệ: " + e.message);
    }
  };

  const handleDeleteStory = (idx) => {
    const updated = stories.filter((_, i) => i !== idx);
    setStories(updated);
    localStorage.setItem('story_list', JSON.stringify(updated));
    setSelectedIndices(prev => prev.filter(i => i !== idx).map(i => i > idx ? i - 1 : i));
  };

  const handleDeleteSelected = () => {
    if (selectedIndices.length === 0) return;
    if(window.confirm(`Bạn có chắc muốn xóa ${selectedIndices.length} truyện đã chọn?`)) {
       const updated = stories.filter((_, i) => !selectedIndices.includes(i));
       setStories(updated);
       localStorage.setItem('story_list', JSON.stringify(updated));
       setSelectedIndices([]);
    }
  };

  const handleOpenStoryFolder = async (title) => {
    const raw = title || '';
    const safeTitle = raw.replace(/[<>:"/\\|?*]/g, '').trim();
    const slash = outputDir.includes('\\') ? '\\' : '/';
    const finalPath = `${outputDir}${outputDir.endsWith(slash) ? '' : slash}${safeTitle}`;
    if (window.electronAPI) {
        const res = await window.electronAPI.openOutputDir(finalPath);
        if (res && res.success === false) {
             alert(res.error);
        }
    }
  };

  const handleClearStories = () => {
    if(window.confirm("Bạn có chắc chắn muốn xóa toàn bộ danh sách truyện?")) {
      setStories([]);
      localStorage.removeItem('story_list');
      setSelectedIndices([]);
    }
  };

  const handleToggle = async () => {
    if (isRunning) {
      if (window.electronAPI) {
         window.electronAPI.stopAutomation();
      }
      setIsRunning(false);
    } else {
      if (stories.length === 0) {
        alert("Danh sách truyện đang trống!");
        return;
      }
      if (!window.electronAPI) {
         alert("Vui lòng chạy nguyên bản qua Electron App!");
         return;
      }
      
      const hasSelection = selectedIndices.length > 0;
      
      // Update local storage in case we restart
      const newStories = stories.map((s, idx) => {
         if (hasSelection) {
             if (selectedIndices.includes(idx)) return { ...s, status: 'Đang xếp hàng' };
             return s;
         } else {
             if (s.status && s.status.includes('Hoàn thành')) return s;
             return { ...s, status: 'Đang xếp hàng' };
         }
      });
      setStories(newStories);
      localStorage.setItem('story_list', JSON.stringify(newStories));

      setIsRunning(true);
      try {
        let finalOutlinePrompt = outlinePrompt;
        let finalChapterPrompt = chapterPrompt;

        // Xử lý các yếu tố (Áp dụng chung)
        const elementsJson = localStorage.getItem('story_elements');
        if (elementsJson) {
           const elements = JSON.parse(elementsJson);
           // We'll append elements globally for now, or you can iterate each story and apply it inside python backend.
           // However based on previous request, we check if global default is enabled.
           // For per-story rules, it's better if we just append ALL defaultEnabled here.
           let extraContext = [];
           elements.forEach(el => {
              if (el.defaultEnabled) {
                  extraContext.push(`- Yếu tố tĩnh: ${el.name}\n  Mô tả: ${el.description}\n  Quy tắc bắt buộc: ${el.rules}`);
              }
           });

           if (extraContext.length > 0) {
              const elementsText = "\n\n[CÁC YẾU TỐ VÀ QUY TẮC MẶC ĐỊNH BẮT BUỘC]:\n" + extraContext.join("\n\n");
              finalOutlinePrompt += elementsText;
              finalChapterPrompt += elementsText;
           }
        }

        const payloadJsons = newStories.map((s, idx) => {
            if (hasSelection) {
                if (!selectedIndices.includes(idx)) return "SKIP";
                return s.jsonText;
            } else {
                if (s.status && s.status.includes('Hoàn thành')) return "SKIP";
                return s.jsonText;
            }
        });

        const payload = {
            cookiePath: cookieFile,
            outputDir: outputDir,
            storyJsons: payloadJsons,
            maxThreads: maxThreads,
            outlinePrompt: finalOutlinePrompt,
            chapterPrompt: finalChapterPrompt,
            pythonDir: localStorage.getItem('settings_python_dir') || '',
            scriptsDir: localStorage.getItem('settings_scripts_dir') || '',
        };
        const result = await window.electronAPI.startStoryAutomation(payload);
        if(!result.success) {
           setIsRunning(false);
           alert("Lỗi khi mở script: " + result.error);
        }
      } catch (err) {
        setIsRunning(false);
        alert("IPC Error: " + err.message);
      }
    }
  };

  return (
    <div className="module-container" style={{maxWidth: '1800px'}}>
      <header>
        <h1>Auto Story Generator</h1>
      </header>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px', alignItems: 'flex-start' }}>
        
        {/* Left Column: Settings */}
        <div style={{ flex: '1 1 450px', maxWidth: '600px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <section className="panel">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '20px' }}>
              <div className="input-group">
                <label>Nguồn Cookie (JSON)</label>
                <div className="file-input-wrapper">
                  <input 
                    type="text" 
                    value={cookieFile} 
                    onChange={e => {
                      setCookieFile(e.target.value);
                      localStorage.setItem('story_cookie', e.target.value);
                    }}
                  />
                  <button className="btn secondary" onClick={handleBrowseCookie}>Chọn File</button>
                </div>
              </div>
              <div className="input-group">
                <label>Thư mục Lưu</label>
                <div className="file-input-wrapper">
                  <input 
                    type="text" 
                    value={outputDir} 
                    onChange={e => {
                      setOutputDir(e.target.value);
                      localStorage.setItem('story_output', e.target.value);
                    }}
                  />
                  <button className="btn secondary" onClick={handleBrowseOutput}>Chọn Thư mục</button>
                  <button className="btn info" onClick={handleOpenOutput}>Mở Output</button>
                </div>
              </div>
            </div>

            <div className="input-group" style={{ marginTop: '20px' }}>
              <label>Số luồng chạy cùng lúc (Max 10 trình duyệt)</label>
              <input 
                type="number" 
                min="1" 
                max="10" 
                value={maxThreads} 
                onChange={e => {
                  let val = parseInt(e.target.value) || 1;
                  if (val < 1) val = 1;
                  if (val > 10) val = 10;
                  setMaxThreads(val);
                  localStorage.setItem('story_threads', val);
                }}
                style={{ width: '120px' }}
              />
            </div>
          </section>

          <section className="panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <label style={{ fontSize: '15px', color: 'var(--text-main)', fontWeight: 600 }}>
                Thông số JSON của truyện
              </label>
              <button 
                className="btn" 
                onClick={() => setShowSettings(!showSettings)}
                style={{ display: 'flex', gap: '8px', alignItems: 'center' }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                Cài đặt Prompts
              </button>
            </div>

            {showSettings && (
              <div className="settings-box" style={{ marginBottom: '20px', padding: '16px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--panel-border)', borderRadius: 'var(--radius)' }}>
                <h3 style={{ marginTop: 0, fontSize: '14px', marginBottom: '12px' }}>Cấu hình Prompt sinh truyện</h3>
                
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px', marginBottom: '8px', fontSize: '13px', color: 'var(--text-dim)' }}>
                    <span style={{ flex: 1, minWidth: '200px' }}>Prompt tạo DÀN Ý (dùng biến {"{json_data}"} để thay bộ JSON vào):</span>
                    <button 
                      className="btn secondary" 
                      onClick={() => setFullscreenText({ isOpen: true, title: 'Chỉnh sửa Prompt Dàn Ý', text: outlinePrompt, fieldName: 'outline' })}
                      style={{ padding: '4px 8px', fontSize: '12px', background: 'transparent', border: '1px solid currentColor', whiteSpace: 'nowrap', flexShrink: 0 }}
                    >
                      ⛶ Phóng to
                    </button>
                  </div>
                  <textarea 
                    className="full-width-textarea"
                    value={outlinePrompt}
                    onChange={e => {
                      setOutlinePrompt(e.target.value);
                      localStorage.setItem('outline_prompt', e.target.value);
                    }}
                    style={{ userSelect: 'auto', WebkitUserSelect: 'auto', minHeight: '80px', fontFamily: 'var(--font-mono)', width: '100%', padding: '12px', border: '1px solid var(--input-border)', borderRadius: 'var(--radius)', background: 'var(--input-bg)', color: 'var(--text-main)' }}
                  />
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px', marginBottom: '8px', fontSize: '13px', color: 'var(--text-dim)' }}>
                    <span style={{ flex: 1, minWidth: '200px' }}>Prompt tạo CHƯƠNG (dùng biến {"{chapter_name}"} và {"{avg_words_per_chapter}"}):</span>
                    <button 
                      className="btn secondary" 
                      onClick={() => setFullscreenText({ isOpen: true, title: 'Chỉnh sửa Prompt Chương', text: chapterPrompt, fieldName: 'chapter' })}
                      style={{ padding: '4px 8px', fontSize: '12px', background: 'transparent', border: '1px solid currentColor', whiteSpace: 'nowrap', flexShrink: 0 }}
                    >
                      ⛶ Phóng to
                    </button>
                  </div>
                  <textarea 
                    className="full-width-textarea"
                    value={chapterPrompt}
                    onChange={e => {
                      setChapterPrompt(e.target.value);
                      localStorage.setItem('chapter_prompt', e.target.value);
                    }}
                    style={{ userSelect: 'auto', WebkitUserSelect: 'auto', minHeight: '80px', fontFamily: 'var(--font-mono)', width: '100%', padding: '12px', border: '1px solid var(--input-border)', borderRadius: 'var(--radius)', background: 'var(--input-bg)', color: 'var(--text-main)' }}
                  />
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px', marginBottom: '8px', marginTop: showSettings ? '0' : '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', flex: 1, minWidth: '200px' }}>
                 <label style={{ fontSize: '13px', color: 'var(--text-dim)', margin: 0, whiteSpace: 'nowrap' }}>
                    DỮ LIỆU JSON ĐẦU VÀO:
                 </label>
                 {parsedArr && parsedArr.length > 1 && (
                     <span style={{ color: 'var(--primary)', fontWeight: 600, fontSize: '12px', background: 'rgba(59, 130, 246, 0.1)', padding: '4px 8px', borderRadius: '4px', whiteSpace: 'nowrap' }}>
                        📚 Trích xuất: {parsedArr.length} Truyện
                     </span>
                 )}
                 {computedChapters > 0 && (
                     <span style={{ color: 'var(--success)', fontWeight: 600, fontSize: '12px', background: 'rgba(16, 185, 129, 0.1)', padding: '4px 8px', borderRadius: '4px', whiteSpace: 'nowrap' }}>
                        ⚡ Dự kiến: ~{computedChapters} Chương
                     </span>
                 )}
              </div>
              <button 
                className="btn secondary" 
                onClick={() => setFullscreenText({ isOpen: true, title: 'Chỉnh sửa JSON Data', text: newJson, fieldName: 'json' })}
                style={{ padding: '4px 8px', fontSize: '12px', background: 'transparent', border: '1px solid currentColor', color: 'var(--text-dim)', whiteSpace: 'nowrap', flexShrink: 0 }}
              >
                ⛶ Phóng to
              </button>
            </div>

            <textarea 
              className="full-width-textarea"
              value={newJson}
              onChange={e => {
                setNewJson(e.target.value);
                localStorage.setItem('story_new_json', e.target.value);
              }}
              style={{ userSelect: 'auto', WebkitUserSelect: 'auto', minHeight: '220px', fontFamily: 'var(--font-mono)', fontSize: '14px', lineHeight: '1.6', width: '100%', padding: '16px', border: '1px solid var(--input-border)', borderRadius: 'var(--radius)', background: 'var(--input-bg)', color: 'var(--text-main)' }}
              spellCheck="false"
            />
            <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end' }}>
               <button className="btn info" onClick={handleAddStory}>
                + Thêm truyện vào Hàng đợi
               </button>
            </div>
          </section>
        </div>

        {/* Right Column: Table and Actions */}
        <div style={{ flex: '2 1 800px', display: 'flex', flexDirection: 'column', gap: '24px', minWidth: '0' }}>
          <section className="panel" style={{marginBottom: 0, display: 'flex', flexDirection: 'column', maxHeight: '640px'}}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexShrink: 0 }}>
              <label style={{ fontSize: '15px', color: 'var(--text-main)', fontWeight: 600 }}>
                Danh sách Truyện Đang Chờ ({stories.length})
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                {selectedIndices.length > 0 && (
                  <button className="btn danger" onClick={handleDeleteSelected} disabled={isRunning} style={{padding: '6px 12px', fontSize: '12px'}}>
                    Xóa Đã Chọn ({selectedIndices.length})
                  </button>
                )}
                <button className="btn warning" onClick={handleClearStories} disabled={isRunning || stories.length === 0} style={{padding: '6px 12px', fontSize: '12px'}}>
                   Xóa Tất Cả
                </button>
              </div>
            </div>
            
            <div style={{ overflowX: 'auto', overflowY: 'auto', flex: 1, minHeight: '300px', overflowX: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--panel-border)', color: 'var(--text-dim)' }}>
                    <th style={{ padding: '10px 4px', width: '30px' }}>
                      <input 
                        type="checkbox" 
                        disabled={isRunning || stories.length === 0}
                        checked={stories.length > 0 && selectedIndices.length === stories.length}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedIndices(stories.map((_, i) => i));
                          } else {
                            setSelectedIndices([]);
                          }
                        }}
                      />
                    </th>
                    <th style={{ padding: '10px 4px' }}>STT</th>
                    <th style={{ padding: '10px 4px' }}>Tên Truyện</th>
                    <th style={{ padding: '10px 4px', whiteSpace: 'nowrap', textAlign: 'center' }}>Chương</th>
                    <th style={{ padding: '10px 4px', fontSize: '12px' }}>Thể loại</th>
                    <th style={{ padding: '10px 4px', fontSize: '12px' }}>Phong cách</th>
                    <th style={{ padding: '10px 4px', fontSize: '12px' }}>Yếu tố</th>
                    <th style={{ padding: '10px 4px', whiteSpace: 'nowrap' }}>Trạng thái</th>
                    <th style={{ padding: '10px 4px', whiteSpace: 'nowrap' }}>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {stories.length === 0 ? (
                    <tr>
                      <td colSpan="9" style={{ padding: '24px 8px', textAlign: 'center', color: 'var(--text-dim)' }}>
                        Chưa có truyện nào trong hàng đợi.
                      </td>
                    </tr>
                  ) : (
                    stories.map((story, idx) => (
                      <tr key={story.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        <td style={{ padding: '8px 4px' }}>
                          <input 
                            type="checkbox"
                            disabled={isRunning}
                            checked={selectedIndices.includes(idx)}
                            onChange={(e) => {
                               if (e.target.checked) setSelectedIndices([...selectedIndices, idx]);
                               else setSelectedIndices(selectedIndices.filter(i => i !== idx));
                            }}
                          />
                        </td>
                        <td style={{ padding: '8px 4px' }}>{idx + 1}</td>
                        <td style={{ padding: '8px 4px', fontWeight: 600, color: 'var(--text-main)', minWidth: '120px' }}>{story.title}</td>
                        <td style={{ padding: '8px 4px', color: 'var(--primary)', fontWeight: 600, whiteSpace: 'nowrap', textAlign: 'center' }}>{story.chapters ? story.chapters : '?'}</td>
                        <td style={{ padding: '8px 4px', color: 'var(--text-dim)', fontSize: '12px', maxWidth: '90px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={story.genre}>{story.genre}</td>
                        <td style={{ padding: '8px 4px', color: 'var(--text-dim)', fontSize: '12px', maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={story.styles}>{story.styles}</td>
                        <td style={{ padding: '8px 4px', color: 'var(--success)', fontSize: '12px', maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={story.elements || 'Không'}>{story.elements || 'Không'}</td>
                        <td style={{ padding: '8px 4px', whiteSpace: 'nowrap', maxWidth: '200px' }}>
                          <span style={{ 
                            padding: '4px 8px', 
                            borderRadius: '6px', 
                            fontSize: '11px', 
                            fontWeight: 600,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            backgroundColor: story.status.includes('Lỗi') ? 'rgba(239, 68, 68, 0.2)' : 
                                             (story.status.includes('Hoàn thành') ? 'rgba(16, 185, 129, 0.2)' : 
                                             (story.status.includes('Đang') && !story.status.includes('chờ') ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255, 255, 255, 0.1)')),
                            color: story.status.includes('Lỗi') ? '#fca5a5' : 
                                   (story.status.includes('Hoàn thành') ? '#6ee7b7' : 
                                   (story.status.includes('Đang') && !story.status.includes('chờ') ? '#93c5fd' : '#e5e7eb'))
                          }}>
                            {story.status.includes('Đang') && !story.status.includes('chờ') && (() => {
                              const maxDash = 62.83;
                              let dash = 15;
                              const stat = story.status.toLowerCase();
                              if (stat.includes('dàn ý')) {
                                dash = 15; 
                              } else if (stat.includes('viết chương')) {
                                const match = stat.match(/chương (\d+)/i);
                                if (match && story.chapters) {
                                  let c = parseInt(match[1]);
                                  if (c > story.chapters) c = story.chapters;
                                  const p = c / story.chapters;
                                  dash = 15 + p * 47; 
                                } else {
                                  dash = 40;
                                }
                              } else if (stat.includes('hoàn')) {
                                dash = maxDash;
                              }
                              return (
                                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{width: '16px', height: '16px'}}>
                                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3" strokeLinecap="round" strokeDasharray="3 6">
                                     <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="2s" repeatCount="indefinite" />
                                  </circle>
                                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${dash} ${maxDash}`} style={{ transition: 'stroke-dasharray 0.5s ease', transformOrigin: '50% 50%', transform: 'rotate(-90deg)' }} />
                                </svg>
                              );
                            })()}
                            {story.status.includes('chờ') && (
                              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{width: '14px', height: '14px'}}>
                                <circle cx="12" cy="12" r="4" fill="currentColor"/>
                              </svg>
                            )}
                            {story.status}
                          </span>
                        </td>
                        <td style={{ padding: '8px 4px' }}>
                          <div style={{ display: 'flex', gap: '4px' }}>
                            <button 
                              className="btn info" 
                              onClick={() => handleOpenStoryFolder(story.title)} 
                              style={{ padding: '4px 6px', fontSize: '11px', background: 'var(--primary-gradient)', border: 'none', whiteSpace: 'nowrap' }}
                            >Mở</button>
                            <button 
                              className="btn danger" 
                              onClick={() => handleDeleteStory(idx)} 
                              disabled={isRunning}
                              style={{ padding: '4px 6px', fontSize: '11px' }}
                            >Xóa</button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel" style={{display: 'flex', flexDirection: 'column'}}>
            <div className="action-row" style={{marginTop: 0}}>
              {!isRunning ? (
                <button 
                  className="btn primary" 
                  onClick={handleToggle} 
                  disabled={stories.length === 0 || (selectedIndices.length === 0 && stories.filter(s => !(s.status && s.status.includes('Hoàn thành'))).length === 0)} 
                  style={{ flex: 1, padding: '14px', fontSize: '16px' }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                  Bắt Đầu Tạo ({selectedIndices.length > 0 ? selectedIndices.length : stories.filter(s => !(s.status && s.status.includes('Hoàn thành'))).length} Truyện)
                </button>
              ) : (
                <button className="btn danger" onClick={handleToggle} style={{ flex: 1, padding: '14px', fontSize: '16px' }}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>
                  Dừng Đang Tạo
                </button>
              )}
            </div>
          </section>
        </div>
      </div>
      
      {fullscreenText.isOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
          background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)',
          zIndex: 9999, display: 'flex', flexDirection: 'column', 
          padding: '40px', boxSizing: 'border-box'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h2 style={{ margin: 0, color: '#fff' }}>{fullscreenText.title}</h2>
            <div>
               <button className="btn secondary" onClick={() => setFullscreenText({ isOpen: false, text: '', title: '', fieldName: '' })} style={{ marginRight: '16px' }}>Hủy</button>
               <button className="btn primary" onClick={() => {
                   if (fullscreenText.fieldName === 'outline') {
                     setOutlinePrompt(fullscreenText.text);
                     localStorage.setItem('outline_prompt', fullscreenText.text);
                   }
                   if (fullscreenText.fieldName === 'chapter') {
                     setChapterPrompt(fullscreenText.text);
                     localStorage.setItem('chapter_prompt', fullscreenText.text);
                   }
                   if (fullscreenText.fieldName === 'json') {
                     setNewJson(fullscreenText.text);
                     localStorage.setItem('story_new_json', fullscreenText.text);
                   }
                   setFullscreenText({ isOpen: false, text: '', title: '', fieldName: '' });
               }}>Lưu thay đổi</button>
            </div>
          </div>
          <textarea
             value={fullscreenText.text}
             onChange={(e) => setFullscreenText({...fullscreenText, text: e.target.value})}
             style={{ 
               flex: 1, backgroundColor: 'var(--input-bg)', color: '#fff', 
               padding: '24px', fontSize: '16px', fontFamily: 'var(--font-mono)', 
               borderRadius: '8px', border: '1px solid var(--panel-border)',
               resize: 'none', lineHeight: '1.6', outline: 'none',
               userSelect: 'auto', WebkitUserSelect: 'auto'
             }}
             spellCheck={false}
          />
        </div>
      )}
    </div>
  );
}

export default StoryGeneratorModule;
