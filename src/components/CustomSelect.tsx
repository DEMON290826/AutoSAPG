import { ChevronDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type Option = {
  value: string;
  label: string;
  disabled?: boolean;
};

type Props = {
  value: string;
  options: Option[];
  onChange: (nextValue: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
};

export function CustomSelect({ value, options, onChange, placeholder = "Chọn", disabled = false, className = "" }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const selectedOption = useMemo(() => options.find((item) => item.value === value), [options, value]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  const triggerLabel = selectedOption?.label ?? placeholder;

  return (
    <div ref={rootRef} className={`custom-select ${open ? "open" : ""} ${disabled ? "disabled" : ""} ${className}`.trim()}>
      <button type="button" className="custom-select-trigger" disabled={disabled} onClick={() => setOpen((prev) => !prev)} aria-expanded={open}>
        <span className={`custom-select-label ${selectedOption ? "" : "placeholder"}`}>{triggerLabel}</span>
        <ChevronDown size={15} className="custom-select-arrow" />
      </button>
      {open ? (
        <div className="custom-select-menu" role="listbox">
          {options.map((item) => (
            <button
              key={item.value}
              type="button"
              className={`custom-select-option ${item.value === value ? "active" : ""}`}
              onClick={() => {
                if (item.disabled) return;
                onChange(item.value);
                setOpen(false);
              }}
              disabled={item.disabled}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

