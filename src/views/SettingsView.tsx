import { FolderOpen, Moon, Sun, Trash2 } from "lucide-react";
import { CustomSelect } from "../components/CustomSelect";
import { DNA_ANALYST_SYSTEM_PROMPT, STORY_WRITER_SYSTEM_PROMPT } from "../dna/prompts";
import type { ApiRuntimeHealth, AppSettingsState, AppTheme } from "../types/appSettings";
import { canUseElectronBridge, pickDirectoryDialog, pickJsonFileDialog } from "../utils/electronBridge";

type Props = {
  settings: AppSettingsState;
  theme: AppTheme;
  apiHealth: ApiRuntimeHealth;
  onChangeSettings: (next: Partial<AppSettingsState>) => void;
  onToggleTheme: () => void;
  onResetData: () => void;
};

function healthLabel(apiHealth: ApiRuntimeHealth): string {
  if (apiHealth.status === "ok") return "API đang hoạt động tốt";
  if (apiHealth.status === "error") return "API đang lỗi";
  if (apiHealth.status === "testing") return "Đang kiểm tra API";
  return "Chưa kiểm tra API";
}

function modelText(vendor: string, model: string): string {
  if (!vendor || !model) return "Chưa chọn model";
  return `${vendor} / ${model}`;
}

const batchOptions = Array.from({ length: 15 }, (_, i) => i + 1).map((size) => ({ value: String(size), label: String(size) }));
const storyBatchOptions = Array.from({ length: 15 }, (_, i) => i + 1).map((size) => ({ value: String(size), label: String(size) }));

