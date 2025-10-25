import { useEffect, useState } from "react";
import { motion } from "framer-motion";

type SegmentedControlProps = {
  options: string[];
  value?: string;                    // controlled (optional)
  onChange?: (val: string) => void;
  className?: string;
};

export default function SegmentedControl({
  options,
  value,
  onChange,
  className = "",
}: SegmentedControlProps) {
  const [active, setActive] = useState(value ?? options[0]);

  // keep in sync when used as controlled
  useEffect(() => {
    if (value !== undefined) setActive(value);
  }, [value]);

  const select = (opt: string) => {
    if (value === undefined) setActive(opt);
    onChange?.(opt);
  };

  return (
    <div
      className={[
        "relative inline-flex items-center gap-1 p-1",
        "rounded-2xl border border-neutral-200/70 bg-white/50",
        "backdrop-blur supports-[backdrop-filter]:backdrop-blur-md",
        "shadow-xs ring-1 ring-black/5",
        className,
      ].join(" ")}
    >
      {options.map((opt) => {
        const selected = opt === active;
        return (
          <button
            key={opt}
            onClick={() => select(opt)}
            role="tab"
            aria-selected={selected}
            className={[
              "relative h-9 px-4 rounded-xl",
              "text-[11px] font-medium",
              "isolate overflow-hidden", // keep pill behind text
              selected ? "text-white" : "text-neutral-600 hover:text-neutral-800",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/10",
            ].join(" ")}
          >
            {/* The sliding pill lives INSIDE the selected button */}
            {selected && (
              <motion.span
                layoutId="seg-pill"
                className="absolute inset-0 rounded-xl bg-neutral-900 shadow-sm"
                transition={{ type: "spring", stiffness: 420, damping: 30, mass: 0.3 }}
              />
            )}
            <span className="relative z-10">{opt}</span>
          </button>
        );
      })}
    </div>
  );
}