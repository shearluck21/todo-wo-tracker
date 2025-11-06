// TodoList — stable due dates with daily rollover, compact dropdowns for Priority & Due,
// pinned-new while editing, priority sorting (High → Medium → Low), and auto-prune of
// completed tasks from prior days. Compile-safe for Vercel.

"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import DayCard from "./ui/DayCard";
import TodoCard from "./ui/TodoCard";
import GlassButton from "./ui/GlassButton";

// ---------------- Types ----------------
type Priority = "low" | "medium" | "high";
type Task = {
  id: string;
  text: string;
  done: boolean;
  priority: Priority;

  // Stable due fields (store these)
  dueKey?: string | null;    // "today" | "tomorrow" | "next-mon" | "wd-YYYY-MM-DD"
  dueISO?: string | null;    // "YYYY-MM-DD" local date

  // Staged (pending) due while row is being edited; commit on notes blur / edit end
  pendingDueKey?: string | null;
  pendingDueISO?: string | null;

  notes?: string;
  expanded?: boolean;
};

// ---------------- Local storage helpers ----------------
const LS_KEY = "tasks";
const LS_LAST_CLEAN = "lastCleanupISO";

function loadTasks(): Task[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as Task[]) : [];
  } catch {
    return [];
  }
}
function saveTasks(tasks: Task[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(tasks));
  } catch {}
}
function getLastCleanupISO(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(LS_LAST_CLEAN);
  } catch {
    return null;
  }
}
function setLastCleanupISO(iso: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LS_LAST_CLEAN, iso);
  } catch {}
}

