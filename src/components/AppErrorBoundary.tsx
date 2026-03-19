import React, { type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
};

type State = {
  hasError: boolean;
  message: string;
};

function clearLocalAppState(): void {
  if (typeof window === "undefined") return;
  const keys = Object.keys(window.localStorage);
  keys.forEach((key) => {
    if (key.startsWith("app.") || key === "manager.state" || key === "creator.state" || key === "blueprint.state" || key === "story.create.state") {
      window.localStorage.removeItem(key);
    }
  });
}

export class AppErrorBoundary extends React.Component<Props, State> {
  state: State = {
    hasError: false,
    message: "",
  };

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error?.message || "Loi runtime",
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[AppErrorBoundary]", error, info);
  }

  private handleReload = () => {
    if (typeof window === "undefined") return;
    window.location.reload();
  };

  private handleClearAndReload = () => {
    clearLocalAppState();
    this.handleReload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "24px",
          background: "linear-gradient(170deg, #060303, #0b0503 42%, #070403 100%)",
          color: "#f6efe9",
          fontFamily: "Manrope, Segoe UI, sans-serif",
        }}
      >
        <div
          style={{
            width: "min(640px, 100%)",
            border: "1px solid #4b2719",
            borderRadius: "16px",
            background: "linear-gradient(155deg, #1b0d08, #120906)",
            boxShadow: "0 24px 56px rgba(0,0,0,0.45)",
            padding: "20px",
            display: "grid",
            gap: "12px",
          }}
        >
          <h2 style={{ margin: 0 }}>Ứng dụng gặp lỗi hiển thị</h2>
          <p style={{ margin: 0, opacity: 0.85 }}>Chi tiết: {this.state.message}</p>
          <p style={{ margin: 0, opacity: 0.75 }}>
            Bạn có thể thử tải lại, hoặc xóa state cũ đã lưu nếu dữ liệu cũ gây vỡ giao diện.
          </p>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={this.handleReload}
              style={{
                border: "1px solid #4b2719",
                borderRadius: "10px",
                padding: "8px 14px",
                background: "#1b0d08",
                color: "#f6efe9",
                cursor: "pointer",
              }}
            >
              Tải lại
            </button>
            <button
              type="button"
              onClick={this.handleClearAndReload}
              style={{
                border: "1px solid #ff7a33",
                borderRadius: "10px",
                padding: "8px 14px",
                background: "linear-gradient(135deg, #ff6a1a, #ffa466)",
                color: "#2b1207",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Xóa state cũ và tải lại
            </button>
          </div>
        </div>
      </div>
    );
  }
}
