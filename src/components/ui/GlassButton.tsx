import * as React from "react";

type Tone = "neutral" | "blue" | "red" | "amber" | "green";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: Tone;
  size?: "sm" | "md";
};

export default function GlassButton({
  className = "",
  tone = "neutral",
  size = "md",
  ...props
}: Props) {
  const toneCls =
    tone === "red"
      ? "border-red-200/70 bg-red-50/70 text-red-800 hover:bg-red-50/80"
      : tone === "amber"
      ? "border-amber-200/70 bg-amber-50/70 text-amber-800 hover:bg-amber-50/80"
      : tone === "blue"
      ? "border-blue-200/70 bg-blue-50/70 text-blue-800 hover:bg-blue-50/80"
      : tone === "green"
      ? "border-emerald-200/70 bg-emerald-50/70 text-emerald-800 hover:bg-emerald-50/80"
      : "border-neutral-200/60 bg-white/65 text-neutral-900 hover:bg-white/75";

  const sizeCls =
    size === "sm" ? "px-2.5 py-1 text-[11px]" : "px-3.5 py-1.5 text-[12px]";

  const base = [
    "inline-flex items-center justify-center gap-1",
    "rounded-md border",
    "backdrop-blur-lg supports-[backdrop-filter]:backdrop-blur-lg backdrop-saturate-150",
    "ring-1 ring-black/5 shadow-sm hover:shadow-md",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10",
    "transition-colors transition-shadow",
    sizeCls,
    toneCls,
  ].join(" ");

  return <button {...props} className={`${base} ${className}`} />;
}