// ---------------- Date helpers ----------------
function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function toISODate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function fmtMDY(d: Date) {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${mm}/${dd}/${yy}`;
}
function weekdayName(d: Date) {
  return d.toLocaleDateString(undefined, { weekday: "long" });
}
function nextMondayFrom(d: Date) {
  const dow = d.getDay(); // 0 Sun .. 6 Sat
  const delta = (1 + 7 - dow) % 7 || 1;
  return addDays(d, delta);
}

function computeKeyForISO(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return "today";
  const today = startOfDay(now);
  const tISO = toISODate(today);
  const tmISO = toISODate(addDays(today, 1));
  const nmISO = toISODate(nextMondayFrom(today));
  if (iso === tISO) return "today";
  if (iso === tmISO) return "tomorrow";
  if (iso === nmISO) return "next-mon";
  return `wd-${iso}`;
}
function computeGroupLabelForISO(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return "No Date";
  const today = startOfDay(now);
  const tISO = toISODate(today);
  const tmISO = toISODate(addDays(today, 1));
  if (iso === tISO) return "Today";
  if (iso === tmISO) return "Tomorrow";
  const nmISO = toISODate(nextMondayFrom(today));
  if (iso === nmISO) return "Next Monday";
  const dt = new Date(iso + "T00:00:00");
  return weekdayName(dt);
}
/** Build list of due choices relative to "now". Labels always include an explicit date. */
function buildDueOptions(now = new Date()) {
  const today = startOfDay(now);
  const dow = today.getDay();
  const opts: { key: string; label: string; iso: string }[] = [];
  // Today
  opts.push({ key: "today", label: `Today (${fmtMDY(today)})`, iso: toISODate(today) });
  // Fri/Sat/Sun → Next Monday only
  if (dow === 5 || dow === 6 || dow === 0) {
    const nm = nextMondayFrom(today);
    opts.push({ key: "next-mon", label: `Next Monday (${fmtMDY(nm)})`, iso: toISODate(nm) });
    return opts;
  }
  // Mon..Thu
  const tomorrow = addDays(today, 1);
  opts.push({ key: "tomorrow", label: `Tomorrow (${fmtMDY(tomorrow)})`, iso: toISODate(tomorrow) });
  let cursor = addDays(today, 2);
  while (cursor.getDay() <= 5) { // up to Fri
    const iso = toISODate(cursor);
    opts.push({ key: `wd-${iso}`, label: `${weekdayName(cursor)} (${fmtMDY(cursor)})`, iso });
    cursor = addDays(cursor, 1);
  }
  const nm = nextMondayFrom(today);
  opts.push({ key: "next-mon", label: `Next Monday (${fmtMDY(nm)})`, iso: toISODate(nm) });
  return opts;
}

// ---------------- Priority sorting ----------------
const priorityRank: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
function sortByPriorityStable(items: Task[], indexMap: Map<string, number>) {
  return [...items].sort((a, b) => {
    const ra = priorityRank[a.priority] ?? 99;
    const rb = priorityRank[b.priority] ?? 99;
    if (ra !== rb) return ra - rb;
    return (indexMap.get(a.id) ?? 0) - (indexMap.get(b.id) ?? 0);
  });
}

// ---------------- Utilities ----------------
function isInteractive(el: HTMLElement | null): boolean {
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || (el as any).isContentEditable;
}
function makeTask(label: string, priority: Priority = "high"): Task {
  return {
    id: crypto.randomUUID(),
    text: label,
    done: false,
    priority,
    dueKey: "today",
    dueISO: toISODate(startOfDay(new Date())),
    pendingDueKey: null,
    pendingDueISO: null,
    notes: "",
    expanded: true,
  };
}

// ---------------- Component ----------------
export default function TodoList() {
  // State
  const [tasks, setTasks] = useState<Task[]>(() => {
    const loaded = loadTasks();
    return loaded.length ? loaded : [makeTask("Example task 1"), makeTask("Example task 2", "medium")];
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const pinnedNewIdRef = useRef<string | null>(null);
  const firstFocus = useRef(false);

  // Persist
  useEffect(() => saveTasks(tasks), [tasks]);

  // One-time cleanup of done tasks from past days
  useEffect(() => {
    const todayIso = toISODate(startOfDay(new Date()));
    const last = getLastCleanupISO();
    if (last !== todayIso) {
      setTasks((prev) =>
        prev.filter((t) => {
          if (!t.done) return true;
          if (!t.dueISO) return true;
          return t.dueISO >= todayIso;
        })
      );
      setLastCleanupISO(todayIso);
    }
  }, []);

  // Midnight tick to prune old dones & refresh labels
  useEffect(() => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(24, 0, 0, 50);
    const ms = next.getTime() - now.getTime();
    const id = setTimeout(() => {
      const todayIso = toISODate(startOfDay(new Date()));
      setTasks((prev) =>
        prev.filter((t) => {
          if (!t.done) return true;
          if (!t.dueISO) return true;
          return t.dueISO >= todayIso;
        })
      );
      setLastCleanupISO(todayIso);
    }, ms);
    return () => clearTimeout(id);
  }, []);

  // First focus row
  useEffect(() => {
    if (firstFocus.current || tasks.length === 0) return;
    firstFocus.current = true;
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-row="${tasks[0].id}"]`);
      el?.focus();
    });
  }, [tasks]);

  // Hotkey "n" → add task (ignored inside inputs)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (isInteractive(target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        addInlineTask();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // Handlers
  const addInlineTask = () => {
    const t = makeTask("New task", "high");
    pinnedNewIdRef.current = t.id;
    setTasks((prev) => [t, ...prev]);
    setEditingId(t.id);
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>(`[data-title-input="${t.id}"]`);
      input?.focus();
      input?.select();
    });
  };

  const endRowEditing = (id: string | null) => {
    setEditingId(id);
    if (!id && pinnedNewIdRef.current) {
      const pinnedId = pinnedNewIdRef.current;
      setTasks((prev) =>
        prev.map((x) => {
          if (x.id !== pinnedId) return x;
          const iso = x.pendingDueISO ?? x.dueISO ?? null;
          const key = computeKeyForISO(iso);
          return {
            ...x,
            dueISO: iso,
            dueKey: key,
            pendingDueISO: null,
            pendingDueKey: null,
          };
        })
      );
      pinnedNewIdRef.current = null;
    }
  };

  const toggleDone = (id: string) =>
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  const remove = (id: string) => setTasks((prev) => prev.filter((t) => t.id !== id));
  const setPriorityFor = (id: string, p: Priority) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, priority: p } : t)));
    pinnedNewIdRef.current = id;
  };
  const stageDueFor = (id: string, key: string) => {
    const opt = buildDueOptions().find((o) => o.key === key) || buildDueOptions()[0];
    setTasks((prev) =>
      prev.map((t) =>
        t.id !== id
          ? t
          : {
              ...t,
              pendingDueKey: opt.key,
              pendingDueISO: opt.iso,
            }
      )
    );
    pinnedNewIdRef.current = id;
  };

  // Derived: groups & ordering
  const groups = useMemo(() => {
    const by: Record<string, Task[]> = {};
    for (const t of tasks) {
      const iso = t.pendingDueISO ?? t.dueISO ?? null;
      const label = computeGroupLabelForISO(iso);
      (by[label] ||= []).push(t);
    }
    return by;
  }, [tasks]);

  const orderLabels = useMemo(() => {
    const fixed = [
      "Today","Tomorrow","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday","Next Monday","No Date",
    ];
    const set = new Set(fixed);
    const dynamic: string[] = [];
    for (const k of Object.keys(groups)) if (!set.has(k)) dynamic.push(k);
    return [...fixed, ...dynamic].filter((k) => groups[k]?.length);
  }, [groups]);

  const indexMap = useMemo(() => {
    const m = new Map<string, number>();
    tasks.forEach((t, i) => m.set(t.id, i));
    return m;
  }, [tasks]);

  return (
    <div className="mx-auto max-w-[1100px] px-6 sm:px-8">
      <div className="mb-3 flex items-center justify-end">
        <GlassButton tone="neutral" onClick={addInlineTask}>+ Add Task</GlassButton>
      </div>

      {orderLabels.map((label) => {
        const items = groups[label] || [];
        let ordered: Task[];
        if (label === "Today") {
          const undone = items.filter((x) => !x.done);
          const done = items.filter((x) => x.done);
          ordered = [...sortByPriorityStable(undone, indexMap), ...sortByPriorityStable(done, indexMap)];
        } else {
          ordered = sortByPriorityStable(items, indexMap);
        }

        // Keep a pinned-new row at top of its group while editing
        const pinned = pinnedNewIdRef.current;
        if (pinned) {
          const hasPinnedHere = items.some((x) => x.id === pinned);
          if (hasPinnedHere) {
            const pinnedRow = items.find((x) => x.id === pinned)!;
            ordered = [pinnedRow, ...ordered.filter((x) => x.id !== pinned)];
          }
        }

        return (
          <DayCard key={label} className="mt-6">
            <div className="mb-2 flex items-center gap-3 text-neutral-800">
              <div className="text-xl font-semibold tracking-tight font-sans">{label}</div>
              <div className="ml-auto text-[11px] font-mono text-neutral-400">High → Low • Undone first (Today)</div>
            </div>

            <ul className="mt-3 space-y-3">
              {ordered.map((t) => (
                <TodoRow
                  key={t.id}
                  t={t}
                  editingId={editingId}
                  onSetEditingId={setEditingId}
                  onRowComplete={() => endRowEditing(null)}
                  onToggleDone={() => toggleDone(t.id)}
                  onRemove={() => remove(t.id)}
                  onSetPriority={(p) => setPriorityFor(t.id, p)}
                  onChangeText={(val) => setTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, text: val } : x)))}
                  onChangeDue={(key) => stageDueFor(t.id, key)}
                />
              ))}
            </ul>
          </DayCard>
        );
      })}
    </div>
  );
}

