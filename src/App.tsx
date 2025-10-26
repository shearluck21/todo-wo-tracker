import { useState, useEffect } from "react";
import TodoList from "./components/TodoList";
import WOList from "./components/WOList";

export default function App() {
  const [tab, setTab] = useState<"todos" | "wo">("todos");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isField =
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        (target as any)?.isContentEditable;
      if (isField || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "w" || e.key === "W") {
        e.preventDefault();
        setTab("todos");
      } else if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        setTab("wo");
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Frosted segmented control header */}
      <header className="w-full flex justify-center pt-6">
        <div
          className={[
            "relative inline-grid grid-cols-2 items-center",
            "rounded-lg border border-neutral-200/70 bg-white/50",
            "backdrop-blur supports-[backdrop-filter]:backdrop-blur-md",

            "p-1",
          ].join(" ")}
          role="tablist"
          aria-label="Mode"
        >
          {/* active pill */}
          <span
            className={[
              "pointer-events-none absolute inset-y-1 w-[calc(50%-8px)]",
              "rounded-md bg-neutral-200/80 shadow-sm",
              "transition-all duration-200 ease-out",
              tab === "todos" ? "left-1" : "left-[calc(50%+4px)]",
            ].join(" ")}
          />
          <button
            role="tab"
            aria-selected={tab === "todos"}
            onClick={() => setTab("todos")}
            className={[
              "relative z-10 px-3 py-1.5 text-[11px] font-medium",
              "transition-colors",
              tab === "todos" ? "text-neutral-900" : "text-neutral-600 hover:text-neutral-800",
              "focus:outline-none focus-visible:outline-none focus:ring-0"
            ].join(" ")}
          >
            Todos
          </button>
          <button
            role="tab"
            aria-selected={tab === "wo"}
            onClick={() => setTab("wo")}
            className={[
              "relative z-10 px-3 py-1.5 text-[11px] font-medium",
              "transition-colors",
              tab === "wo" ? "text-neutral-900" : "text-neutral-600 hover:text-neutral-800",
              "focus:outline-none focus-visible:outline-none focus:ring-0"
            ].join(" ")}
          >
            WO Tracker
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-[1100px] px-6 sm:px-8 pt-6 pb-10">
        {/* Render based on tab */}
        {tab === "todos" ? <TodoList /> : <WOList />}
      </main>
    </div>
  );
}