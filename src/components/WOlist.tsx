// src/components/WOlist.tsx
import { useEffect, useState, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import DayCard from "./ui/DayCard";
import TodoCard from "./ui/TodoCard";
import GlassButton from "./ui/GlassButton";

/* ---------- Types ---------- */
type WOStatus = "Not Started" | "In Progress" | "Done";
type WONote = {
  id: string;
  partNumber: string;
  rfqStatus: "drafted" | "sent" | "received";
  memo: string;
};
type WorkOrder = {
  id: string;
  salesOrder: string;
  workOrder: string;
  customer: string;
  status: WOStatus;
  due_on?: string;       // YYYY-MM-DD
  urgency?: "low" | "medium" | "high";
  notes: WONote[];
  created_at: string;    // ISO
};

/* ---------- Local storage ---------- */
const STORAGE_KEY = "todo-lite.workorders.v1";
const loadWO = (): WorkOrder[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]") as any[];
    return (raw || []).map((w) => ({
      ...w,
      urgency: (w?.urgency as any) || "medium",
      notes: (w?.notes || []).map((n: any) => {
        let rfqStatus: "drafted" | "sent" | "received" = "drafted";
        if (n?.rfqReceived) rfqStatus = "received";
        else if (n?.rfqSent) rfqStatus = "sent";
        else if (n?.rfqDrafted) rfqStatus = "drafted";
        return {
          id: n?.id || crypto.randomUUID(),
          partNumber: n?.partNumber || "",
          rfqStatus,
          memo: n?.memo || "",
        };
      }),
    }));
  } catch {
    return [];
  }
};
const saveWO = (list: WorkOrder[]) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
};

/* ---------- Date helpers / warnings ---------- */
function daysBetweenUTC(iso?: string, from = new Date()) {
  if (!iso) return Number.POSITIVE_INFINITY;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return Number.POSITIVE_INFINITY;
  const aUTC = Date.UTC(y, (m || 1) - 1, d || 1);
  const bUTC = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  return Math.round((aUTC - bUTC) / (1000 * 60 * 60 * 24));
}
function _isDueWithin5to9Weeks(iso?: string) {
  const dd = daysBetweenUTC(iso);
  return dd >= 35 && dd <= 63; // 5–9 weeks inclusive
}