// ---------------- Row ----------------
function TodoRow({
  t,
  editingId,
  onSetEditingId,
  onRowComplete,
  onToggleDone,
  onRemove,
  onSetPriority,
  onChangeText,
  onChangeDue,
}: {
  t: Task;
  editingId: string | null;
  onSetEditingId: (id: string | null) => void;
  onRowComplete: () => void;
  onToggleDone: () => void;
  onRemove: () => void;
  onSetPriority: (p: Priority) => void;
  onChangeText: (v: string) => void;
  onChangeDue: (key: string) => void;
}) {
  const isEditing = editingId === t.id;
  const dueOpts = buildDueOptions();
  const currentDueKey = t.pendingDueKey ?? t.dueKey ?? computeKeyForISO(t.dueISO);

  return (
    <TodoCard data-row={t.id} tabIndex={0} className="focus:outline-none">
      <div className="space-y-1">
        {/* Row 1: checkbox + title */}
        <div className="flex items-start gap-3">
          <button
            aria-label="toggle done"
            onClick={onToggleDone}
            className={`mt-[2px] h-[18px] w-[18px] rounded-md border transition ${
              t.done ? "bg-neutral-900 border-neutral-900" : "border-neutral-300 hover:border-neutral-400"
            }`}
          />
          <div className="flex-1">
            {isEditing ? (
              <input
                autoFocus
                tabIndex={-1}
                data-title-input={t.id}
                className={`w-full rounded-lg border px-2 py-1 outline-none font-sans text-[15px] ${
                  t.done ? "line-through text-neutral-400" : "text-neutral-900"
                }`}
                value={t.text}
                onChange={(e) => onChangeText(e.target.value)}
                onBlur={() => onSetEditingId(null)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "Escape") onSetEditingId(null);
                }}
              />
            ) : (
              <button
                tabIndex={0}
                className={`w-full text-left text-[15px] font-medium font-sans leading-6 ${
                  t.done ? "line-through text-neutral-400" : "text-neutral-900"
                }`}
                onClick={() => onSetEditingId(t.id)}
                title="Click to edit"
              >
                {t.text || <span className="text-neutral-400">New task</span>}
              </button>
            )}
          </div>
        </div>

        {/* Row 2: Priority dropdown + Due dropdown + actions */}
        <div className="pl-7 flex flex-wrap items-center gap-2 text-[11px]">
          {/* Priority dropdown */}
          <select
            value={t.priority}
            onChange={(e) => onSetPriority(e.target.value as Priority)}
            className={`rounded-md border px-2 py-1 font-mono ${
              t.priority === "high"
                ? "border-red-200 bg-red-50/70 text-red-800"
                : t.priority === "medium"
                ? "border-amber-200 bg-amber-50/70 text-amber-800"
                : "border-neutral-200 bg-white/70 text-neutral-800"
            }`}
            aria-label="Priority"
          >
            <option value="high">high</option>
            <option value="medium">medium</option>
            <option value="low">low</option>
          </select>

          {/* Due dropdown (compact, always visible) */}
          <select
            value={currentDueKey ?? "today"}
            onChange={(e) => onChangeDue(e.target.value)}
            className="rounded-md border px-2 py-1 font-mono border-blue-200 bg-blue-50/70 text-blue-800 min-w-[220px] max-w-full"
            aria-label="Due date"
            title="Set due date"
          >
            {dueOpts.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>

          <div className="ml-auto flex items-center gap-2">
            <GlassButton onClick={() => onSetEditingId(isEditing ? null : t.id)} size="sm" data-action-toggle={t.id}>
              {isEditing ? "Done" : "Edit"}
            </GlassButton>
            <GlassButton
              aria-label="delete"
              onClick={onRemove}
              tone="neutral"
              size="sm"
              className="h-7 w-7 p-0 leading-none"
              title="Delete task"
            >
              ×
            </GlassButton>
          </div>
        </div>

        {/* Notes (auto-resize) */}
        {t.expanded && (
          <NotesEditor
            value={t.notes ?? ""}
            onChangeText={onChangeText}
            taskId={t.id}
            onBlurComplete={onRowComplete}
          />
        )}
      </div>
    </TodoCard>
  );
}

// ---------------- Notes ----------------
function NotesEditor({
  value,
  onChangeText,
  taskId,
  onBlurComplete,
}: {
  value: string;
  onChangeText: (v: string) => void;
  taskId: string;
  onBlurComplete: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <div className="pl-7 mt-2">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChangeText(e.target.value)}
        onInput={(e) => {
          const el = e.currentTarget;
          el.style.height = "auto";
          el.style.height = `${el.scrollHeight}px`;
        }}
        onBlur={onBlurComplete}
        rows={1}
        placeholder="Add notes…"
        className="w-full resize-none overflow-hidden rounded-md border border-neutral-200/60 bg-white/60 px-3 py-2 text-[11px] font-mono leading-[1.4] placeholder:text-neutral-400 focus:border-neutral-300 focus:outline-none focus:ring-0"
      />
    </div>
  );
}