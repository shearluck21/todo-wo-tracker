import * as React from "react";

type Props = React.HTMLAttributes<HTMLDivElement>;

export default function DayCard({ className = "", ...props }: Props) {
  const base = [
    // layout and padding
    "relative z-0 p-5 md:p-6 rounded-xl",
    // visible glass background with more depth
    "border border-white/40 bg-white/40 backdrop-blur-md backdrop-saturate-150",
    // subtle shadow and ring for separation
    "ring-1 ring-black/10 shadow-[0_4px_30px_rgba(0,0,0,0.1)]",
    // hover and focus depth
    "transition-all duration-300 hover:shadow-lg hover:bg-white/45",
    // animated gradient highlight across the top edge
    "before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-white/40 before:to-transparent",
    // ensure content layering
    "overflow-hidden supports-[backdrop-filter]:backdrop-blur-md",
  ].join(" ");

  return <div {...props} className={`${base} ${className}`} />;
}