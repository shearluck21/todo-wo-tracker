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
  // Stable due fields
  dueKey?: string | null;   // "today" | "tomorrow" | "next-mon" | "wd-YYYY-MM-DD"
  dueISO?: string | null;   // local "YYYY-MM-DD"
  // Staged (pending) due change while editing; commit on unpin
  pendingDueKey?: string | null;
  pendingDueISO?: string | null;
  // Legacy (for migration)
  dueLabel?: string;
  notes: string;
  expanded: boolean;
};

// Priority ordering helper: High, Medium, Low
const priorityRank: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
function sortByPriorityStable(items: Task[], indexMap: Map<string, number>) {
  // Stable sort: by priority rank, then by original render/index order
  return [...items].sort((a, b) => {
    const pa = priorityRank[a.priority] ?? 99;
    const pb = priorityRank[b.priority] ?? 99;
    if (pa !== pb) return pa - pb;
    return (indexMap.get(a.id) ?? 0) - (indexMap.get(b.id) ?? 0);
  });
}

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
  const dow = d.getDay();
  const daysUntilMon = (1 + 7 - dow) % 7 || 1;
  return addDays(d, daysUntilMon);
}
function computeGroupLabelForISO(iso: string | null | undefined, now = new Date()) {
  if (!iso) return "No Date";
  const today = startOfDay(now);
  const todayISO = toISODate(today);
  const tomorrowISO = toISODate(addDays(today, 1));
  if (iso === todayISO) return "Today";
  if (iso === tomorrowISO) return "Tomorrow";
  const nmISO = toISODate(nextMondayFrom(today));
  if (iso === nmISO) return "Next Monday";
  const dt = new Date(iso + "T00:00:00");
  return weekdayName(dt);
}

function computeKeyForISO(iso: string | null | undefined, now = new Date()) {
  if (!iso) return "today"; // safe default
  const today = startOfDay(now);
  const todayISO = toISODate(today);
  const tomorrowISO = toISODate(addDays(today, 1));
  const nextMonISO = toISODate(nextMondayFrom(today));
  if (iso === todayISO) return "today";
  if (iso === tomorrowISO) return "tomorrow";
  if (iso === nextMonISO) return "next-mon";
  return `wd-${iso}`;
}
function deriveDueFromKey(key: string, now = new Date()) {
  const today = startOfDay(now);
  if (key === "today") return { key, iso: toISODate(today) };
  if (key === "tomorrow") return { key, iso: toISODate(addDays(today, 1)) };
  if (key === "next-mon") return { key, iso: toISODate(nextMondayFrom(today)) };
  if (key.startsWith("wd-")) return { key, iso: key.slice(3) };
  return { key: "today", iso: toISODate(today) };
}
/**
 * Build a list of due options (labels always include a date suffix):
 * Today; (Mon–Thu) Tomorrow + subsequent weekdays to Fri; (Fri–Sun) Next Monday
 */
function buildDueOptions(now = new Date()) {
  const today = startOfDay(now);
  const dow = today.getDay(); // 0 Sun .. 6 Sat
  const options: { key: string; label: string; iso: string }[] = [];

  // Always include Today
  options.push({ key: "today", label: `Today (${fmtMDY(today)})`, iso: toISODate(today) });

  // If Fri/Sat/Sun => only Next Monday (skip weekend)
  if (dow === 5 || dow === 6 || dow === 0) {
    const nextMon = nextMondayFrom(today);
    options.push({ key: "next-mon", label: `Next Monday (${fmtMDY(nextMon)})`, iso: toISODate(nextMon) });
    return options;
  }

  // Mon..Thu
  const tomorrow = addDays(today, 1);
  options.push({ key: "tomorrow", label: `Tomorrow (${fmtMDY(tomorrow)})`, iso: toISODate(tomorrow) });

  let cursor = addDays(today, 2);
  while (cursor.getDay() <= 5) { // up to Fri
    options.push({
      key: `wd-${toISODate(cursor)}`,
      label: `${weekdayName(cursor)} (${fmtMDY(cursor)})`,
      iso: toISODate(cursor),
    });
    cursor = addDays(cursor, 1);
  }

  const nextMon = nextMondayFrom(today);
  options.push({ key: "next-mon", label: `Next Monday (${fmtMDY(nextMon)})`, iso: toISODate(nextMon) });
  return options;
}

