import { useEffect, useState, useMemo } from "react";
import { BookOpen, FolderOpen, Trash2, X, Download, Plus, Search, Filter, Hash, User, Calendar, FileText, ChevronRight, LayoutList, Book as BookIcon, Sidebar, Clock, Info } from "lucide-react";
import { loadStoryProjects, loadStoryMarkdown, deleteStoryProject } from "../dna/storyStorage";
import { openPathInExplorer } from "../utils/openPath";

type StoryProjectIndexRow = {
  project_id: string;
  story_title: string;
  genre: string;
  chapter_count: number;
  total_words_requested: number;
  created_at: string;
  output_dir: string;
  factors: string[];
};

type Props = {
  storyStoragePath: string;
};

export function StoryLibraryView({ storyStoragePath }: Props) {
  const [projects, setProjects] = useState<StoryProjectIndexRow[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [selectedContent, setSelectedContent] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const reloadData = () => {
    const data = loadStoryProjects(storyStoragePath);
    setProjects(data);
  };

  useEffect(() => {
    reloadData();
  }, [storyStoragePath]);

  const filteredProjects = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return projects;
    return projects.filter(p => 
      p.story_title.toLowerCase().includes(q) || 
      p.genre.toLowerCase().includes(q)
    );
  }, [projects, searchQuery]);

  const activeProject = useMemo(() => 
    projects.find(p => p.project_id === activeProjectId) || null
  , [projects, activeProjectId]);

  const handleOpenDict = (dir: string) => {
    openPathInExplorer(dir);
  };

  const handleDelete = (id: string, title: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm(`Bạn có chắc muốn xoá dự án "${title}" khỏi lịch sử?`)) {
      deleteStoryProject(storyStoragePath, id);
      if (activeProjectId === id) setActiveProjectId(null);
      reloadData();
    }
  };

  const selectProject = (id: string) => {
    setActiveProjectId(id);
    const md = loadStoryMarkdown(storyStoragePath, id);
    setSelectedContent(md || "Không tìm thấy nội dung truyện.");
  };

  const getGenreColor = (genre: string) => {
    const g = genre.toLowerCase();
    if (g.includes("ma") || g.includes("kinh_di")) return "horror";
    if (g.includes("tien_hiep") || g.includes("huyen_huyen")) return "fantasy";
    if (g.includes("ngon_tinh") || g.includes("lang_man")) return "romance";
    if (g.includes("trinh_tham")) return "mystery";
    return "default";
  };

  return (
    <div className="story-library-layout">
      {/* Sidebar List */}
      <aside className="library-sidebar-list">
        <div className="sidebar-header">
           <div className="flex items-center gap-2 text-brand-400 mb-2">
              <LayoutList size={16} />
              <span className="text-xs font-bold tracking-widest uppercase">Danh mục truyện</span>
           </div>
           <div className="search-box-mini">
              <Search size={14} className="text-ui-500" />
              <input 
                type="text" 
                placeholder="Tìm tiêu đề..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
           </div>
        </div>

        <div className="sidebar-scroll custom-scrollbar">
          {filteredProjects.length === 0 ? (
            <div className="sidebar-empty">Trống</div>
          ) : (
            filteredProjects.map((p) => (
              <div 
                key={p.project_id} 
                className={`sidebar-item ${activeProjectId === p.project_id ? "active" : ""} ${getGenreColor(p.genre)}`}
                onClick={() => selectProject(p.project_id)}
              >
                <div className="item-icon">
                  <BookIcon size={16} />
                </div>
                <div className="item-info">
                   <div className="item-title">{p.story_title}</div>
                   <div className="item-meta">{p.genre} • {p.chapter_count} ch</div>
                </div>
                <button className="item-delete" onClick={(e) => handleDelete(p.project_id, p.story_title, e)}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <section className="library-main-viewer">
        {!activeProject ? (
          <div className="premium-empty-state-container">
            <div className="premium-empty-card">
              <div className="empty-icon-ring">
                <BookOpen size={32} className="text-brand-400" />
              </div>
              <h2>Kho truyện</h2>
              <p className="description">Khu vực này quản lý thư viện truyện nguồn chi tiết theo thư mục.</p>
              <p className="sub-description">Chọn một bộ truyện ở danh sách bên trái để bắt đầu đọc và quản lý.</p>
            </div>
          </div>
        ) : (
          <div className="story-inspector">
             <header className="inspector-header">
                <div className="inspector-title-block">
                  <div className="flex items-center gap-3">
                    <div className={`genre-chip ${getGenreColor(activeProject.genre)}`}>{activeProject.genre}</div>
                    <h1>{activeProject.story_title}</h1>
                  </div>
                  <div className="inspector-meta-bar">
                    <span className="meta-item"><Hash size={14} /> {activeProject.chapter_count} Chương</span>
                    <span className="meta-item"><Clock size={14} /> {new Date(activeProject.created_at).toLocaleString("vi-VN")}</span>
                    <span className="meta-item"><FolderOpen size={14} /> {activeProject.project_id}</span>
                  </div>
                </div>
                <div className="inspector-actions">
                   <button className="primary-btn px-6 py-2" onClick={() => handleOpenDict(activeProject.output_dir)}>
                     <FolderOpen size={16} /> Mở thư mục
                   </button>
                </div>
             </header>

             <div className="inspector-body custom-scrollbar">
                <div className="inspector-content-canvas">
                   <div className="info-box-premium">
                      <div className="flex items-center gap-2 text-brand-400 mb-3 font-semibold">
                         <Info size={16} />
                         <span>THÔNG TIN XUẤT BẢN</span>
                      </div>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                         <div className="field">
                            <span className="label">Mục tiêu từ:</span>
                            <span className="val">{activeProject.total_words_requested.toLocaleString("vi-VN")}</span>
                         </div>
                         <div className="field">
                            <span className="label">Yếu tố áp dụng:</span>
                            <span className="val">{activeProject.factors.join(", ") || "-"}</span>
                         </div>
                      </div>
                   </div>

                   <div className="readable-canvas">
                      <pre className="readable-text">{selectedContent}</pre>
                   </div>
                </div>
             </div>
          </div>
        )}
      </section>

      <style>{`
        .story-library-layout {
          display: flex;
          height: 100%;
          background: #08080a;
          overflow: hidden;
          animation: fade-in 0.4s ease-out;
        }

        /* Sidebar */
        .library-sidebar-list {
          width: 320px;
          border-right: 1px solid var(--ui-700);
          display: flex;
          flex-direction: column;
          background: rgba(15, 15, 20, 0.5);
          backdrop-filter: blur(20px);
        }

        .sidebar-header {
          padding: 24px 20px;
          border-bottom: 1px solid rgba(255,255,255,0.03);
        }

        .search-box-mini {
          background: var(--ui-900);
          border: 1px solid var(--ui-700);
          border-radius: 8px;
          display: flex;
          align-items: center;
          padding: 0 12px;
          gap: 10px;
          height: 38px;
          transition: border-color 0.2s;
        }

        .search-box-mini:focus-within {
          border-color: var(--brand-500);
        }

        .search-box-mini input {
          background: transparent;
          border: none;
          color: white;
          font-size: 0.85rem;
          outline: none;
          flex: 1;
        }

        .sidebar-scroll {
          flex: 1;
          overflow-y: auto;
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .sidebar-item {
          padding: 12px 14px;
          border-radius: 12px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 14px;
          transition: all 0.2s;
          position: relative;
          background: transparent;
          border: 1px solid transparent;
        }

        .sidebar-item:hover {
          background: rgba(255,255,255,0.03);
          border-color: var(--ui-700);
        }

        .sidebar-item.active {
          background: rgba(var(--brand-rgb), 0.08);
          border-color: rgba(var(--brand-rgb), 0.3);
        }

        .item-icon {
          width: 36px;
          height: 36px;
          border-radius: 8px;
          background: var(--ui-800);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--ui-400);
          transition: all 0.2s;
        }

        .sidebar-item.active .item-icon {
          background: var(--brand-500);
          color: white;
          box-shadow: 0 0 15px rgba(var(--brand-rgb), 0.3);
        }

        .item-info { flex: 1; min-width: 0; }
        .item-title {
          font-weight: 600;
          color: var(--ui-100);
          font-size: 0.9rem;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          margin-bottom: 2px;
        }

        .item-meta {
          font-size: 0.75rem;
          color: var(--ui-500);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .item-delete {
          opacity: 0;
          background: transparent;
          border: none;
          color: var(--ui-500);
          padding: 6px;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .sidebar-item:hover .item-delete { opacity: 1; }
        .item-delete:hover { background: rgba(239, 68, 68, 0.1); color: #ef4444; }

        /* Main Viewer */
        .library-main-viewer {
          flex: 1;
          display: flex;
          flex-direction: column;
          background: #08080a;
          position: relative;
        }

        .story-inspector {
          height: 100%;
          display: flex;
          flex-direction: column;
        }

        .inspector-header {
           padding: 32px 48px;
           border-bottom: 1px solid var(--ui-800);
           display: flex;
           justify-content: space-between;
           align-items: flex-start;
           background: linear-gradient(to bottom, #0f0f14 0%, transparent 100%);
        }

        .inspector-title-block h1 {
          font-size: 2rem;
          font-weight: 700;
          color: white;
          margin: 8px 0;
          letter-spacing: -0.02em;
        }

        .genre-chip {
           padding: 4px 12px;
           border-radius: 6px;
           font-size: 0.75rem;
           font-weight: 700;
           text-transform: uppercase;
           background: var(--ui-700);
           color: var(--ui-300);
        }

        .genre-chip.horror { background: #450a0a; color: #fca5a5; }
        .genre-chip.fantasy { background: #0c4a6e; color: #bae6fd; }
        .genre-chip.romance { background: #701a75; color: #f5d0fe; }

        .inspector-meta-bar {
           display: flex;
           gap: 20px;
           color: var(--ui-500);
           font-size: 0.85rem;
        }

        .meta-item { display: flex; align-items: center; gap: 8px; }

        .inspector-body {
           flex: 1;
           overflow-y: auto;
           padding: 40px 48px;
        }

        .inspector-content-canvas {
           max-width: 900px;
           margin: 0 auto;
        }

        .info-box-premium {
           background: rgba(255,255,255,0.02);
           border: 1px solid var(--ui-800);
           border-radius: 16px;
           padding: 24px;
           margin-bottom: 40px;
        }

        .field { display: flex; flex-direction: column; gap: 4px; }
        .field .label { color: var(--ui-500); font-size: 0.75rem; text-transform: uppercase; }
        .field .val { color: var(--ui-200); font-weight: 500; }

        .readable-canvas {
           padding: 48px;
           background: #0a0a0c;
           border-radius: 24px;
           border: 1px solid var(--ui-800);
           box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        }

        .readable-text {
          white-space: pre-wrap;
          font-family: 'Inter', system-ui, sans-serif;
          line-height: 1.8;
          font-size: 1.15rem;
          color: #d1d1d1;
          letter-spacing: -0.01em;
        }

        /* Empty State (same as before but centered in main area) */
        .premium-empty-state-container {
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: radial-gradient(circle at center, rgba(var(--brand-rgb), 0.05) 0%, transparent 70%);
        }

        .premium-empty-card {
          text-align: center;
          max-width: 440px;
          padding: 56px;
          background: rgba(20, 20, 25, 0.6);
          border: 1px solid var(--ui-700);
          border-radius: 32px;
          backdrop-filter: blur(20px);
          animation: float 6s ease-in-out infinite;
          box-shadow: 0 40px 80px -20px rgba(0,0,0,0.6);
        }

        .empty-icon-ring {
          width: 88px;
          height: 88px;
          border-radius: 50%;
          background: rgba(var(--brand-rgb), 0.1);
          border: 1px solid rgba(var(--brand-rgb), 0.2);
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 28px;
        }

        .premium-empty-card h2 {
          color: white;
          font-size: 2rem;
          font-weight: 700;
          margin-bottom: 16px;
        }

        .premium-empty-card .description {
          color: var(--ui-200);
          margin-bottom: 12px;
          line-height: 1.6;
        }

        .premium-empty-card .sub-description {
          color: var(--ui-500);
          font-size: 0.9rem;
          line-height: 1.5;
        }

        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-12px); }
        }

        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
