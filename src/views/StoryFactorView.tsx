import { useEffect, useMemo, useState } from "react";
import { Eye, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";
import { createStoryFactor, normalizeFactorKey, normalizeFactorKeyDraft } from "../dna/storyFactors";
import type { StoryFactorDefinition } from "../dna/storyFactors";

type Props = {
  factors: StoryFactorDefinition[];
  onChangeFactors: (next: StoryFactorDefinition[]) => void;
};

function parseRules(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function sortFactors(items: StoryFactorDefinition[]): StoryFactorDefinition[] {
  return [...items].sort((left, right) => {
    if (left.builtin !== right.builtin) return left.builtin ? -1 : 1;
    return left.title.localeCompare(right.title, "vi");
  });
}

export function StoryFactorView({ factors, onChangeFactors }: Props) {
  const [draftTitle, setDraftTitle] = useState("");
  const [draftKey, setDraftKey] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftPrompt, setDraftPrompt] = useState("");
  const [draftEnabled, setDraftEnabled] = useState(false);
  const [draftKeyTouched, setDraftKeyTouched] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");

  const [editFactorId, setEditFactorId] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editKey, setEditKey] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPrompt, setEditPrompt] = useState("");
  const [editEnabled, setEditEnabled] = useState(false);

  const [viewFactorId, setViewFactorId] = useState("");

  const allSelected = factors.length > 0 && selectedIds.length === factors.length;
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const editingFactor = useMemo(() => factors.find((factor) => factor.id === editFactorId) ?? null, [factors, editFactorId]);
  const viewingFactor = useMemo(() => factors.find((factor) => factor.id === viewFactorId) ?? null, [factors, viewFactorId]);

  useEffect(() => {
    if (draftKeyTouched) return;
    setDraftKey(normalizeFactorKeyDraft(draftTitle));
  }, [draftTitle, draftKeyTouched]);

  useEffect(() => {
    if (editFactorId && !editingFactor) {
      setEditFactorId("");
    }
  }, [editFactorId, editingFactor]);

  const toggleAll = (checked: boolean) => {
    setSelectedIds(checked ? factors.map((factor) => factor.id) : []);
  };

  const toggleOne = (id: string, checked: boolean) => {
    setSelectedIds((prev) => (checked ? Array.from(new Set([...prev, id])) : prev.filter((item) => item !== id)));
  };

  const handleAddFactor = () => {
    const title = draftTitle.trim();
    const key = normalizeFactorKey(draftKey.trim() || title);
    if (!title) {
      setMessage("Thiếu tên yếu tố.");
      return;
    }
    if (!key) {
      setMessage("Khóa yếu tố không hợp lệ.");
      return;
    }
    if (factors.some((factor) => factor.key === key)) {
      setMessage("Yếu tố này đã tồn tại.");
      return;
    }

    const factor = createStoryFactor({
      key,
      title,
      description: draftDescription.trim(),
      prompt: draftPrompt.trim(),
      enabledByDefault: draftEnabled,
    });

    onChangeFactors(sortFactors([...factors, factor]));
    setDraftTitle("");
    setDraftKey("");
    setDraftDescription("");
    setDraftPrompt("");
    setDraftEnabled(false);
    setDraftKeyTouched(false);
    setMessage(`Đã thêm yếu tố: ${factor.title}`);
  };

  const deleteSelected = () => {
    if (!selectedIds.length) {
      setMessage("Chưa chọn yếu tố để xóa.");
      return;
    }

    const removable = factors.filter((factor) => selectedSet.has(factor.id) && !factor.builtin);
    if (!removable.length) {
      setMessage("Không thể xóa yếu tố mặc định.");
      return;
    }

    const removableSet = new Set(removable.map((factor) => factor.id));
    const next = factors.filter((factor) => !removableSet.has(factor.id));
    onChangeFactors(next);
    setSelectedIds((prev) => prev.filter((id) => !removableSet.has(id)));
    setMessage(`Đã xóa ${removable.length} yếu tố.`);
  };

  const deleteAllCustom = () => {
    const customCount = factors.filter((factor) => !factor.builtin).length;
    if (!customCount) {
      setMessage("Không có yếu tố tùy chỉnh để xóa.");
      return;
    }

    const ok = window.confirm("Xóa toàn bộ yếu tố tùy chỉnh?");
    if (!ok) return;

    const next = factors.filter((factor) => factor.builtin);
    onChangeFactors(next);
    setSelectedIds([]);
    setMessage(`Đã xóa ${customCount} yếu tố tùy chỉnh.`);
  };

  const toggleDefault = (factorId: string, checked: boolean) => {
    onChangeFactors(
      factors.map((factor) =>
        factor.id === factorId
          ? {
              ...factor,
              enabled_by_default: checked,
              updated_at: new Date().toISOString(),
            }
          : factor,
      ),
    );
    const toggled = factors.find((factor) => factor.id === factorId);
    if (toggled) {
      setMessage(`${checked ? "Bật" : "Tắt"} mặc định: ${toggled.title}. Yếu tố này sẽ tự áp dụng khi tạo truyện mà không cần viết thêm key trong JSON.`);
    }
  };

  const openEditFactor = (factor: StoryFactorDefinition) => {
    setEditFactorId(factor.id);
    setEditTitle(factor.title);
    setEditKey(factor.key);
    setEditDescription(factor.description);
    setEditPrompt(factor.prompt);
    setEditEnabled(factor.enabled_by_default);
  };

  const closeEditFactor = () => {
    setEditFactorId("");
    setEditTitle("");
    setEditKey("");
    setEditDescription("");
    setEditPrompt("");
    setEditEnabled(false);
  };

  const saveEditedFactor = () => {
    if (!editingFactor) return;

    const nextTitle = editTitle.trim();
    if (!nextTitle) {
      setMessage("Thiếu tên yếu tố.");
      return;
    }

    const nextKey = editingFactor.builtin ? editingFactor.key : normalizeFactorKey(editKey.trim() || nextTitle);
    if (!nextKey) {
      setMessage("Khóa yếu tố không hợp lệ.");
      return;
    }

    const duplicated = factors.some((factor) => factor.id !== editingFactor.id && factor.key === nextKey);
    if (duplicated) {
      setMessage("Khóa JSON bị trùng, hãy dùng khóa khác.");
      return;
    }

    const nextRules = editPrompt.trim();
    const next = sortFactors(
      factors.map((factor) =>
        factor.id === editingFactor.id
          ? {
              ...factor,
              title: nextTitle,
              key: nextKey,
              description: editDescription.trim(),
              prompt: editPrompt.trim(),
              enabled_by_default: editEnabled,
              updated_at: new Date().toISOString(),
            }
          : factor,
      ),
    );

    onChangeFactors(next);
    closeEditFactor();
    setMessage(`Đã cập nhật yếu tố: ${nextTitle}`);
  };

  return (
    <section className="story-factor-view">
      <header className="story-head">
        <div>
          <p className="breadcrumb">AUTO STORIES &gt; TẠO YẾU TỐ</p>
          <h1>Thư viện yếu tố</h1>
        </div>
      </header>

      <section className="settings-card">
        <h2>Thêm yếu tố mới</h2>
        <div className="factor-add-grid">
          <label>
            Tên yếu tố
            <input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} placeholder="Ví dụ: Yếu tố điều tra hình sự" />
          </label>
          <label>
            Khóa yếu tố
            <input
              value={draftKey}
              onChange={(event) => {
                const next = normalizeFactorKeyDraft(event.target.value);
                setDraftKeyTouched(next.length > 0);
                setDraftKey(next);
              }}
              placeholder="Để trống sẽ tự sinh theo tên, ví dụ: dieu_tra_hinh_su"
            />
          </label>
        </div>
        <label className="factor-full-width">
          Mô tả
          <input value={draftDescription} onChange={(event) => setDraftDescription(event.target.value)} placeholder="Mô tả ngắn cho AI hiểu yếu tố này dùng để làm gì." />
        </label>
        <label className="factor-full-width">
          Prompt hệ thống (Yếu tố này sẽ gửi cho AI nếu được bật)
          <textarea
            value={draftPrompt}
            onChange={(event) => setDraftPrompt(event.target.value)}
            placeholder={"Bạn là một Horror Master, hãy viết với nhịp độ dồn dập, gieo rắc sự bất an..."}
          />
        </label>
        <label className="factor-toggle-line">
          <input type="checkbox" checked={draftEnabled} onChange={(event) => setDraftEnabled(event.target.checked)} />
          Bật mặc định cho truyện mới
        </label>
        <div className="factor-actions-row">
          <button type="button" className="primary-btn" onClick={handleAddFactor}>
            <Plus size={15} />
            Thêm yếu tố
          </button>
        </div>
      </section>

      <section className="story-table-card">
        <div className="story-table-toolbar">
          <button type="button" className="ghost-btn compact" onClick={deleteSelected} disabled={!selectedIds.length}>
            <Trash2 size={14} />
            Xóa đã chọn
          </button>
          <button type="button" className="ghost-btn compact" onClick={deleteAllCustom}>
            <Trash2 size={14} />
            Xóa tất cả tùy chỉnh
          </button>
        </div>
        <div className="story-table-wrap">
          <table className="story-table factor-table">
            <thead>
              <tr>
                <th className="center">
                  <input type="checkbox" checked={allSelected} onChange={(event) => toggleAll(event.target.checked)} />
                </th>
                <th>Tên yếu tố</th>
                <th>Khóa JSON</th>
                <th>Mặc định</th>
                <th>Prompt nội dung</th>
                <th>Loại</th>
                <th>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {factors.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className="empty-state">
                      <Sparkles size={20} />
                      <p>Chưa có yếu tố nào.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                factors.map((factor) => (
                  <tr key={factor.id}>
                    <td className="center">
                      <input type="checkbox" checked={selectedSet.has(factor.id)} onChange={(event) => toggleOne(factor.id, event.target.checked)} />
                    </td>
                    <td>
                      <div className="story-title-cell">
                        <strong>{factor.title}</strong>
                        <small>{factor.description || "Không có mô tả."}</small>
                      </div>
                    </td>
                    <td>{factor.key}</td>
                    <td>
                      <label className="factor-inline-toggle">
                        <input type="checkbox" checked={factor.enabled_by_default} onChange={(event) => toggleDefault(factor.id, event.target.checked)} />
                        <span>{factor.enabled_by_default ? "Bật" : "Tắt"}</span>
                      </label>
                    </td>
                    <td>
                      <div className="rules-preview-box">
                        <span className="rules-bullet-text">{factor.prompt || "-"}</span>
                      </div>
                    </td>
                    <td>
                      <span className={`dna-chip ${factor.builtin ? "saved" : "unsaved"}`}>{factor.builtin ? "Mặc định" : "Tùy chỉnh"}</span>
                    </td>
                    <td>
                      <div className="btn-group-row">
                        <button type="button" className="ghost-btn compact factor-edit-btn" onClick={() => setViewFactorId(factor.id)} title="Xem chi tiết">
                          <Eye size={13} />
                          Xem
                        </button>
                        <button type="button" className="ghost-btn compact factor-edit-btn" onClick={() => openEditFactor(factor)}>
                          <Pencil size={13} />
                          Sửa
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {message ? <p className="story-message">{message}</p> : null}

      {editingFactor ? (
        <div className="modal-backdrop" onClick={closeEditFactor}>
          <div className="modal-card factor-edit-modal" onClick={(event) => event.stopPropagation()}>
            <header>
              <h3>Chỉnh sửa yếu tố</h3>
              <button type="button" className="icon-square" onClick={closeEditFactor} aria-label="Đóng chỉnh sửa yếu tố">
                <X size={16} />
              </button>
            </header>

            <label>
              Tên yếu tố
              <input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} />
            </label>
            <label>
              Khóa JSON
              <input value={editKey} onChange={(event) => setEditKey(normalizeFactorKey(event.target.value))} disabled={editingFactor.builtin} />
            </label>
            {editingFactor.builtin ? <p className="setting-note">Yếu tố mặc định giữ nguyên khóa JSON để tránh mất tương thích.</p> : null}
            <label>
              Mô tả mục tiêu
              <input value={editDescription} onChange={(event) => setEditDescription(event.target.value)} />
            </label>
            <label>
              Prompt hệ thống
              <textarea value={editPrompt} onChange={(event) => setEditPrompt(event.target.value)} style={{ minHeight: "150px" }} />
            </label>
            <label className="factor-toggle-line">
              <input type="checkbox" checked={editEnabled} onChange={(event) => setEditEnabled(event.target.checked)} />
              Bật mặc định
            </label>

            <footer>
              <button type="button" className="ghost-btn" onClick={closeEditFactor}>
                Hủy
              </button>
              <button type="button" className="primary-btn" onClick={saveEditedFactor}>
                Lưu thay đổi
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {viewingFactor ? (
        <div className="modal-backdrop" onClick={() => setViewFactorId("")}>
          <div className="modal-card factor-view-modal" onClick={(event) => event.stopPropagation()}>
            <header>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <small style={{ textTransform: "uppercase", fontSize: "10px", color: "#818cf8", fontWeight: 800, letterSpacing: "0.1em" }}>Chi tiết yếu tố</small>
                <h3 style={{ margin: 0, fontSize: "20px" }}>{viewingFactor.title}</h3>
              </div>
              <button type="button" className="icon-square" onClick={() => setViewFactorId("")}>
                <X size={16} />
              </button>
            </header>

            <div className="factor-view-content" style={{ display: "grid", gap: "20px", marginTop: "20px" }}>
              <div className="detail-field">
                <label style={{ fontSize: "11px", color: "#a88974", fontWeight: 800, textTransform: "uppercase", marginBottom: "4px", display: "block" }}>Khóa JSON</label>
                <code style={{ background: "#2a1810", padding: "4px 8px", borderRadius: "4px", color: "#d9ae91", fontSize: "13px" }}>{viewingFactor.key}</code>
              </div>

              <div className="detail-field">
                <label style={{ fontSize: "11px", color: "#a88974", fontWeight: 800, textTransform: "uppercase", marginBottom: "4px", display: "block" }}>Mô tả</label>
                <p style={{ margin: 0, fontSize: "14px", color: "#dfc1ad", lineHeight: "1.5" }}>{viewingFactor.description || "Chưa có mô tả."}</p>
              </div>

              <div className="detail-field">
                <label style={{ fontSize: "11px", color: "#a88974", fontWeight: 800, textTransform: "uppercase", marginBottom: "4px", display: "block" }}>Prompt nội dung</label>
                <div className="rules-view-list" style={{ background: "rgba(0,0,0,0.2)", padding: "12px", borderRadius: "8px", maxHeight: "350px", overflowY: "auto", border: "1px solid rgba(168,137,116,0.1)" }}>
                  <p style={{ margin: 0, fontSize: "13px", color: "#fff", lineHeight: "1.6", whiteSpace: "pre-wrap" }}>
                    {viewingFactor.prompt || "Chưa thiết lập prompt cho yếu tố này."}
                  </p>
                </div>
              </div>
            </div>

            <footer style={{ marginTop: "30px", display: "flex", justifyContent: "flex-end", gap: "12px", paddingTop: "15px", borderTop: "1px solid rgba(168,137,116,0.1)" }}>
              <button type="button" className="ghost-btn shadow-sm" onClick={() => setViewFactorId("")}>Đóng</button>
              <button type="button" className="primary-btn" onClick={() => { setViewFactorId(""); openEditFactor(viewingFactor); }}>
                <Pencil size={14} />
                Chỉnh sửa
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </section>
  );
}
