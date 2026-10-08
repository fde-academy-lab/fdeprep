"use client";
/**
 * A file picker that looks like the rest of the form: a secondary button and
 * the chosen file's name. The native control stays in the form, hidden, so
 * `required` still holds the form back until a file is chosen. A client module
 * of its own, because it keeps the name; import it from field.tsx with the
 * other controls.
 */
import { useRef, useState, type ComponentProps } from "react";
import { Button } from "./button";
import { cn } from "./cn";

export function FileInput({ className, onChange, "aria-describedby": described, ...rest }:
  Omit<ComponentProps<"input">, "type">) {
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState<string | null>(null);
  return (
    <span className={cn("flex min-w-0 items-center gap-3", className)}>
      <input ref={input} type="file" hidden {...rest}
             onChange={(event) => {
               setName(event.target.files?.[0]?.name ?? null);
               onChange?.(event);
             }} />
      <Button data-autofocus aria-describedby={described} onClick={() => input.current?.click()}>
        Choose a file
      </Button>
      {name ? <span className="min-w-0 truncate text-text-dim">{name}</span> : null}
    </span>
  );
}
