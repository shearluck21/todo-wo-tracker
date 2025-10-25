import * as React from "react";

type Props = React.SelectHTMLAttributes<HTMLSelectElement> & {
  tone?: "neutral" | "blue" | "red" | "amber";
};

/**
 * Reusable frosted select styled as a compact pill with a custom chevron.
 * Usage:
 *   <SelectPill value={val} onChange={...}>
 *     <option value="a">A</option>
 *   </SelectPill>
 */
export default function SelectPill({ className = "", tone = "neutral", children, ...props }: Props) {
  const toneCls =
    tone === "red"
      ? "border-red-200 bg-red-50/70 text-red-800"
      : tone === "amber"
      ? "border-amber-200 bg-amber-50/70 text-amber-800"
      : tone === "blue"
      ? "border-blue-200 bg-blue-50/70 text-blue-800"
      : "border-neutral-200 bg-white/70 text-neutral-800";

  return (
    <div className={`relative inline-flex items-center ${className}`}>
      <select
        {...props}
        className={[
          "appearance-none",
          "rounded-md border px-3 py-1.5 pr-6 text-[11px] leading-none",
          "backdrop-blur-md supports-[backdrop-filter]:backdrop-blur-md",
          "shadow-xs ring-1 ring-black/5",
          toneCls,
          "focus:outline-none focus:ring-0 focus:border-neutral-300",
        ].join(" ")}
      >
        {children}
      </select>
      <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[12px] text-neutral-600">▾</span>
    </div>
  );
}