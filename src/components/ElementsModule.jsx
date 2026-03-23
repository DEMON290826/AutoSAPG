import { useState, useEffect } from 'react';

function ElementsModule() {
  const [elements, setElements] = useState([]);
  const [name, setName] = useState('');
  const [elementId, setElementId] = useState('');
  const [description, setDescription] = useState('');
  const [rules, setRules] = useState('');
  const [defaultEnabled, setDefaultEnabled] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('story_elements');
    if (saved) {
      try {
        setElements(JSON.parse(saved));
      } catch (e) {
        console.error("Lỗi parse elements", e);
      }
    }
  }, []);

  const saveElements = (newElements) => {
    setElements(newElements);
    localStorage.setItem('story_elements', JSON.stringify(newElements));
  };

  const strToSlug = (str) => {
    return str
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/[^a-z0-9 ]/g, '')
      .replace(/\s+/g, '_');
  };

  const handleNameChange = (e) => {
    const val = e.target.value;
    setName(val);
    setElementId(strToSlug(val));
  };

  const handleAdd = () => {
    if (!name.trim() || !elementId.trim() || !rules.trim()) {
      alert("Vui lòng nhập Tên, ID và Quy tắc cho yếu tố!");
      return;
    }
    const newEl = {
      id: elementId,
      name,
      description,
      rules,
      defaultEnabled
    };
    
    // Check duplicate ID
    const existsIndex = elements.findIndex(el => el.id === elementId);
    let newArr = [...elements];
    if (existsIndex >= 0) {
      newArr[existsIndex] = newEl; // update existing element
    } else {
      newArr.push(newEl);
    }
    
    saveElements(newArr);
    
    // Clear form
    setName('');
    setElementId('');
    setDescription('');
    setRules('');
    setDefaultEnabled(false);
  };

  const toggleDefault = (id) => {
    const newArr = elements.map(el => 
      el.id === id ? { ...el, defaultEnabled: !el.defaultEnabled } : el
    );
    saveElements(newArr);
  };

  const deleteElement = (id) => {
    if (window.confirm("Bạn có chắc chắn muốn xóa yếu tố này?")) {
      saveElements(elements.filter(el => el.id !== id));
    }
  };

  return (
    <div className="module-container" style={{maxWidth: '1200px'}}>
      <header>
        <h1 style={{fontSize: '24px'}}>Thư Viện Yếu Tố</h1>
      </header>

      <section className="panel" style={{marginBottom: '20px'}}>
        <h2 style={{marginTop: 0, fontSize: '16px', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px'}}>
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
          Thêm/Cập nhật yếu tố mới
        </h2>
        
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '16px' }}>
          <div className="input-group">
            <label>Tên yếu tố</label>
            <input 
              type="text" 
              placeholder="VD: Yếu tố ma mị" 
              value={name} 
              onChange={handleNameChange} 
            />
          </div>
          <div className="input-group">
            <label>Khóa yếu tố (Dùng trong JSON)</label>
            <input 
              type="text" 
              placeholder="VD: yeu_to_ma_mi" 
              value={elementId} 
              onChange={(e) => setElementId(e.target.value)} 
            />
          </div>
        </div>

        <div className="input-group" style={{ marginBottom: '16px' }}>
          <label>Mô tả (Ngắn cho AI hiểu yếu tố này dùng để làm gì)</label>
          <input 
            type="text" 
            placeholder="VD: Tăng tính rùng rợn, bí ẩn bằng âm thanh kì dị" 
            value={description} 
            onChange={(e) => setDescription(e.target.value)} 
          />
        </div>

        <div className="input-group" style={{ marginBottom: '16px' }}>
          <label>Quy tắc áp dụng (Prompt gửi cho AI - Mỗi dòng là 1 quy tắc mạnh mẽ)</label>
          <textarea 
            placeholder="VD: Bắt buộc lồng ghép ít nhất 1 hiện tượng phi vật lý. Không giải thích rõ ràng ngọn nguồn." 
            value={rules} 
            onChange={(e) => setRules(e.target.value)} 
            style={{height: '100px'}}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', textTransform: 'none', color: 'var(--text-main)' }}>
            <input 
              type="checkbox" 
              checked={defaultEnabled} 
              onChange={(e) => setDefaultEnabled(e.target.checked)} 
              style={{ width: '18px', height: '18px', cursor: 'pointer' }}
            />
            Bật mặc định cho mọi truyện mới
          </label>
          
          <button className="btn primary" onClick={handleAdd}>
            Lưu / Thêm Yếu Tố
          </button>
        </div>
      </section>

      <section className="panel" style={{padding: 0, overflow: 'hidden'}}>
        <div style={{ padding: '16px 24px', background: 'rgba(0,0,0,0.2)', borderBottom: '1px solid var(--panel-border)' }}>
          <h3 style={{ margin: 0, fontSize: '15px', color: 'var(--text-main)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>Danh sách yếu tố ({elements.length})</span>
          </h3>
        </div>
        
        {elements.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-dim)' }}>
            Chưa có yếu tố nào. Hãy thêm ở trên.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.02)', color: 'var(--text-dim)', borderBottom: '1px solid var(--panel-border)' }}>
                  <th style={{ padding: '16px 24px', fontWeight: 500 }}>Tên Yếu Tố</th>
                  <th style={{ padding: '16px 24px', fontWeight: 500 }}>Khóa JSON</th>
                  <th style={{ padding: '16px 24px', fontWeight: 500 }}>Mặc định?</th>
                  <th style={{ padding: '16px 24px', fontWeight: 500, textAlign: 'right' }}>Hành động</th>
                </tr>
              </thead>
              <tbody>
                {elements.map((el) => (
                  <tr key={el.id} style={{ borderBottom: '1px solid var(--panel-border)', transition: 'background 0.2s', ':hover': { background: 'rgba(255,255,255,0.02)' } }}>
                    <td style={{ padding: '16px 24px' }}>
                      <div style={{ fontWeight: 600, color: 'var(--primary)' }}>{el.name}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-dim)', marginTop: '4px' }}>{el.description}</div>
                    </td>
                    <td style={{ padding: '16px 24px' }}>
                      <code style={{ background: 'rgba(0,0,0,0.3)', padding: '4px 8px', borderRadius: '4px', color: '#a5b4fc', fontSize: '12px' }}>
                        {el.id}
                      </code>
                    </td>
                    <td style={{ padding: '16px 24px' }}>
                      <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                        <input 
                          type="checkbox" 
                          checked={el.defaultEnabled} 
                          onChange={() => toggleDefault(el.id)} 
                          style={{ width: '16px', height: '16px' }}
                        />
                      </label>
                    </td>
                    <td style={{ padding: '16px 24px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                        <button className="btn secondary" onClick={() => {
                          setName(el.name);
                          setElementId(el.id);
                          setDescription(el.description || '');
                          setRules(el.rules);
                          setDefaultEnabled(el.defaultEnabled);
                          window.scrollTo({top: 0, behavior: 'smooth'});
                        }} style={{ padding: '6px 12px', fontSize: '12px' }}>
                          Sửa
                        </button>
                        <button className="btn danger" onClick={() => deleteElement(el.id)} style={{ padding: '6px 12px', fontSize: '12px' }}>
                          Xóa
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default ElementsModule;