export default function TodoList() {
  const [tasks, setTasks] = useState<Task[]>(() => {
    const raw = load<any[]>("tasks", []) || [];
    const today = startOfDay(new Date());
    const migrated: Task[] = raw.map((t: any) => {
      const nt: Task = { ...t };
      if (nt.dueKey || nt.dueISO) return nt;
      // Try to parse from legacy dueLabel "(MM/DD/YY)"
      let iso: string | null = null;
      const base = typeof nt.dueLabel === "string" ? nt.dueLabel.replace(/\s*\(.*\)$/, "") : null;
      const m = typeof nt.dueLabel === "string" ? nt.dueLabel.match(/(\d{2})\/(\d{2})\/(\d{2})/) : null;
      if (m) {
        const mm = parseInt(m[1], 10);
        const dd = parseInt(m[2], 10);
        const yy = parseInt(m[3], 10);
        const fullYear = 2000 + yy;
        iso = `${fullYear}-${String(mm).padStart(2,"0")}-${String(dd).padStart(2,"0")}`;
      } else if (base === "Today") {
        iso = toISODate(today);
      } else if (base === "Tomorrow") {
        iso = toISODate(addDays(today, 1));
      } else if (base === "Next Monday") {
        iso = toISODate(nextMondayFrom(today));
      } else {
        iso = null;
      }
      nt.dueISO = iso;
      if (iso) {
        if (iso === toISODate(today)) nt.dueKey = "today";
        else if (iso === toISODate(addDays(today, 1))) nt.dueKey = "tomorrow";
        else if (iso === toISODate(nextMondayFrom(today))) nt.dueKey = "next-mon";
        else nt.dueKey = `wd-${iso}`;
      } else {
        nt.dueKey = null;
      }
      return nt;
    });
    return migrated;
  });

  const [text, setText] = useState("");
  const [priority, setPriority] = useState<Priority>("high");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const dueOptions = buildDueOptions();
  const [dueChoice, setDueChoice] = useState<string>(dueOptions[0].key);
  const inputRef = useRef<HTMLInputElement>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  // Keep a newly-created task at the top of its group while editing
  const [pinnedNewId, setPinnedNewId] = useState<string | null>(null);
  const didInitFocus = useRef(false);
  const [, forceTick] = useState(0);

  // Delete tasks that were completed on or before yesterday (i.e., any done task with a due date before today)
  function cleanupDoneBeforeToday() {
    const todayIso = toISODate(startOfDay(new Date()));
    setTasks((prev: Task[]) =>
      prev.filter((t: Task) => {
        if (!t.done) return true;
        if (!t.dueISO) return true; // don't auto-delete undated items
        return t.dueISO >= todayIso; // keep today/future; drop past
      })
    );
    save("lastCleanupISO", todayIso);
  }

  // live refs for hotkeys
  const tasksRef = useRef(tasks);
  const focusedIdRef = useRef<string | null>(null);
  const editingIdRef = useRef<string | null>(null);
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);
  useEffect(() => { focusedIdRef.current = focusedId; }, [focusedId]);
  useEffect(() => { editingIdRef.current = editingId; }, [editingId]);

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
    setPriority("high");
    setNotes("");
    setDueChoice(buildDueOptions()[0].key);
    setError(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }
  function addTask() {
    const label = normalize(text);
    const err = validate(label);
    if (err) {
      setError(err);
      return;
    }
  }

  // Add a blank task inline
  function addInlineTask(focusAfter = false) {
    const todayOpt = buildDueOptions()[0];
    const t = makeTask("New task", "high", "", todayOpt.label);
    // set stable fields
    t.dueKey = todayOpt.key;
    t.dueISO = todayOpt.iso;
    t.pendingDueKey = null;
    t.pendingDueISO = null;
    setPinnedNewId(t.id);

    setTasks((prev: Task[]) => [t, ...prev]);
    setEditingId(t.id);

    if (focusAfter) {
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLInputElement>(`[data-title-input="${t.id}"]`);
        el?.focus();
        el?.select();
      });
    }
  }

  function toggleDone(id: string) {
    setTasks((prev: Task[]) =>
      prev.map((t: Task) => (t.id === id ? { ...t, done: !t.done } : t))
    );
  }
  function toggleExpanded(id: string) {
    setTasks((prev: Task[]) =>
      prev.map((t: Task) => (t.id === id ? { ...t, expanded: !t.expanded } : t))
    );
  }
  function remove(id: string) {
    setTasks((prev: Task[]) => prev.filter((t: Task) => t.id !== id));
  }

  // Listen for global add requests from the header button
  useEffect(() => {
    const handler = () => addInlineTask();
    window.addEventListener("add-task", handler);
    return () => window.removeEventListener("add-task", handler);
  }, []);

  // Shared hotkey handler
  const handleHotkey = (e: any) => {
    const target = e.target as HTMLElement | null;
    if (isInteractive(target) || e.metaKey || e.ctrlKey || e.altKey) return;

    const tasks = tasksRef.current;
    const focusedId = focusedIdRef.current;
    const editingId = editingIdRef.current;

    // ordered ids in the same order as render
    const orderedIds = () => {
      const order = ['Today','Tomorrow','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday','Next Monday','No Date'];
      const known = new Set(order);
      const by: Record<string, Task[]> = {} as any;
      for (const t of tasks) {
        const k = computeGroupLabelForISO(t.dueISO) || 'No Date';
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
      const btn = document.querySelector<HTMLElement>(`[data-view="${label}"]`);
      if (btn) { btn.click(); return true; }
      const aria = label === 'wo' ? /work\s*orders/i : /to-?\s*do|todos?/i;
      const candidates = Array.from(document.querySelectorAll<HTMLElement>('[role="tab"],button,[aria-label]'));
      const hit = candidates.find(el => aria.test(el.getAttribute('aria-label') || el.textContent || ''));
      if (hit) { hit.click(); return true; }
      clickFallback(label);
      try {
        const want = label === 'wo' ? '#view=wo' : '#view=tasks';
        if (location.hash !== want) {
          location.hash = want;
          window.dispatchEvent(new HashChangeEvent('hashchange'));
        }
      } catch {}
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
      const todayOpt = buildDueOptions()[0];
      const t = makeTask('New task', 'high', '', todayOpt.label);
      t.dueKey = todayOpt.key;
      t.dueISO = todayOpt.iso;
      t.pendingDueKey = null;
      t.pendingDueISO = null;
      setPinnedNewId(t.id);
      setTasks((prev: Task[]) => [t, ...prev]);
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
        setTasks((prev: Task[]) => prev.filter((t: Task) => t.id !== id));
      } else {
        setTasks((prev: Task[]) => prev.map((t: Task) => (t.id === id ? { ...t, done: !t.done } : t)));
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

  // register hotkeys
  useEffect(() => {
    const h = (e: KeyboardEvent) => handleHotkey(e);
    window.addEventListener('keydown', h, true);
    window.addEventListener('keydown', h, false);
    document.addEventListener('keydown', h, true);
    document.addEventListener('keydown', h, false);
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

  // On mount, if we haven't cleaned up for today yet, do it once
  useEffect(() => {
    const todayIso = toISODate(startOfDay(new Date()));
    const last = load<string>("lastCleanupISO", null as any);
    if (last !== todayIso) {
      cleanupDoneBeforeToday();
    }
  }, []);

  useEffect(() => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(24, 0, 0, 50); // a hair after midnight
    const ms = next.getTime() - now.getTime();
    const t = setTimeout(() => {
      cleanupDoneBeforeToday(); // purge yesterday's completed tasks
      forceTick((x) => x + 1);  // trigger a re-render for pill/group updates
    }, ms);
    return () => clearTimeout(t);
  }, []);

  // On initial load, force-select the first rendered task
  useEffect(() => {
    if (didInitFocus.current) return;
    if (tasks.length === 0) return;

    const order = [
      'Today','Tomorrow','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday','Next Monday','No Date',
    ];
    const known = new Set(order);
    const by: Record<string, Task[]> = {} as any;
    for (const t of tasks) {
      const k = computeGroupLabelForISO(t.dueISO) || 'No Date';
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


  // Listen for unpin requests from row blur
  useEffect(() => {
    const onUnpin = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (pinnedNewId !== id) return;
      // If there is a staged due change, commit it now
      setTasks((prev: Task[]) => {
        const opts = buildDueOptions();
        return prev.map((x: Task) => {
          if (x.id !== id) return x;
          const isoToUse = x.pendingDueISO ?? x.dueISO ?? null;
          const keyToUse = computeKeyForISO(isoToUse);
          const opt = opts.find((o) => o.key === keyToUse) || opts[0];
          return {
            ...x,
            dueISO: isoToUse,
            dueKey: keyToUse,
            dueLabel: opt.label,
            pendingDueISO: null,
            pendingDueKey: null,
          };
        });
      });
      setPinnedNewId(null);
    };
    document.addEventListener("todo:unpin-if", onUnpin as EventListener);
    return () => document.removeEventListener("todo:unpin-if", onUnpin as EventListener);
  }, [pinnedNewId, setTasks]);

  return (
    <div
      data-todo-root
      tabIndex={-1}
      className="mx-auto max-w-[1100px] px-6 sm:px-8"
      onKeyDownCapture={(e) => handleHotkey(e as any)}
    >
      {/* Local toolbar */}
      <div className="mb-3 flex items-center justify-end">
        <GlassButton
          tone="neutral"
          onClick={() => window.dispatchEvent(new Event("add-task"))}
        >
          + Add Task
        </GlassButton>
      </div>

      {/* Day groups */}
      {(() => {
        const order = [
          "Today","Tomorrow","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday","Next Monday","No Date",
        ];
        const known = new Set(order);

        // Group by computed label from stable local date
        const by: Record<string, Task[]> = {};
        for (const t of tasks) {
          const k = computeGroupLabelForISO(t.dueISO) || "No Date";
          (by[k] ||= []).push(t);
        }

        const dynamic = Object.keys(by).filter((k) => !known.has(k));
        const labels = [...order, ...dynamic].filter((k) => by[k]?.length);

        return labels.map((label) => (
          <DayCard key={label} className="mt-6">
            <div className="mb-2 flex items-center gap-3 text-neutral-800">
              <div className="text-xl font-semibold tracking-tight font-sans">{label}</div>
              <div className="ml-auto text-[11px] font-mono text-neutral-400">Oldest at top</div>
            </div>

            <ul className="mt-3 space-y-3">
              {(() => {
                const items = by[label];
                // Build a stable index map once from the overall tasks array to preserve original order ties
                const indexMap = new Map<string, number>();
                tasks.forEach((t, i) => indexMap.set(t.id, i));

                let ordered: Task[];
                if (label === "Today") {
                  const undone = items.filter((x) => !x.done);
                  const done   = items.filter((x) => x.done);
                  const sortedUndone = sortByPriorityStable(undone, indexMap);
                  const sortedDone   = sortByPriorityStable(done, indexMap);
                  ordered = [...sortedUndone, ...sortedDone];
                } else {
                  ordered = sortByPriorityStable(items, indexMap);
                }

                // If a newly-created item is pinned and belongs to this label, show it first (ignoring sort)
                let finalOrdered = ordered;
                if (pinnedNewId) {
                  const hasPinnedHere = items.some(x => x.id === pinnedNewId);
                  if (hasPinnedHere) {
                    const pinned = items.find(x => x.id === pinnedNewId)!;
                    finalOrdered = [pinned, ...ordered.filter(x => x.id !== pinnedNewId)];
                  }
                }
                return finalOrdered.map((t) => (
                  <TodoRow
                    key={t.id}
                    t={t}
                    editingId={editingId}
                    focusedId={focusedId}
                    setFocusedId={setFocusedId}
                    onSetEditingId={setEditingId}
                    onToggleDone={() => toggleDone(t.id)}
                    onChangeText={(val) =>
                      setTasks((prev: Task[]) =>
                        prev.map((x: Task) => (x.id === t.id ? { ...x, text: val } : x))
                      )
                    }
                    onCyclePriority={() =>
                      setTasks((prev: Task[]) =>
                        prev.map((x: Task) =>
                          x.id === t.id ? { ...x, priority: nextPriority(x.priority) } : x
                        )
                      )
                    }
                    onSetPriority={(p) => {
                      setTasks((prev: Task[]) =>
                        prev.map((x: Task) => (x.id === t.id ? { ...x, priority: p } : x))
                      );
                      // Defer resorting until user finishes with this row (Notes blur or row blur)
                      setPinnedNewId(t.id);
                    }}
                    onChangeDue={(key) => {
                      const opt = buildDueOptions().find((o) => o.key === key) || buildDueOptions()[0];
                      // Stage the new due (do not change grouping yet)
                      setTasks((prev: Task[]) =>
                        prev.map((x: Task) =>
                          x.id === t.id
                            ? {
                                ...x,
                                dueLabel: opt.label,    // update pill text immediately
                                pendingDueKey: opt.key, // stage only
                                pendingDueISO: opt.iso, // stage only
                              }
                            : x
                        )
                      );
                      // Keep it pinned until user finishes (Notes blur triggers commit)
                      setPinnedNewId(t.id);
                    }}
                    onChangeNotes={(val) =>
                      setTasks((prev: Task[]) =>
                        prev.map((x: Task) => (x.id === t.id ? { ...x, notes: val } : x))
                      )
                    }
                    onToggleExpanded={() => toggleExpanded(t.id)}
                    onRemove={() => remove(t.id)}
                  />
                ));
              })()}
            </ul>
          </DayCard>
        ));
      })()}
    </div>
  );
}

// Auto-resize helper for notes textarea
function useAutosizeTextArea(ref: React.RefObject<HTMLTextAreaElement | null>, value: string) {
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
            setHighlight((h) => (h + 1) % options.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => (h - 1 + options.length) % options.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            const opt = options[highlight] || options[0];
            onChange(opt.key);
            setOpen(false);
            skipOpenRef.current = true;
            requestAnimationFrame(() => btnRef.current?.focus());
          } else if (e.key === "Tab") {
            const lastIndex = options.length - 1;
            const atEndForward = !e.shiftKey && highlight >= lastIndex;
            const atEndBackward = e.shiftKey && highlight <= 0;

            if (atEndForward || atEndBackward) {
              const opt = options[highlight] || options[0];
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
                const next = h + delta;
                return Math.min(Math.max(next, 0), lastIndex);
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
  const dueOpts = buildDueOptions();
  return (
    <TodoCard
      data-row={t.id}
      tabIndex={0}
      onFocus={() => setFocusedId(t.id)}
      onKeyDown={(e) => {
        if (e.currentTarget !== e.target) return;
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
              nextFocusQuery={`.data-due-btn-${t.id}`}
            />
          </div>

          <div className="relative inline-flex items-center">
            <InlineSelect
              value={t.pendingDueKey ?? t.dueKey ?? computeKeyForISO(t.dueISO)}
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
            onBlurComplete={() => {
              document.dispatchEvent(new CustomEvent("todo:unpin-if", { detail: t.id }));
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
  onBlurComplete,
}: {
  value: string;
  onChange: (v: string) => void;
  onEscapeFocusRow?: () => void;
  onBlurComplete?: () => void;
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
        onBlur={() => { onBlurComplete?.(); }}
        rows={1}
        placeholder="Add notes…"
        className="w-full resize-none overflow-hidden rounded-md border border-neutral-200/60 bg-white/60 px-3 py-2 text-[11px] font-mono leading-[1.4] placeholder:text-neutral-400 focus:border-neutral-300 focus:outline-none focus:ring-0"
      />
    </div>
  );
}