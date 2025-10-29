import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";

type Props = InputHTMLAttributes<HTMLInputElement> & {
  /** optional fixed width like "basis-56 shrink-0" */
  sizeClass?: string;
};

const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { className = "", sizeClass = "", ...props },
  ref
) {
  return (
    <input
      ref={ref}
      className={`h-11 rounded-2xl px-4 outline-none ${sizeClass ?? ""} ${className ?? ""}`}
      {...props}
    />
  );
});

export default Input;+