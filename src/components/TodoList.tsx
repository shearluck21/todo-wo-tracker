import { useState, useRef, useEffect, useLayoutEffect } from "react";
// Helper to detect interactive form fields
function isInteractive(el: HTMLElement | null): boolean {
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  return (
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    (el as any).isContentEditable
  );
}
import { createPortal } from "react-dom";
import { load, save } from "../lib/storage";
import DayCard from "./ui/DayCard";
import TodoCard from "./ui/TodoCard";
import GlassButton from "./ui/GlassButton";

type Priority = "low" | "medium" | "high";
type Task = {
  id: string;
  text: string;
  done: boolean;
  priority: Priority;
  dueLabel: string;   // "Today" | "Tomorrow" | "Next Monday" | "Wed" etc.
  notes: string; // multiline allowed
  expanded: boolean; // show details on add
};

// === Due date helpers ===
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
  return startOfDay(d).toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function fmtMDY(d: Date) {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${mm}/${dd}/${yy}`;
}

function weekdayName(d: Date) {
  return d.toLocaleDateString(undefined, { weekday: "long" }); // e.g., "Tuesday"
}

/**
 * Build a list of due options:
 * - Always includes Today.
 * - Includes Tomorrow only if it is Mon–Thu; on Fri we skip weekend.
 * - Then includes each next weekday up to Friday.
 * - On Fri/Sat/Sun, only "Next Monday" (plus Today on Fri if needed elsewhere).
 *
 * Returns array of { key, label, iso } where key is a stable string.
 */
function buildDueOptions(now = new Date()) {
  const today = startOfDay(now);
  const dow = today.getDay(); // 0 Sun .. 6 Sat
  const options: { key: string; label: string; iso: string }[] = [];

  // Always include Today
  options.push({ key: "today", label: `Today (${fmtMDY(today)})`, iso: toISODate(today) });

  // If Fri/Sat/Sun => only Next Monday (skip Tomorrow/weekend)
  if (dow === 5 || dow === 6 || dow === 0) {
    const daysUntilMon = (1 + 7 - dow) % 7 || 1;
    const nextMon = addDays(today, daysUntilMon);
    options.push({ key: "next-mon", label: `Next Monday (${fmtMDY(nextMon)})`, iso: toISODate(nextMon) });
    return options;
  }

  // Mon..Thu
  // Tomorrow
  const tomorrow = addDays(today, 1);
  options.push({ key: "tomorrow", label: `Tomorrow (${fmtMDY(tomorrow)})`, iso: toISODate(tomorrow) });

  // Subsequent weekdays up to Friday
  let cursor = addDays(today, 2);
  while (cursor.getDay() <= 5) { // <= Fri (5)
    options.push({
      key: `wd-${toISODate(cursor)}`,
      label: `${weekdayName(cursor)} (${fmtMDY(cursor)})`, // e.g., "Wednesday (10/23/25)"
      iso: toISODate(cursor),
    });
    cursor = addDays(cursor, 1);
  }

  // After Friday, also include Next Monday for convenience
  const daysUntilMon = (1 + 7 - dow) % 7 || 1;
  const nextMon = addDays(today, daysUntilMon);
  options.push({ key: "next-mon", label: `Next Monday (${fmtMDY(nextMon)})`, iso: toISODate(nextMon) });

  return options;
}

/**
 * Compute the next due label (and iso date if needed later).
 * - "today"      -> Today
 * - "tomorrow"   -> Tomorrow
 * - "next"       -> next workday; on Fri/Sat/Sun -> Next Monday
 */
function computeDue(choice: "today" | "tomorrow" | "next", now = new Date()) {
  const today = startOfDay(now);
  const dow = today.getDay(); // 0 Sun ... 6 Sat

  if (choice === "today") {
    return { label: "Today", iso: toISODate(today) };
  }
  if (choice === "tomorrow") {
    const tmr = addDays(today, 1);
    return { label: "Tomorrow", iso: toISODate(tmr) };
  }

  // choice === "next"
  if (dow === 5 || dow === 6 || dow === 0) {
    // Fri/Sat/Sun -> Next Monday
    const daysUntilMon = (1 + 7 - dow) % 7 || 1;
    const nextMon = addDays(today, daysUntilMon);
    return { label: "Next Monday", iso: toISODate(nextMon) };
  }
  // Mon..Thu -> next calendar day (weekday)
  const nextDay = addDays(today, 1);
  return { label: weekdayName(nextDay), iso: toISODate(nextDay) };
}

export default function TodoList() {
  const [tasks, setTasks] = useState<Task[]>(() => load<Task[]>("tasks", []));
  const [text, setText] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const dueOptions = buildDueOptions();
  const [dueChoice, setDueChoice] = useState<string>(dueOptions[0].key); // default to first option (Today)
  const inputRef = useRef<HTMLInputElement>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const didInitFocus = useRef(false);

  // live refs so the single global key handler always sees latest state
  const tasksRef = useRef(tasks);
  const focusedIdRef = useRef<string | null>(null);
  const editingIdRef = useRef<string | null>(null);
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);
  useEffect(() => { focusedIdRef.current = focusedId; }, [focusedId]);
  useEffect(() => { editingIdRef.current = editingId; }, [editingId]);

  // Focus the title of a given task id; enters edit mode by default
  function focusTitle(id: string, edit = true) {
    if (edit) setEditingId(id);
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>(`[data-title-input="${id}"]`);
      if (input) { input.focus(); input.select(); return; }
      const btn = document.querySelector<HTMLButtonElement>(`[data-title-button="${id}"]`);
      btn?.focus();
    });
  }

  // Focus the entire row wrapper (not the input). Used by Arrow Up/Down.
  function focusRow(id: string) {
    requestAnimationFrame(() => {
      const row = document.querySelector<HTMLElement>(`[data-row="${id}"]`);
      row?.focus();
    });
  }

  function baseDueLabel(label: string) {
    return label.replace(/\s*\(.*\)$/, "");
  }
  function nextPriority(p: Priority): Priority {
    return p === "medium" ? "high" : p === "high" ? "low" : "medium";
  }

  function normalize(s: string) {
    return s.replace(/\s+/g, " ").trim();
  }

  function validate(label: string) {
    if (!label) return "Task cannot be empty.";
    if (label.length > 200) return "Keep tasks under 200 characters.";
    return null;
  }

  function makeTask(label: string, p: Priority, n: string, dueLabel: string): Task {
    return {
      id: crypto.randomUUID(),
      text: label,
      done: false,
      priority: p,
      dueLabel,
      notes: n,
      expanded: true,
    };
  }

  function resetForm() {
    setText("");
    setPriority("medium");
    setNotes("");
    setDueChoice(buildDueOptions()[0].key);
    setError(null);
    // focus back to the main input for fast entry
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function addTask() {
    const label = normalize(text);
    const err = validate(label);
    if (err) {
      setError(err);
      return;
    }
    const selected = buildDueOptions().find(o => o.key === dueChoice) ?? dueOptions[0];
    const t = makeTask(label, priority, notes, selected.label);
    setTasks((prev) => [t, ...prev]);
    resetForm();
  }

  // Add a blank task inline (used by the top header button)
  function addInlineTask(focusAfter = false) {
    const todayOpt = buildDueOptions()[0];
    const t = makeTask("New task", "medium", "", todayOpt.label);
    setTasks((prev) => [t, ...prev]);
    // immediately put the new row into title-editing mode
    setEditingId(t.id);

    if (focusAfter) {
      // wait until input mounts then focus/select it
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLInputElement>(
          `[data-title-input="${t.id}"]`
        );
        el?.focus();
        el?.select();
      });
    }
  }

  function toggleDone(id: string) {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t))
    );
  }

  function toggleExpanded(id: string) {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, expanded: !t.expanded } : t))
    );
  }

  function remove(id: string) {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }

  // Render notes preserving bullets/line breaks
  function NotesView({ value }: { value: string }) {
    if (!value.trim()) return null;
    // If user typed bullets, keep them; otherwise just show paragraphs with line breaks.
    const lines = value.split(/\r?\n/);
    const looksLikeList = lines.some((l) => /^\s*([-*]|\d+\.)\s+/.test(l));
    if (looksLikeList) {
      return (
        <ul className="list-disc pl-5 space-y-1 whitespace-pre-wrap">
          {lines.map((l, i) => (
            <li key={i}>{l.replace(/^\s*([-*]|\d+\.)\s+/, "")}</li>
          ))}
        </ul>
      );
    }
    return <p className="whitespace-pre-wrap">{value}</p>;
  }

  // Listen for global add requests from the header button
  useEffect(() => {
    const handler = () => addInlineTask();
    window.addEventListener("add-task", handler);
    return () => window.removeEventListener("add-task", handler);
  }, []);

  // Shared hotkey handler for global and local keydown events
  const handleHotkey = (e: any) => {
    const target = e.target as HTMLElement | null;
    if (isInteractive(target) || e.metaKey || e.ctrlKey || e.altKey) return;

    const tasks = tasksRef.current;
    const focusedId = focusedIdRef.current;
    const editingId = editingIdRef.current;

    // helper: ordered id list in the same order as render
    const orderedIds = () => {
      const order = ['Today','Tomorrow','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday','Next Monday','No Date'];
      const known = new Set(order);
      const by: Record<string, Task[]> = {} as any;
      for (const t of tasks) {
        const k = baseDueLabel(t.dueLabel) || 'No Date';
        (by[k] ||= []).push(t);
      }
      const dynamic = Object.keys(by).filter((k) => !known.has(k));
      const labels = [...order, ...dynamic].filter((k) => by[k]?.length);
      const ids: string[] = [];
      labels.forEach((label) => by[label].forEach((t) => ids.push(t.id)));
      return ids;
    };

    const clickFallback = (label: 'wo' | 'tasks') => {
      const byData = document.querySelector<HTMLButtonElement>(`button[data-view="${label}"]`);
      if (byData) { byData.click(); return; }
      const want = label === 'wo' ? /work\s*orders/i : /to-\s*do|todos?/i;
      const btns = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
      btns.find(b => want.test(b.textContent || ''))?.click();
    };

    const switchView = (label: 'wo' | 'tasks') => {
      // 1) Try data-view button immediately
      const btn = document.querySelector<HTMLElement>(`[data-view="${label}"]`);
      if (btn) { btn.click(); return true; }

      // 2) Try common aria-labels / roles
      const aria = label === 'wo' ? /work\s*orders/i : /to-?\s*do|todos?/i;
      const candidates = Array.from(document.querySelectorAll<HTMLElement>('[role="tab"],button,[aria-label]'));
      const hit = candidates.find(el => aria.test(el.getAttribute('aria-label') || el.textContent || ''));
      if (hit) { hit.click(); return true; }

      // 3) Fallback: our previous text scan of all buttons
      clickFallback(label);

      // 4) Last-ditch: set URL hash and fire hashchange (in case App listens)
      try {
        const want = label === 'wo' ? '#view=wo' : '#view=tasks';
        if (location.hash !== want) {
          location.hash = want;
          window.dispatchEvent(new HashChangeEvent('hashchange'));
        }
      } catch {}

      // 5) Retry once on next tick in case header mounts late
      setTimeout(() => {
        const b2 = document.querySelector<HTMLElement>(`[data-view="${label}"]`);
        if (b2) b2.click();
      }, 0);
      return false;
    };

    // ---- Hotkeys ----
    if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      e.stopPropagation?.();
      // quick add inline and focus title
      const todayOpt = buildDueOptions()[0];
      const t = makeTask('New task', 'medium', '', todayOpt.label);
      setTasks((prev) => [t, ...prev]);
      setEditingId(t.id);
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLInputElement>(`[data-title-input="${t.id}"]`);
        el?.focus();
        el?.select();
      });
      return;
    }

    if (e.key === 't' || e.key === 'T') {
      e.preventDefault();
      e.stopPropagation?.();
      switchView('wo');
      try { window.dispatchEvent(new CustomEvent('app:set-view', { detail: 'wo' })); } catch {}
      try { document.dispatchEvent(new CustomEvent('app:set-view', { detail: 'wo' })); } catch {}
      return;
    }
    if (e.key === 'w' || e.key === 'W') {
      e.preventDefault();
      e.stopPropagation?.();
      switchView('tasks');
      try { window.dispatchEvent(new CustomEvent('app:set-view', { detail: 'tasks' })); } catch {}
      try { document.dispatchEvent(new CustomEvent('app:set-view', { detail: 'tasks' })); } catch {}
      return;
    }

    if (e.key === 'd' || e.key === 'D') {
      e.preventDefault();
      e.stopPropagation?.();
      const id = focusedId ?? tasks[0]?.id;
      if (!id) return;
      if (e.shiftKey) {
        // delete
        setTasks((prev) => prev.filter((t) => t.id !== id));
      } else {
        // toggle done
        setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
        if (!focusedId) setFocusedId(id);
      }
      return;
    }

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation?.();
      const ids = orderedIds();
      if (!ids.length) return;
      const cur = focusedId && ids.includes(focusedId)
        ? focusedId
        : editingId && ids.includes(editingId)
        ? editingId
        : ids[0];
      const i = ids.indexOf(cur);
      const nextIndex = e.key === 'ArrowDown' ? Math.min(i + 1, ids.length - 1) : Math.max(i - 1, 0);
      const nextId = ids[nextIndex];
      if (!nextId) return;
      setEditingId(null);
      setFocusedId(nextId);
      requestAnimationFrame(() => {
        const row = document.querySelector<HTMLElement>(`[data-row="${nextId}"]`);
        row?.focus();
        row?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
      return;
    }
  };

  // Register handleHotkey on window and document in both capture and bubble
  useEffect(() => {
    const h = (e: KeyboardEvent) => handleHotkey(e);
    window.addEventListener('keydown', h, true);     // capture
    window.addEventListener('keydown', h, false);    // bubble
    document.addEventListener('keydown', h, true);   // capture
    document.addEventListener('keydown', h, false);  // bubble
    return () => {
      window.removeEventListener('keydown', h, true);
      window.removeEventListener('keydown', h, false);
      document.removeEventListener('keydown', h, true);
      document.removeEventListener('keydown', h, false);
    };
  }, []);

  useEffect(() => {
    save("tasks", tasks);
  }, [tasks]);

  // On initial load, force-select the first *rendered* task (topmost in UI order)
  useEffect(() => {
    if (didInitFocus.current) return;
    if (tasks.length === 0) return;

    // Build the same grouping and order used in render
    const order = [
      'Today','Tomorrow','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday','Next Monday','No Date',
    ];
    const known = new Set(order);
    const by: Record<string, Task[]> = {} as any;
    for (const t of tasks) {
      const k = baseDueLabel(t.dueLabel) || 'No Date';
      (by[k] ||= []).push(t);
    }
    const dynamic = Object.keys(by).filter((k) => !known.has(k));
    const labels = [...order, ...dynamic].filter((k) => by[k]?.length);
    if (!labels.length) return;

    didInitFocus.current = true;
    const firstLabel = labels[0];
    const firstTask = by[firstLabel][0];
    const firstId = firstTask.id;

    setFocusedId(firstId);
    requestAnimationFrame(() => {
      const row = document.querySelector<HTMLElement>(`[data-row="${firstId}"]`);
      row?.focus();
      row?.scrollIntoView({ block: 'nearest' });
    });
  }, [tasks]);

  return (
    <div
      data-todo-root
      tabIndex={-1}
      className="mx-auto max-w-[1100px] px-6 sm:px-8"
      onKeyDownCapture={(e) => handleHotkey(e as any)}
    >
      {/* Local toolbar (mobile-friendly) */}
      <div className="mb-3 flex items-center justify-end">
        <GlassButton
          tone="neutral"
          onClick={() => window.dispatchEvent(new Event("add-task"))}
        >
          + Add Task
        </GlassButton>
      </div>
      {/* Input form (hidden) */}
      {false && (
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="flex gap-2">
            <input id="task-input" ref={inputRef}
              className="flex-1 h-11 rounded-xl border border-neutral-300 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-neutral-900/10"
              placeholder="Add a task…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTask();
                }
              }}
            />
            {/* Due selector (dynamic up to Friday, then Next Monday) */}
            <select
              className="h-11 rounded-xl border border-neutral-300 bg-white px-3 text-sm"
              value={dueChoice}
              onChange={(e) => setDueChoice(e.target.value)}
              aria-label="Due"
              title="Due"
            >
              {buildDueOptions().map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
            {/* Priority selector */}
            <select
              className="h-11 rounded-xl border border-neutral-300 bg-white px-3 text-sm"
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
              aria-label="Priority"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
            <button
              className="h-11 rounded-xl px-4 bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800"
              onClick={addTask}
            >
              Add
            </button>
          </div>
          <textarea
            className="mt-3 w-full min-h-[88px] rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-900/10"
            placeholder="Notes (bullets supported: '-', '*', or '1. ...')"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          {error && <div className="mt-2 text-sm text-red-600">{error}</div>}
        </div>
      )}

      {/* Day groups (frosted cards) */}
      {(() => {
        const order = [
          "Today",
          "Tomorrow",
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
          "Saturday",
          "Sunday",
          "Next Monday",
          "No Date",
        ];
        const known = new Set(order);

        // Group by base label (strip date suffix like " (10/23/25)")
        const by: Record<string, Task[]> = {};
        for (const t of tasks) {
          const k = baseDueLabel(t.dueLabel) || "No Date";
          (by[k] ||= []).push(t);
        }

        // Preserve explicit order; include any unknown labels at the end
        const dynamic = Object.keys(by).filter((k) => !known.has(k));
        const labels = [...order, ...dynamic].filter((k) => by[k]?.length);

        return labels.map((label) => (
          <DayCard key={label} className="mt-6">
            {/* Day header */}
            <div className="mb-2 flex items-center gap-3 text-neutral-800">
              <div className="text-xl font-semibold tracking-tight font-sans">{label}</div>
              <div className="ml-auto text-[11px] font-mono text-neutral-400">Oldest at top</div>
            </div>

            {/* List */}
            <ul className="mt-3 space-y-3">
              {by[label].map((t) => (
                <TodoRow
                    key={t.id}
                    t={t}
                    editingId={editingId}
                    focusedId={focusedId}
                    setFocusedId={setFocusedId}
                    onSetEditingId={setEditingId}
                  onToggleDone={() => toggleDone(t.id)}
                  onChangeText={(val) =>
                    setTasks((prev) =>
                      prev.map((x) => (x.id === t.id ? { ...x, text: val } : x))
                    )
                  }
                  onCyclePriority={() =>
                    setTasks((prev) =>
                      prev.map((x) =>
                        x.id === t.id ? { ...x, priority: nextPriority(x.priority) } : x
                      )
                    )
                  }
                  onSetPriority={(p) =>
                    setTasks((prev) =>
                      prev.map((x) => (x.id === t.id ? { ...x, priority: p } : x))
                    )
                  }
                  onChangeDue={(key) => {
                    const opt =
                      buildDueOptions().find((o) => o.key === key) || buildDueOptions()[0];
                    setTasks((prev) =>
                      prev.map((x) =>
                        x.id === t.id ? { ...x, dueLabel: opt.label } : x
                      )
                    );
                  }}
                  onChangeNotes={(val) =>
                    setTasks((prev) =>
                      prev.map((x) => (x.id === t.id ? { ...x, notes: val } : x))
                    )
                  }
                  onToggleExpanded={() => toggleExpanded(t.id)}
                  onRemove={() => remove(t.id)}
                />
              ))}
            </ul>
          </DayCard>
        ));
      })()}
    </div>
  );
}
// Auto-resize helper for notes textarea
function useAutosizeTextArea(ref: React.RefObject<HTMLTextAreaElement>, value: string) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [ref, value]);
}
// Inline popover select that opens on focus and lets you confirm with Enter
function InlineSelect({
  value,
  options,
  onChange,
  className = "",
  buttonClass = "",
  onEscapeFocusRow,
  nextFocusQuery,
  prevFocusQuery,
}: {
  value: string; // current option key
  options: { key: string; label: string; className?: string }[];
  onChange: (key: string) => void;
  className?: string;
  buttonClass?: string;
  onEscapeFocusRow?: () => void;
  nextFocusQuery?: string;
  prevFocusQuery?: string;
}) {
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [pos, setPos] = useState<{top:number; left:number; width:number}>({ top: 0, left: 0, width: 0 });
  const skipOpenRef = useRef(false);

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
    const idx = Math.max(0, options.findIndex((o) => o.key === value));
    setHighlight(idx);
  }, [open, value, options]);

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
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  const current = options.find((o) => o.key === value) || options[0];

  return (
    <div className={["relative z-30", className].join(" ")}>
      <button
        ref={btnRef}
        type="button"
        className={buttonClass}
        onFocus={() => {
          // Guard: if we just closed via Enter/Tab selection, don't auto-open on focus bounce.
          if (skipOpenRef.current) {
            skipOpenRef.current = false;
            return;
          }
          // open on focus and jump to top
          setOpen(true);
          setHighlight(0);
          updatePos();
        }}
        onMouseDown={(e) => {
          // Open on mouse down to avoid focus→click toggle race.
          e.preventDefault(); // keep focus on the button
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
            setHighlight((h) => (h + 1) % options.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => (h - 1 + options.length) % options.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            const opt = options[highlight] || options[0];
            onChange(opt.key);
            setOpen(false);
            // prevent immediate re-open on focus; restore focus to button
            skipOpenRef.current = true;
            requestAnimationFrame(() => btnRef.current?.focus());
          } else if (e.key === "Tab") {
            const lastIndex = options.length - 1;
            const atEndForward = !e.shiftKey && highlight >= lastIndex;
            const atEndBackward = e.shiftKey && highlight <= 0;

            if (atEndForward || atEndBackward) {
              // Confirm current option and move focus to the next/prev target if provided
              const opt = options[highlight] || options[0];
              onChange(opt.key);
              setOpen(false);
              skipOpenRef.current = true; // avoid immediate re-open

              const selector = atEndForward ? nextFocusQuery : prevFocusQuery;
              if (selector) {
                requestAnimationFrame(() => {
                  const el = document.querySelector(selector) as HTMLElement | null;
                  el?.focus();
                });
                e.preventDefault(); // we managed focus ourselves
              } else {
                // No explicit target; allow native tab to proceed
                // Do not preventDefault in this branch
              }
            } else {
              // Keep tabbing within the menu
              e.preventDefault();
              setHighlight((h) => {
                const delta = e.shiftKey ? -1 : 1;
                const next = h + delta;
                return Math.min(Math.max(next, 0), lastIndex);
              });
            }
          } else if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
            skipOpenRef.current = true;
            // Instead of focusing button, call onEscapeFocusRow if provided
            if (onEscapeFocusRow) {
              onEscapeFocusRow();
            }
            // (do not focus btnRef)
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-popover-button
      >
        {current?.label}
        <span className="ml-1 text-[12px] text-neutral-600">▾</span>
      </button>

      {open && createPortal(
        <div
          ref={listRef}
          role="listbox"
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 1000 }}
          className="overflow-hidden rounded-md border border-neutral-200/70 bg-white/95 backdrop-blur-md shadow-lg ring-1 ring-black/5"
        >
          {options.map((opt, i) => (
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
// --- TodoRow component ---
type TodoRowProps = {
  t: Task;
  editingId: string | null;

  // selection focus for the ring + keyboard nav
  focusedId: string | null;
  setFocusedId: (id: string | null) => void;

  onSetEditingId: (id: string | null) => void;
  onToggleDone: () => void;
  onChangeText: (val: string) => void;
  onChangeNotes: (val: string) => void;

  onCyclePriority: () => void;
  onSetPriority: (p: Priority) => void;
  onChangeDue: (key: string) => void;

  onToggleExpanded: () => void;
  onRemove: () => void;
};

function TodoRow({
  t,
  editingId,
  focusedId,
  setFocusedId,
  onSetEditingId,
  onToggleDone,
  onChangeText,
  onCyclePriority,
  onChangeDue,
  onToggleExpanded,
  onChangeNotes,
  onRemove,
  onSetPriority,
  
}: TodoRowProps) {
  // Build due options once per render for this row
  const dueOpts = buildDueOptions();
  return (
    <TodoCard
      data-row={t.id}
      tabIndex={0}
      onFocus={() => setFocusedId(t.id)}
      onKeyDown={(e) => {
        // Only handle when the row wrapper itself has focus (not inner inputs)
        if (e.currentTarget !== e.target) return;

        // Enter/Space: begin editing title
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSetEditingId(t.id);
          requestAnimationFrame(() => {
            const el = document.querySelector<HTMLInputElement>(`[data-title-input="${t.id}"]`);
            el?.focus();
            el?.select();
          });
          return;
        }

        // Tab from a focused row: jump into the title first (so title is always the first stop)
        if (e.key === "Tab") {
          e.preventDefault();
          onSetEditingId(t.id);
          requestAnimationFrame(() => {
            const el = document.querySelector<HTMLInputElement>(`[data-title-input="${t.id}"]`);
            el?.focus();
            el?.select();
          });
          return;
        }
      }}
      className={[
        focusedId === t.id ? "ring-2 ring-neutral-900/15" : "ring-0",
        "focus:outline-none"
      ].join(" ")}
    >
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
            {editingId === t.id ? (
              <input
                autoFocus
                tabIndex={-1}
                data-title-input={t.id}
                onFocus={() => setFocusedId(t.id)}
                className={`w-full rounded-lg border px-2 py-1 outline-none font-sans text-[15px] ${
                  t.done ? "line-through text-neutral-400" : "text-neutral-900"
                }`}
                value={t.text}
                onChange={(e) => onChangeText(e.target.value)}
                onBlur={() => onSetEditingId(null)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "Escape") {
                    onSetEditingId(null);
                    // After closing edit mode, focus row in next frame
                    requestAnimationFrame(() => {
                      const row = document.querySelector<HTMLElement>(`[data-row="${t.id}"]`);
                      row?.focus();
                    });
                  }
                }}
              />
            ) : (
              <button
                tabIndex={0}
                data-title-button={t.id}
                className={`w-full text-left text-[15px] font-medium font-sans leading-6 ${
                  t.done ? "line-through text-neutral-400" : "text-neutral-900"
                }`}
                onClick={() => onSetEditingId(t.id)}
                onFocus={() => setFocusedId(t.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSetEditingId(t.id);
                  }
                }}
                title="Click to edit"
              >
                {t.text || <span className="text-neutral-400">New task</span>}
              </button>
            )}
          </div>
        </div>

        {/* Row 2: priority + due, with actions on the right */}
        <div className="pl-7 flex items-center gap-2 text-[11px]">
          <div className="relative inline-flex items-center">
            <InlineSelect
              value={t.priority}
              onChange={(key) => onSetPriority(key as Priority)}
              options={[
                { key: "low", label: "low", className: "text-neutral-800" },
                { key: "medium", label: "medium", className: "text-amber-800" },
                { key: "high", label: "high", className: "text-red-800" },
              ]}
              buttonClass={[
                "rounded-md border pr-6 pl-3 py-1.5 text-[11px] font-mono leading-none",
                "backdrop-blur-md supports-[backdrop-filter]:backdrop-blur-md",
                "shadow-xs ring-1 ring-black/5",
                t.priority === "high"
                  ? "border-red-200 bg-red-50/70 text-red-800"
                  : t.priority === "medium"
                  ? "border-amber-200 bg-amber-50/70 text-amber-800"
                  : "border-neutral-200 bg-white/70 text-neutral-800",
                "focus:outline-none focus:ring-0",
                "data-priority-btn-" + t.id,
              ].join(" ")}
              onEscapeFocusRow={() => {
                onSetEditingId(null);
                requestAnimationFrame(() => {
                  const row = document.querySelector<HTMLElement>(`[data-row="${t.id}"]`);
                  row?.focus();
                });
              }}
              nextFocusQuery={`[data-due-btn="${t.id}"]`}
            />
          </div>

          <div className="relative inline-flex items-center">
            <InlineSelect
              value={(dueOpts.find((o) => o.label === t.dueLabel)?.key || dueOpts[0].key)}
              onChange={(key) => onChangeDue(key)}
              options={dueOpts.map((o) => ({ key: o.key, label: o.label }))}
              buttonClass={[
                "rounded-md border pr-6 pl-3 py-1.5 text-[11px] font-mono leading-none",
                "backdrop-blur-md supports-[backdrop-filter]:backdrop-blur-md",
                "shadow-xs ring-1 ring-black/5",
                "border-blue-200 bg-blue-50/70 text-blue-800",
                "focus:outline-none focus:ring-0",
                "data-due-btn-" + t.id,
              ].join(" ")}
              onEscapeFocusRow={() => {
                onSetEditingId(null);
                requestAnimationFrame(() => {
                  const row = document.querySelector<HTMLElement>(`[data-row="${t.id}"]`);
                  row?.focus();
                });
              }}
              nextFocusQuery={`[data-action-toggle="${t.id}"]`}
            />
          </div>

          <div className="ml-auto flex items-center gap-2">
            <GlassButton onClick={onToggleExpanded} size="sm" data-action-toggle={t.id}>
              {t.expanded ? "Hide" : "Show"}
            </GlassButton>
            <GlassButton aria-label="delete" onClick={onRemove} tone="neutral" size="sm" className="h-7 w-7 p-0 leading-none">
              ×
            </GlassButton>
          </div>
        </div>

        {/* Row 3: notes (auto-expands) */}
        {t.expanded && (
          <NotesEditor
            value={t.notes}
            onChange={onChangeNotes}
            onEscapeFocusRow={() => {
              onSetEditingId(null);
              requestAnimationFrame(() => {
                const row = document.querySelector<HTMLElement>(`[data-row="${t.id}"]`);
                row?.focus();
              });
            }}
          />
        )}
      </div>
    </TodoCard>
  );
}

function NotesEditor({
  value,
  onChange,
  onEscapeFocusRow,
}: {
  value: string;
  onChange: (v: string) => void;
  onEscapeFocusRow?: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useAutosizeTextArea(ref, value);
  return (
    <div className="pl-7 mt-2">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onInput={(e) => {
          const el = e.currentTarget;
          el.style.height = "auto";
          el.style.height = `${el.scrollHeight}px`;
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            onEscapeFocusRow?.();
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        rows={1}
        placeholder="Add notes…"
        className="w-full resize-none overflow-hidden rounded-md border border-neutral-200/60 bg-white/60 px-3 py-2 text-[11px] font-mono leading-[1.4] placeholder:text-neutral-400 focus:border-neutral-300 focus:outline-none focus:ring-0"
      />
    </div>
  );
}