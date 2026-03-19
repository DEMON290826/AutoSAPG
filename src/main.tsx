import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

function renderFatalBootError(error: unknown): void {
  const root = document.getElementById("root");
  if (!root) return;
  const message = error instanceof Error ? error.message : String(error ?? "Loi khong xac dinh");
  root.innerHTML = `
    <div style="min-height:100vh;display:grid;place-items:center;padding:24px;background:linear-gradient(170deg,#060303,#0b0503 42%,#070403 100%);color:#f6efe9;font-family:Manrope,Segoe UI,sans-serif;">
      <div style="width:min(680px,100%);border:1px solid #4b2719;border-radius:16px;background:linear-gradient(155deg,#1b0d08,#120906);box-shadow:0 24px 56px rgba(0,0,0,0.45);padding:20px;display:grid;gap:12px;">
        <h2 style="margin:0;">Ung dung gap loi khoi dong</h2>
        <p style="margin:0;opacity:.85;">Chi tiet: ${message.replace(/[<>&]/g, "")}</p>
        <p style="margin:0;opacity:.75;">Thu tai lai app. Neu van loi, bam xoa state cu trong man hinh loi chinh.</p>
      </div>
    </div>
  `;
}

async function bootstrapApp(): Promise<void> {
  const rootNode = document.getElementById("root");
  if (!rootNode) throw new Error("Khong tim thay #root");
  const root = createRoot(rootNode);

  try {
    const [{ default: App }, { AppErrorBoundary }] = await Promise.all([import("./App.tsx"), import("./components/AppErrorBoundary.tsx")]);
    root.render(
      <StrictMode>
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
      </StrictMode>,
    );
  } catch (error) {
    console.error("[bootstrapApp]", error);
    renderFatalBootError(error);
  }
}

void bootstrapApp();