export function SettingsView({ settings, theme, apiHealth, onChangeSettings, onToggleTheme, onResetData }: Props) {
  const handlePickCookieJson = async () => {
    const picked = await pickJsonFileDialog().catch(() => null);
    if (picked) onChangeSettings({ storyCookieJsonPath: picked });
  };

  const handlePickDnaDirectory = async () => {
    const picked = await pickDirectoryDialog().catch(() => null);
    if (picked) onChangeSettings({ dnaStoragePath: picked });
  };

  const handlePickStoryDirectory = async () => {
    const picked = await pickDirectoryDialog().catch(() => null);
    if (picked) onChangeSettings({ storyStoragePath: picked });
  };

  return (
    <section className="settings-view">
      <header className="section-head">
        <div>
          <p className="breadcrumb">Hệ thống &gt; Cài đặt</p>
          <h1>Cài đặt</h1>
        </div>
      </header>

      <section className="settings-card">
        <h2>Kết nối API</h2>
        <div className="settings-compact-grid">
          <label>
            Địa chỉ API
            <input value={settings.apiUrl} onChange={(event) => onChangeSettings({ apiUrl: event.target.value })} placeholder="https://platform.beeknoee.com/api/v1/chat/completions" />
          </label>
          <div className={`api-health-inline ${apiHealth.status === "ok" ? "ok" : apiHealth.status === "error" ? "error" : "idle"}`}>
            <span>{healthLabel(apiHealth)}</span>
          </div>
          <div className="settings-inline-row mt-2">
            <label className="flex-1">
              Thử lại tối đa
              <input type="number" value={settings.maxRetries} onChange={(e) => onChangeSettings({ maxRetries: Number(e.target.value) })} min={0} max={10} />
            </label>
            <label className="flex-1">
              Chờ thử lại (ms)
              <input type="number" value={settings.retryDelay} onChange={(e) => onChangeSettings({ retryDelay: Number(e.target.value) })} step={1000} min={1000} />
            </label>
          </div>
        </div>
      </section>

      <section className="settings-card">
        <h2>Khóa API theo tab</h2>
        <div className="settings-key-grid">
          <label>
            Danh sách API Key Truyện (Reviewer) - Dùng dấu ; hoặc xuống dòng để tách (Tối đa 5 Key)
            <textarea 
              value={settings.storyApiKeys} 
              onChange={(event) => onChangeSettings({ storyApiKeys: event.target.value })} 
              placeholder="Key1; Key2; Key3..."
              style={{ minHeight: "80px", fontFamily: "monospace", fontSize: "0.85rem" }}
            />
          </label>
          <label>
            API key Tạo DNA
            <input type="password" value={settings.dnaApiKey} onChange={(event) => onChangeSettings({ dnaApiKey: event.target.value })} placeholder="Nhập API key cho tab Tạo DNA" />
          </label>
        </div>
      </section>

      <section className="settings-card">
        <h2>Writer trinh duyet</h2>
        <div className="settings-key-grid">
          <label>
            Cookie JSON ChatGPT
            <div className="settings-inline-pick">
              <input
                value={settings.storyCookieJsonPath}
                onChange={(event) => onChangeSettings({ storyCookieJsonPath: event.target.value })}
                placeholder="Vi du: D:\\chatgpt-cookies.json"
              />
              <button type="button" className="ghost-btn compact" onClick={handlePickCookieJson} disabled={!canUseElectronBridge()}>
                <FolderOpen size={15} />
                Chon file
              </button>
            </div>
          </label>
          <label>
            URL ChatGPT
            <input
              value={settings.storyWriterChatUrl}
              onChange={(event) => onChangeSettings({ storyWriterChatUrl: event.target.value })}
              placeholder="https://chatgpt.com/"
            />
          </label>
        </div>
        <p className="setting-note">Tab Tao truyện se mo Chromium bang Playwright, nap cookie JSON, gui prompt vao ChatGPT va doi cau tra loi tren trinh duyet.</p>
      </section>

      <section className="settings-card">
        <h2>Đường dẫn lưu</h2>
        <div className="settings-key-grid">
          <label>
            Lưu DNA
            <div className="settings-inline-pick">
              <input
                value={settings.dnaStoragePath}
                onChange={(event) => onChangeSettings({ dnaStoragePath: event.target.value })}
                placeholder="Ví dụ: D:\\DNA_Library"
              />
              <button type="button" className="ghost-btn compact" onClick={handlePickDnaDirectory} disabled={!canUseElectronBridge()}>
                <FolderOpen size={15} />
                Chọn thư mục
              </button>
            </div>
          </label>
          <label>
            Lưu truyện
            <div className="settings-inline-pick">
              <input
                value={settings.storyStoragePath}
                onChange={(event) => onChangeSettings({ storyStoragePath: event.target.value })}
                placeholder="Ví dụ: D:\\DNA_Library\\story_projects"
              />
              <button type="button" className="ghost-btn compact" onClick={handlePickStoryDirectory} disabled={!canUseElectronBridge()}>
                <FolderOpen size={15} />
                Chọn thư mục
              </button>
            </div>
          </label>
        </div>
        <p className="setting-note">Để trống để dùng mặc định trong Documents. Khi chạy ngoài Electron sẽ không lưu được file cục bộ.</p>
      </section>

      <section className="settings-card">
        <h2>Batch xử lý</h2>
        <div className="settings-key-grid">
          <label>
            Tạo Truyện (đồng thời - tối đa 25)
            <CustomSelect
              value={String(settings.storyBatchSize)}
              options={storyBatchOptions}
              onChange={(nextValue) => onChangeSettings({ storyBatchSize: Number(nextValue) })}
              className="settings-custom-select"
            />
          </label>
          <label>
            Tạo DNA (đồng thời)
            <CustomSelect
              value={String(settings.dnaBatchSize)}
              options={batchOptions}
              onChange={(nextValue) => onChangeSettings({ dnaBatchSize: Number(nextValue) })}
              className="settings-custom-select"
            />
          </label>
        </div>
      </section>

      <section className="settings-card">
        <h2>Cấu hình đang dùng</h2>
        <div className="settings-status-row">
          <div className="settings-status-chip">
            <strong>Tạo Truyện:</strong>
            <span style={{ color: "#818cf8" }}>Chromium Writer (ChatGPT)</span>
          </div>
          <div className="settings-status-chip">
            <strong>Reviewer Truyện:</strong>
            <span>{modelText(settings.storyReviewerVendor, settings.storyReviewerModel)}</span>
          </div>
          <div className="settings-status-chip">
            <strong>Tạo DNA:</strong>
            <span>{modelText(settings.dnaVendor, settings.dnaModel)}</span>
          </div>
        </div>
        <p className="setting-note">Đổi model trực tiếp trong tab Tạo Truyện hoặc Tạo DNA.</p>
      </section>

      <section className="settings-card">
        <h2>Prompt hệ thống</h2>
        <div className="settings-key-grid prompt-grid">
          <label>
            Prompt DNA
            <textarea value={DNA_ANALYST_SYSTEM_PROMPT} readOnly className="prompt-readonly" />
          </label>
          <label>
            Prompt Tạo Truyện
            <textarea value={STORY_WRITER_SYSTEM_PROMPT} readOnly className="prompt-readonly" />
          </label>
        </div>
        <p className="setting-note">Đây là prompt nền hệ thống. Muốn chỉnh sâu, cập nhật trong src/dna/prompts.ts.</p>
      </section>

      <section className="settings-card">
        <h2>Giao diện và dữ liệu</h2>
        <div className="settings-actions compact">
          <button type="button" className="ghost-btn" onClick={onToggleTheme}>
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
            {theme === "dark" ? "Chuyển nền sáng" : "Chuyển nền tối"}
          </button>
          <button type="button" className="danger-btn" onClick={onResetData}>
            <Trash2 size={15} />
            Xóa dữ liệu lưu
          </button>
        </div>
      </section>
    </section>
  );
}
