// Minimal, compile-safe TodoList for initial Vercel build
"use client";

import { useState, useRef, useEffect } from "react";
import DayCard from "./ui/DayCard";
import TodoCard from "./ui/TodoCard";
import GlassButton from "./ui/GlassButton";

// --- Types ---
type Priority = "low" | "medium" | "high";
type Task = {
  id: string;
  text: string;
  done: boolean;
  priority: Priority;
  notes?: string;
};

// --- Helpers ---
const LS_KEY = "tasks";
const priorityRank: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

function makeTask(label: string, priority: Priority = "high"): Task {
  return { id: crypto.randomUUID(), text: label, done: false, priority };
}

function isInteractive(el: HTMLElement | null): boolean {
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || (el as any).isContentEditable;
}

function safeParseTasks(raw: unknown): Task[] | null {
  try {
    const arr = JSON.parse(String(raw));
    if (!Array.isArray(arr)) return null;
    // light validation
    return arr
      .map((t) =>
        t && typeof t === "object"
          ? {
              id: String((t as any).id ?? crypto.randomUUID()),
              text: String((t as any).text ?? ""),
              done: Boolean((t as any).done ?? false),
              priority: ((p: any) => (p === "high" || p === "medium" || p === "low" ? p : "high"))(
                (t as any).priority
              ),
            }
          : null
      )
      .filter(Boolean) as Task[];
  } catch {
    return null;
  }
}

// --- Component ---
export default function TodoList() {
  // Initial load from localStorage (fall back to examples)
  const [tasks, setTasks] = useState<Task[]>(() => {
    if (typeof window !== "undefined") {
      const raw = window.localStorage.getItem(LS_KEY);
      const parsed = raw ? safeParseTasks(raw) : null;
      if (parsed && parsed.length) return parsed;
    }
    return [makeTask("Example task 1"), makeTask("Example task 2", "medium")];
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const pinnedIdRef = useRef<string | null>(null); // keep new item at top while editing
  const firstFocus = useRef(false);

  // Persist changes
  useEffect(() => {
    try {
      window.localStorage.setItem(LS_KEY, JSON.stringify(tasks));
    } catch {}
  }, [tasks]);

  // First focus to top row on first paint
  useEffect(() => {
    if (firstFocus.current || tasks.length === 0) return;
    firstFocus.current = true;
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-row="${tasks[0].id}"]`);
      el?.focus();
    });
  }, [tasks]);

  // Global hotkey: "n" to add a task (ignored inside inputs/textareas)
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

  const toggleDone = (id: string) =>
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  const remove = (id: string) => setTasks((prev) => prev.filter((t) => t.id !== id));
  const cyclePriority = (id: string) =>
    setTasks((prev) =>
      prev.map((t) =>
        t.id !== id
          ? t
          : {
              ...t,
              priority: t.priority === "high" ? "medium" : t.priority === "medium" ? "low" : "high",
            }
      )
    );

  const addInlineTask = () => {
    const t = makeTask("New task");
    pinnedIdRef.current = t.id;
    setTasks((prev) => [t, ...prev]);
    setEditingId(t.id);
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>(`[data-title-input="${t.id}"]`);
      input?.focus();
      input?.select();
    });
  };

  // Sort: undone (high→low) first, then done (high→low). Keep pinned at top while editing.
  const baseOrdered = (() => {
    const undone = tasks.filter((t) => !t.done);
    const done = tasks.filter((t) => t.done);
    const sortByPriority = (a: Task, b: Task) => priorityRank[a.priority] - priorityRank[b.priority];
    const ordered = [...undone.sort(sortByPriority), ...done.sort(sortByPriority)];
    const pinned = pinnedIdRef.current;
    if (pinned) {
      const hit = ordered.find((t) => t.id === pinned);
      if (hit) {
        return [hit, ...ordered.filter((t) => t.id !== pinned)];
      }
    }
    return ordered;
  })();

  // When editing finishes on a pinned item, unpin so it falls into sorted order
  const endEditing = (id: string | null) => {
    setEditingId(id);
    if (!id && pinnedIdRef.current) pinnedIdRef.current = null;
  };

  return (
    <div className="mx-auto max-w-[900px] px-4 sm:px-6">
      <div className="mb-3 flex items-center justify-end">
        <GlassButton tone="neutral" onClick={addInlineTask}>
          + Add Task
        </GlassButton>
      </div>

      <DayCard className="mt-4">
        <div className="mb-2 flex items-center gap-3 text-neutral-800">
          <div className="text-xl font-semibold tracking-tight font-sans">Today</div>
          <div className="ml-auto text-[11px] font-mono text-neutral-400">High → Low priority • Undone first</div>
        </div>

        <ul className="mt-3 space-y-3">
          {baseOrdered.map((t) => (
            <TodoRow
              key={t.id}
              t={t}
              editingId={editingId}
              onSetEditingId={endEditing}
              onToggleDone={() => toggleDone(t.id)}
              onRemove={() => remove(t.id)}
              onCyclePriority={() => cyclePriority(t.id)}
              onChangeText={(val) =>
                setTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, text: val } : x)))
              }
            />
          ))}
        </ul>
      </DayCard>
    </div>
  );
}

function TodoRow({
  t,
  editingId,
  onSetEditingId,
  onToggleDone,
  onRemove,
  onCyclePriority,
  onChangeText,
}: {
  t: Task;
  editingId: string | null;
  onSetEditingId: (id: string | null) => void;
  onToggleDone: () => void;
  onRemove: () => void;
  onCyclePriority: () => void;
  onChangeText: (v: string) => void;
}) {
  const isEditing = editingId === t.id;
  return (
    <TodoCard data-row={t.id} tabIndex={0} className="focus:outline-none">
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
        <button
          onClick={onCyclePriority}
          className={`rounded-md border px-2 py-1 text-[11px] font-mono ${
            t.priority === "high"
              ? "border-red-200 bg-red-50/70 text-red-800"
              : t.priority === "medium"
              ? "border-amber-200 bg-amber-50/70 text-amber-800"
              : "border-neutral-200 bg-white/70 text-neutral-800"
          }`}
          title="Cycle priority (high → medium → low)"
        >
          {t.priority}
        </button>
        <button
          aria-label="delete"
          onClick={onRemove}
          className="ml-2 h-7 w-7 rounded-md border border-neutral-200 text-neutral-600"
          title="Delete task"
        >
          ×
        </button>
      </div>
    </TodoCard>
  );
}