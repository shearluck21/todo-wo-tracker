import { forwardRef, InputHTMLAttributes } from "react";

type Props = InputHTMLAttributes<HTMLInputElement> & {
  sizeClass?: string; // optional fixed width like "basis-56 shrink-0"
};

const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { className = "", sizeClass = "", ...props },
  ref
) {
  return (
    <input
      ref={ref}
      className={
        "h-11 rounded-xl border border-neutral-300 bg-white px-3 text-sm outline-none " +
        "focus:ring-2 focus:ring-neutral-900/10 " +
        sizeClass + " " + className
      }
      {...props}
    />
  );
});

export default Input;