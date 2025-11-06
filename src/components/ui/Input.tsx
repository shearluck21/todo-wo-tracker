import { forwardRef } from "react";

// `InputHTMLAttributes` is only used as a type, so we import it with `type`.
import type { InputHTMLAttributes } from "react";

type Props = InputHTMLAttributes<HTMLInputElement> & {
  sizeClass?: string; // optional fixed width like "basis-56 shrink-0"
};

const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { className = "", sizeClass, ...props },
  ref
) {
  return (
    <div
      className={[
        "flex items-center rounded-xl border border-neutral-300 bg-white px-3 text-sm outline-none focus-within:ring-2 focus-within:ring-neutral-900/10",
        sizeClass || "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <input
        ref={ref}
        className={[
          "h-11 w-full bg-transparent text-[13px] leading-none text-neutral-900 placeholder:text-neutral-400 focus:outline-none",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        {...props}
      />
    </div>
  );
});

export default Input;
