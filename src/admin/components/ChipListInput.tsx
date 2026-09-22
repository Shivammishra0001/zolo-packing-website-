// ============================================================
// ChipListInput — a multi-value text field rendered as removable chips.
//
// Used for Product Sizes and Colours, which the database stores as ONE
// comma-separated string column each. The component works purely on the
// parsed string[]; the caller joins/splits with lib/product-options so the
// stored format never changes.
//
// Typing "6x6x4, 8x8x6 | 10x8x6" and pressing Enter (or comma/pipe, or
// blurring) adds every value at once; ✕ or Backspace on an empty input removes.
// ============================================================

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { cn } from "@/utils/cn";
import { MAX_OPTION_VALUES, splitMultiValue } from "@/lib/product-options";

export function ChipListInput({
  values,
  onChange,
  label,
  placeholder,
  hint,
  className,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  /** Accessible name for the text input (e.g. "Add size"). */
  label: string;
  placeholder?: string;
  hint?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();

  const commit = (text: string) => {
    const incoming = splitMultiValue(text);
    if (!incoming.length) { setDraft(""); return; }
    onChange(splitMultiValue([...values, ...incoming]));
    setDraft("");
  };

  const remove = (index: number) => onChange(values.filter((_, i) => i !== index));

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "," || e.key === "|") {
      e.preventDefault();
      commit(draft);
    } else if (e.key === "Backspace" && draft === "" && values.length) {
      e.preventDefault();
      remove(values.length - 1);
    }
  };

  const full = values.length >= MAX_OPTION_VALUES;

  return (
    <div className={className}>
      <div
        className="flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-lg border erp-border erp-surface px-2 py-1.5 focus-within:border-primary-500 focus-within:ring-2 focus-within:ring-primary-100 dark:focus-within:ring-primary-500/20"
        onClick={() => inputRef.current?.focus()}
      >
        {values.map((v, i) => (
          <span
            key={v}
            className="inline-flex items-center gap-1 rounded-md bg-primary-50 px-2 py-0.5 text-xs font-semibold text-primary-800 dark:bg-primary-500/15 dark:text-primary-200"
            data-chip={v}
          >
            {v}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); remove(i); }}
              aria-label={`Remove ${v}`}
              className="rounded p-0.5 text-primary-600 hover:bg-primary-100 hover:text-primary-900 dark:hover:bg-primary-500/25"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => {
            const v = e.target.value;
            // A paste containing separators is committed immediately.
            if (/[,|;\n]/.test(v)) commit(v); else setDraft(v);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => commit(draft)}
          placeholder={values.length ? "" : placeholder}
          aria-label={label}
          aria-describedby={hint ? hintId : undefined}
          disabled={full}
          className={cn("h-7 min-w-24 flex-1 bg-transparent text-sm erp-text outline-none placeholder:erp-text-faint", full && "cursor-not-allowed")}
        />
      </div>
      {hint && <p id={hintId} className="mt-1 text-[11px] erp-text-faint">{hint}</p>}
    </div>
  );
}