// Flexible date normalizer and validator
function toISOIfPossible(input: string): { iso?: string; valid: boolean } {
  const s = (input || "").trim();
  if (!s) return { valid: false };
  // Case 1: already YYYY-MM-DD
  const mIso = /^\d{4}-\d{2}-\d{2}$/.exec(s);
  if (mIso) return { iso: s, valid: true };
  // Case 2: MM/DD/YYYY or M/D/YYYY
  const mUS = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
  if (mUS) {
    let mm = parseInt(mUS[1], 10);
    let dd = parseInt(mUS[2], 10);
    let yyyy = parseInt(mUS[3], 10);
    if (yyyy < 100) yyyy = 2000 + yyyy; // 2-digit year -> 20xx
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      const iso = `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
      return { iso, valid: true };
    }
  }
  return { valid: false };
}

function computeUrgencyFromDue(iso?: string): "low" | "medium" | "high" {
  const d = daysBetweenUTC(iso);
  if (!isFinite(d)) return "low"; // no date → treat as low
  if (d < 35) return "high";      // < 5 weeks
  if (d < 105) return "medium";   // 5–14 weeks
  return "low";                    // ≥ 15 weeks
}

// Helper: format ISO date as MM/DD/YY for input fields
function fmtShortDate(iso?: string): string {
  if (!iso) return "";
  const [y, m, d] = (iso || "").split("-").map(Number);
  if (!y || !m || !d) return iso || "";
  return `${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}/${String(y).slice(-2)}`;
}

/* ---------- Main WO list ---------- */
export default function WOList() {
  const [items, setItems] = useState<WorkOrder[]>(loadWO);
  useEffect(() => { saveWO(items); }, [items]);

  // focused card selection (for arrow-key nav)
  const [focusedId, setFocusedId] = useState<string | null>(null);
  // const didInitFocus = useState(false)[0]; // placeholder to keep minimal changes
  const itemsRef = useRef(items);
  const focusedIdRef = useRef<string | null>(null);
  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => { focusedIdRef.current = focusedId; }, [focusedId]);

  // Helper: focus a row by id
  function focusRow(id: string) {
    requestAnimationFrame(() => {
      const row = document.querySelector<HTMLElement>(`[data-wo-row="${id}"]`);
      row?.focus();
      row?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }

  // Arrow up/down hotkey handler
  const handleHotkey = (e: KeyboardEvent) => {
    if (e.defaultPrevented) return;
    const t = e.target as HTMLElement | null;
    const tag = t?.tagName?.toLowerCase();
    const interactive = tag === 'input' || tag === 'textarea' || tag === 'select' || (t as any)?.isContentEditable;
    if (interactive || e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const items = itemsRef.current;
      if (!items.length) return;
      const ids = items.map(w => w.id);
      const cur = (focusedIdRef.current && ids.includes(focusedIdRef.current)) ? focusedIdRef.current : ids[0];
      const i = ids.indexOf(cur!);
      const nextIndex = e.key === 'ArrowDown' ? Math.min(i + 1, ids.length - 1) : Math.max(i - 1, 0);
      const nextId = ids[nextIndex];
      setFocusedId(nextId);
      focusRow(nextId);
    }
  };

  // Register/unregister keydown handler
  useEffect(() => {
    const h = (e: KeyboardEvent) => handleHotkey(e);
    // Single listener in capture phase to avoid double-firing and skipping items
    window.addEventListener('keydown', h, true);
    return () => {
      window.removeEventListener('keydown', h, true);
    };
  }, []);

  // On first render with items, select the first card
  useEffect(() => {
    if (!items.length) return;
    if (!focusedIdRef.current) {
      const firstId = items[0].id;
      setFocusedId(firstId);
      focusRow(firstId);
    }
  }, [items]);

  const addWO = () => {
    const id = crypto.randomUUID();
    setItems(prev => [{
      id,
      salesOrder: "",
      workOrder: "",
      customer: "",
      status: "Not Started",
      due_on: undefined,
      urgency: computeUrgencyFromDue(undefined),
      notes: [],
      created_at: new Date().toISOString(),
    }, ...prev]);
  };
  const updateWO = (id: string, patch: Partial<WorkOrder>) => {
    const nextPatch = { ...patch } as Partial<WorkOrder>;
    if (Object.prototype.hasOwnProperty.call(patch, "due_on")) {
      nextPatch.urgency = computeUrgencyFromDue(patch.due_on);
    }
    setItems(prev => prev.map(w => (w.id === id ? { ...w, ...nextPatch } : w)));
  };
  const removeWO = (id: string) =>
    setItems(prev => prev.filter(w => w.id !== id));

  const addLine = (woId: string) =>
    setItems(prev => prev.map(w => w.id === woId
      ? { ...w, notes: [{ id: crypto.randomUUID(), partNumber: "", rfqStatus: "drafted", memo: "" }, ...w.notes] }
      : w));

  const updateLine = (woId: string, noteId: string, patch: Partial<WONote>) =>
    setItems(prev => prev.map(w => w.id === woId
      ? { ...w, notes: w.notes.map(n => n.id === noteId ? { ...n, ...patch } : n) }
      : w));

  const removeLine = (woId: string, noteId: string) =>
    setItems(prev => prev.map(w => w.id === woId
      ? { ...w, notes: w.notes.filter(n => n.id !== noteId) }
      : w));

  // Periodically recompute urgency so it updates as time passes
  function recomputeAllUrgencies() {
    setItems(prev => {
      let changed = false;
      const next = prev.map(w => {
        const calc = computeUrgencyFromDue(w.due_on);
        if (w.urgency !== calc) {
          changed = true;
          return { ...w, urgency: calc };
        }
        return w;
      });
      return changed ? next : prev;
    });
  }

  useEffect(() => {
    // initial
    recomputeAllUrgencies();
    // then hourly
    const id = setInterval(recomputeAllUrgencies, 60 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="mx-auto max-w-[1100px] px-6 sm:px-8">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[13px] font-mono text-neutral-500">Work Orders</div>
        <GlassButton tone="neutral" onClick={addWO}>+ Add Work Order</GlassButton>
      </div>

      <DayCard className="mt-4">
        {items.length === 0 ? (
          <div className="p-4 text-[11px] font-mono text-neutral-500">No work orders yet.</div>
        ) : (
          <ul className="space-y-3">
            {items.map(w => {
              // const dueWarn = isDueWithin5to9Weeks(w.due_on);
              return (
                <li key={w.id}>
                  <TodoCard
                    data-wo-row={w.id}
                    tabIndex={0}
                    onFocus={() => setFocusedId(w.id)}
                    onKeyDown={(e) => {
                      if (e.currentTarget !== e.target) return; // ignore if in a field

                      // Enter: focus Sales Order field
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const input = e.currentTarget.querySelector<HTMLInputElement>('input[placeholder="Sales Order #"]');
                        if (input) { input.focus(); input.select?.(); }
                        return;
                      }

                      // Tab from focused card: also focus Sales Order first
                      if (e.key === "Tab") {
                        e.preventDefault();
                        const input = e.currentTarget.querySelector<HTMLInputElement>('input[placeholder="Sales Order #"]');
                        if (input) { input.focus(); input.select?.(); }
                        return;
                      }
                    }}
                    className={[
                      "outline-none",
                      focusedId === w.id
                        ? "ring-2 ring-neutral-400/40"
                        : "ring-1 ring-neutral-200/50",
                    ].join(" ")}
                  >
                    {/* title row: Sales Order with inline delete */}
                    <div className="mb-2 flex items-center gap-2">
                      <input
                        placeholder="Sales Order #"
                        value={w.salesOrder}
                        onFocus={() => setFocusedId(w.id)}
                        onChange={(e) => updateWO(w.id, { salesOrder: e.target.value })}
                        className={[
                          "flex-1 rounded-lg border border-neutral-200/70 bg-white/80",
                          "px-2 py-1 outline-none font-sans text-[15px] font-semibold",
                          "backdrop-blur supports-[backdrop-filter]:backdrop-blur-sm",
                          "focus:border-neutral-300"
                        ].join(" ")}
                      />
                      <button
                        className="h-7 w-7 rounded-md border border-neutral-200/70 bg-white/80 leading-none"
                        aria-label="Delete work order"
                        onClick={() => removeWO(w.id)}
                        title="Delete work order"
                      >
                        ×
                      </button>
                    </div>

                    {/* secondary fields row */}
                    <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
                      <InlineInput
                        placeholder="Work Order #"
                        value={w.workOrder}
                        onFocus={() => setFocusedId(w.id)}
                        onChange={(e) => updateWO(w.id, { workOrder: e.target.value })}
                      />
                      <InlineInput
                        placeholder="Customer"
                        value={w.customer}
                        onFocus={() => setFocusedId(w.id)}
                        onChange={(e) => updateWO(w.id, { customer: e.target.value })}
                      />
                      <InlineSelect
                        value={w.status}
                        options={[
                          { key: "Not Started", label: "Not Started", className: "text-neutral-800" },
                          { key: "In Progress", label: "In Progress", className: "text-blue-800" },
                          { key: "Done",        label: "Done",        className: "text-green-800" },
                        ]}
                        onChange={(v) => updateWO(w.id, { status: v as WOStatus })}
                        onFocus={() => setFocusedId(w.id)}
                        buttonClass={[
                          "rounded-md border px-3 py-1.5 pr-6 text-[11px] font-mono leading-none",
                          "backdrop-blur-md supports-[backdrop-filter]:backdrop-blur-md",
                          "shadow-xs ring-1 ring-black/5 focus:outline-none focus:border-neutral-300",
                          w.status === "Done"
                            ? "border-green-200 bg-green-50/70 text-green-800"
                            : w.status === "In Progress"
                            ? "border-blue-200 bg-blue-50/70 text-blue-800"
                            : "border-neutral-200 bg-white/70 text-neutral-800",
                          `wo-status-btn-${w.id}`,
                        ].join(" ")}
                        nextFocusQuery={`.wo-urgency-btn-${w.id}`}
                        onEscapeFocusRow={() => {
                          requestAnimationFrame(() => {
                            const row = document.querySelector<HTMLElement>(`[data-wo-row="${w.id}"]`);
                            row?.focus();
                          });
                        }}
                      />
                      <InlineSelect
                        value={w.urgency || "medium"}
                        options={[
                          { key: "low",    label: "low",    className: "text-neutral-800" },
                          { key: "medium", label: "medium", className: "text-amber-800" },
                          { key: "high",   label: "high",   className: "text-red-800" },
                        ]}
                        onChange={(v) => updateWO(w.id, { urgency: v as any })}
                        onFocus={() => setFocusedId(w.id)}
                        buttonClass={[
                          "rounded-md border px-3 py-1.5 pr-6 text-[11px] font-mono leading-none",
                          "backdrop-blur-md supports-[backdrop-filter]:backdrop-blur-md",
                          "shadow-xs ring-1 ring-black/5 focus:outline-none focus:border-neutral-300",
                          (w.urgency || "medium") === "high"
                            ? "border-red-200 bg-red-50/70 text-red-800"
                            : (w.urgency || "medium") === "medium"
                            ? "border-amber-200 bg-amber-50/70 text-amber-800"
                            : "border-neutral-200 bg-white/70 text-neutral-800",
                          `wo-urgency-btn-${w.id}`,
                        ].join(" ")}
                        nextFocusQuery={`input.wo-due-${w.id}`}
                        onEscapeFocusRow={() => {
                          requestAnimationFrame(() => {
                            const row = document.querySelector<HTMLElement>(`[data-wo-row="${w.id}"]`);
                            row?.focus();
                          });
                        }}
                      />
                      <InlineInput
                        placeholder="MM/DD/YY"
                        value={fmtShortDate(w.due_on)}
                        onFocus={() => setFocusedId(w.id)}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const norm = toISOIfPossible(raw);
                          // update immediately; urgency will recompute in updateWO
                          updateWO(w.id, { due_on: norm.iso ?? (raw.trim() ? raw : undefined) });
                        }}
                        onBlur={(e) => {
                          // On blur, snap to canonical YYYY-MM-DD if we can parse it
                          const raw = e.target.value;
                          const norm = toISOIfPossible(raw);
                          if (norm.valid && norm.iso && norm.iso !== w.due_on) {
                            updateWO(w.id, { due_on: norm.iso });
                          }
                        }}
                        className={`border border-neutral-200/70 bg-white/80 focus:border-neutral-300 wo-due-${w.id}`}
                      />
                    </div>

                    {/* line notes */}
                    <div className="mt-3">
                      <div className="mb-1 flex items-center justify-between">
                        <div className="text-[11px] font-mono text-neutral-500">Line Notes</div>
                        <GlassButton size="sm" tone="neutral" onClick={() => addLine(w.id)}>+ Add Line</GlassButton>
                      </div>

                      <div className="space-y-2">
                        {w.notes.map(n => (
                          <div
                            key={n.id}
                            className="grid grid-cols-2 sm:grid-cols-[1.2fr_auto_3fr_auto] gap-2 items-center rounded-md border border-neutral-200/60 bg-white/70 px-2 py-2"
                          >
                            <InlineInput
                              placeholder="Part #"
                              value={n.partNumber}
                              onFocus={() => setFocusedId(w.id)}
                              onChange={(e) => updateLine(w.id, n.id, { partNumber: e.target.value })}
                            />

                            <InlineSelect
                              value={n.rfqStatus}
                              options={[
                                { key: "drafted",  label: "drafted",  className: "text-amber-800" },
                                { key: "sent",     label: "sent",     className: "text-blue-800" },
                                { key: "received", label: "received", className: "text-green-800" },
                              ]}
                              onChange={(v) => updateLine(w.id, n.id, { rfqStatus: v as WONote["rfqStatus"] })}
                              onFocus={() => setFocusedId(w.id)}
                              buttonClass={[
                                "rounded-md border px-3 py-1.5 pr-6 text-[11px] font-mono leading-none",
                                "backdrop-blur-md supports-[backdrop-filter]:backdrop-blur-md",
                                "shadow-xs ring-1 ring-black/5 focus:outline-none focus:border-neutral-300",
                                n.rfqStatus === "received"
                                  ? "border-green-200 bg-green-50/70 text-green-800"
                                  : n.rfqStatus === "sent"
                                  ? "border-blue-200 bg-blue-50/70 text-blue-800"
                                  : "border-amber-200 bg-amber-50/70 text-amber-800",
                                `wo-rfq-btn-${n.id}`,
                              ].join(" ")}
                              nextFocusQuery={`input.wo-memo-${n.id}`}
                              onEscapeFocusRow={() => {
                                requestAnimationFrame(() => {
                                  const row = document.querySelector<HTMLElement>(`[data-wo-row="${w.id}"]`);
                                  row?.focus();
                                });
                              }}
                            />

                            <InlineInput
                              placeholder="Memo…"
                              value={n.memo}
                              onFocus={() => setFocusedId(w.id)}
                              onChange={(e) => updateLine(w.id, n.id, { memo: e.target.value })}
                              className={`wo-memo-${n.id}`}
                            />

                            <button
                              className="h-7 w-7 rounded-md border border-neutral-200/70 bg-white/80 leading-none"
                              aria-label="Delete line"
                              onClick={() => removeLine(w.id, n.id)}
                            >
                              ×
                            </button>
                          </div>
                        ))}
                        {w.notes.length === 0 && (
                          <div className="text-[11px] font-mono text-neutral-400">No lines yet.</div>
                        )}
                      </div>
                    </div>
                  </TodoCard>
                </li>
              );
            })}
          </ul>
        )}
      </DayCard>
    </div>
  );
}

// --- Inline popover select (matches TodoList interaction) ---
function InlineSelect({
  value,
  options,
  onChange,
  className = "",
  buttonClass = "",
  onEscapeFocusRow,
  nextFocusQuery,
  prevFocusQuery,
  onFocus,
}: {
  value: string; // current option key/value
  options: { key: string; label: string; className?: string }[] | string[];
  onChange: (key: string) => void;
  className?: string;
  buttonClass?: string;
  onEscapeFocusRow?: () => void;
  nextFocusQuery?: string;
  prevFocusQuery?: string;
  onFocus?: () => void;
}) {
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 0 });
  const skipOpenRef = useRef(false);

  // normalize options to objects
  const opts = (options as any[]).map((o) =>
    typeof o === "string" ? { key: o, label: o } : o
  );

  // close on outside click
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (listRef.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  // ensure highlight follows current value when closed
  useEffect(() => {
    if (open) return;
    const idx = Math.max(0, opts.findIndex((o) => o.key === value));
    setHighlight(idx);
  }, [open, value, opts]);

  function updatePos() {
    const btn = btnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    setPos({ top: Math.round(r.bottom + 4), left: Math.round(r.left), width: Math.max(192, Math.round(r.width)) });
  }

  useLayoutEffect(() => {
    if (!open) return;
    updatePos();
    const onScroll = () => updatePos();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  const current = opts.find((o) => o.key === value) || opts[0];

  return (
    <div className={["relative z-30", className].join(" ")}>
      <button
        ref={btnRef}
        type="button"
        className={buttonClass}
        onFocus={() => {
          onFocus?.();
          if (skipOpenRef.current) {
            skipOpenRef.current = false;
            return;
          }
          setOpen(true);
          setHighlight(0);
          updatePos();
        }}
        onMouseDown={(e) => {
          e.preventDefault();
          if (!open) {
            updatePos();
            setHighlight(0);
          }
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (!open) {
            if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setOpen(true);
              setHighlight(0);
              updatePos();
            }
            return;
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlight((h) => Math.min(h + 1, opts.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            const opt = opts[highlight] || opts[0];
            onChange(opt.key);
            setOpen(false);
            skipOpenRef.current = true;
            requestAnimationFrame(() => btnRef.current?.focus());
          } else if (e.key === "Tab") {
            const lastIndex = opts.length - 1;
            const atEndForward = !e.shiftKey && highlight >= lastIndex;
            const atEndBackward = e.shiftKey && highlight <= 0;

            if (atEndForward || atEndBackward) {
              const opt = opts[highlight] || opts[0];
              onChange(opt.key);
              setOpen(false);
              skipOpenRef.current = true;

              const selector = atEndForward ? nextFocusQuery : prevFocusQuery;
              if (selector) {
                requestAnimationFrame(() => {
                  const el = document.querySelector(selector) as HTMLElement | null;
                  el?.focus();
                });
                e.preventDefault();
              }
            } else {
              e.preventDefault();
              setHighlight((h) => {
                const delta = e.shiftKey ? -1 : 1;
                return Math.min(Math.max(h + delta, 0), lastIndex);
              });
            }
          } else if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
            skipOpenRef.current = true;
            if (onEscapeFocusRow) onEscapeFocusRow();
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-popover-button
      >
        {current?.label}
        <span className="ml-1 text-[12px] text-neutral-600">▾</span>
      </button>

      {open &&
        createPortal(
          <div
            ref={listRef}
            role="listbox"
            style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width, zIndex: 1000 }}
            className="overflow-hidden rounded-md border border-neutral-200/70 bg-white/95 backdrop-blur-md shadow-lg ring-1 ring-black/5"
          >
            {opts.map((opt, i) => (
              <button
                key={opt.key}
                role="option"
                aria-selected={value === opt.key}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => {
                  onChange(opt.key);
                  setOpen(false);
                  skipOpenRef.current = true;
                  requestAnimationFrame(() => btnRef.current?.focus());
                }}
                className={[
                  "block w-full text-left px-3 py-2 text-[11px] font-mono",
                  i === highlight ? "bg-neutral-100" : "bg-transparent",
                  opt.className || "text-neutral-800",
                ].join(" ")}
              >
                {opt.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}

/* ---------- Small primitives (reuse your visual language) ---------- */
function InlineInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  // Add Escape focus-row logic
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      // Find closest ancestor with data-wo-row and focus it
      const el = e.currentTarget as HTMLElement;
      const row = el.closest('[data-wo-row]');
      if (row && (row as HTMLElement).focus) {
        (row as HTMLElement).focus();
      }
    }
    props.onKeyDown?.(e);
  }
  return (
    <input
      {...props}
      onKeyDown={handleKeyDown}
      className={[
        "w-full rounded-md border border-neutral-200/70 bg-white/80",
        "backdrop-blur supports-[backdrop-filter]:backdrop-blur-sm",
        "px-2 py-1.5 text-[11px] font-mono leading-[1.4] placeholder:text-neutral-400 focus:outline-none focus:border-neutral-300",
        props.className || ""
      ].join(" ")}
    />
  );
}
