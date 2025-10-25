import * as React from "react";

type Props = React.LiHTMLAttributes<HTMLLIElement>;

export default function TodoCard({ className = "", ...props }: Props) {
  // slightly more opaque “floating” row card
  const base =
    "rounded-md border border-neutral-200/70 bg-white/90 " +
    "backdrop-blur supports-[backdrop-filter]:backdrop-blur-sm " +
    "px-4 py-3 shadow-sm hover:shadow-md transition-shadow";
  return <li {...props} className={`${base} ${className}`} />;
}