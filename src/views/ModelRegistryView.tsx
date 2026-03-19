import { FlaskConical, Plus, ServerCog, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CustomSelect } from "../components/CustomSelect";
import type { ModelRegistryItem } from "../types/appSettings";

type Props = {
  models: ModelRegistryItem[];
  onAddModel: (vendor: string, model: string) => { ok: boolean; message: string };
  onDeleteModels: (ids: string[]) => { ok: boolean; message: string };
  onTestModels: (ids: string[]) => Promise<{ ok: boolean; message: string }>;
  isTesting: boolean;
};

const OTHER_VENDOR_VALUE = "__other_vendor__";

export function ModelRegistryView({ models, onAddModel, onDeleteModels, onTestModels, isTesting }: Props) {
  const [vendorDraft, setVendorDraft] = useState("");
  const [customVendorDraft, setCustomVendorDraft] = useState("");
  const [modelDraft, setModelDraft] = useState("");
  const [message, setMessage] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeId, setActiveId] = useState("");

  const vendors = useMemo(() => Array.from(new Set(models.map((item) => item.vendor))).sort((a, b) => a.localeCompare(b, "vi")), [models]);
  const vendorOptions = useMemo(
    () => [
      { value: "", label: "Chọn hãng" },
      ...vendors.map((vendor) => ({ value: vendor, label: vendor })),
      { value: OTHER_VENDOR_VALUE, label: "Khác" },
    ],
    [vendors],
  );
  const resolvedVendor = vendorDraft === OTHER_VENDOR_VALUE ? customVendorDraft.trim() : vendorDraft.trim();
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const activeModel = useMemo(() => models.find((item) => item.id === activeId) ?? null, [models, activeId]);

  const allSelected = models.length > 0 && selectedIds.length === models.length;
  const selectedTestIds = models.filter((item) => selectedSet.has(item.id)).map((item) => item.id);

  useEffect(() => {
    const validIdSet = new Set(models.map((item) => item.id));
    setSelectedIds((prev) => prev.filter((id) => validIdSet.has(id)));
    if (activeId && !validIdSet.has(activeId)) {
      setActiveId("");
    }
  }, [models, activeId]);

  const handleAdd = () => {
    const result = onAddModel(resolvedVendor, modelDraft);
    setMessage(result.message);
    if (!result.ok) return;
    setCustomVendorDraft("");
    setModelDraft("");
    if (!vendorDraft || vendorDraft === OTHER_VENDOR_VALUE) {
      setVendorDraft("");
    }
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds([]);
      return;
    }
    setSelectedIds(models.map((item) => item.id));
  };

  const toggleRow = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const handleDeleteSingle = () => {
    if (!activeModel) return;
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(`Xóa model ${activeModel.vendor} / ${activeModel.model}?`);
      if (!confirmed) return;
    }
    const result = onDeleteModels([activeModel.id]);
    setMessage(result.message);
  };

  const handleDeleteSelected = () => {
    if (!selectedIds.length) return;
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(`Xóa ${selectedIds.length} model đã chọn?`);
      if (!confirmed) return;
    }
    const result = onDeleteModels(selectedIds);
    setMessage(result.message);
    if (result.ok) setSelectedIds([]);
  };

  const handleTestSingle = async () => {
    if (!activeModel) return;
    const result = await onTestModels([activeModel.id]);
    setMessage(result.message);
  };

  const handleTestSelected = async () => {
    if (!selectedTestIds.length) return;
    const result = await onTestModels(selectedTestIds);
    setMessage(result.message);
  };

  return (
    <section className="settings-view">
      <header className="section-head">
        <div>
          <p className="breadcrumb">Hệ thống &gt; Model</p>
          <h1>Quản lý Model AI</h1>
        </div>
      </header>

      <section className="settings-card">
        <h2>Thêm model</h2>
        <div className={`settings-grid model-add-grid ${vendorDraft === OTHER_VENDOR_VALUE ? "has-custom-vendor" : ""}`}>
          <label>
            Hãng AI
            <CustomSelect
              value={vendorDraft}
              options={vendorOptions}
              onChange={setVendorDraft}
              placeholder="Chọn hãng"
              className="settings-custom-select"
            />
          </label>
          {vendorDraft === OTHER_VENDOR_VALUE ? (
            <label>
              Hãng mới
              <input value={customVendorDraft} onChange={(event) => setCustomVendorDraft(event.target.value)} placeholder="Ví dụ: OpenAI, Google, xAI..." />
            </label>
          ) : null}
          <label>
            Tên model
            <input value={modelDraft} onChange={(event) => setModelDraft(event.target.value)} placeholder="Ví dụ: openai/gpt-oss-120b" />
          </label>
          <div className="model-add-action">
            <button type="button" className="primary-btn" onClick={handleAdd}>
              <Plus size={15} />
              Thêm model
            </button>
          </div>
        </div>
      </section>

      <section className="settings-card">
        <h2>Danh sách model</h2>
        <div className="settings-actions compact model-list-actions">
          <button type="button" className="ghost-btn compact" disabled={!activeModel || isTesting} onClick={() => void handleTestSingle()}>
            <FlaskConical size={14} />
            Test model
          </button>
          <button type="button" className="ghost-btn compact" disabled={!selectedTestIds.length || isTesting} onClick={() => void handleTestSelected()}>
            <FlaskConical size={14} />
            Test model đã chọn
          </button>
          <button type="button" className="ghost-btn compact" disabled={!activeModel} onClick={handleDeleteSingle}>
            <Trash2 size={14} />
            Xóa model
          </button>
          <button type="button" className="ghost-btn compact" disabled={!selectedIds.length} onClick={handleDeleteSelected}>
            <Trash2 size={14} />
            Xóa model đã chọn
          </button>
        </div>

        <div className="model-table-wrap">
          <table className="model-table">
            <thead>
              <tr>
                <th className="model-check-col">
                  <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} aria-label="Chọn tất cả model" />
                </th>
                <th>Hãng</th>
                <th>Model</th>
                <th>Trạng thái test</th>
                <th>Lần test gần nhất</th>
              </tr>
            </thead>
            <tbody>
              {models.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <div className="empty-state">
                      <ServerCog size={20} />
                      <p>Chưa có model nào. Hãy thêm model mới.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                models.map((item) => (
                  <tr key={item.id} className={activeId === item.id ? "active" : ""} onClick={() => setActiveId(item.id)}>
                    <td className="model-check-col" onClick={(event) => event.stopPropagation()}>
                      <input type="checkbox" checked={selectedSet.has(item.id)} onChange={() => toggleRow(item.id)} aria-label={`Chọn ${item.vendor} ${item.model}`} />
                    </td>
                    <td>{item.vendor}</td>
                    <td>{item.model}</td>
                    <td>
                      <span className={`model-status-chip ${item.lastStatus}`}>{item.lastStatus === "ok" ? "Tốt" : item.lastStatus === "error" ? "Lỗi" : "Chưa test"}</span>
                    </td>
                    <td>{item.lastCheckedAt ? new Date(item.lastCheckedAt).toLocaleString("vi-VN") : "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {message ? <p className="story-message">{message}</p> : null}
      </section>
    </section>
  );
}
