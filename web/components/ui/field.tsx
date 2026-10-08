/**
 * Form controls, styled the way the Problems search box already is: 32 pixels
 * high, the control radius, a border at 3:1 against the page, the page colour
 * inside, and the accent on the border only while focused (docs/08 sections 3
 * and 6). A native control is used underneath every one, so the keyboard,
 * autofill and a form posting without JavaScript all keep working.
 *
 * Not a client module. Field clones its control to wire the label and the
 * description, and a client component handed its children by a server page
 * receives them as references it cannot clone. Rendered on whichever side
 * uses it, Field always holds the real element.
 */
import { ChevronDown } from "lucide-react";
import { cloneElement, useId, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { cn } from "./cn";

export { FileInput } from "./file-input";

const CONTROL =
  "w-full min-w-0 rounded-control border border-border-control bg-bg text-text outline-none " +
  "placeholder:text-text-faint focus:border-accent disabled:opacity-45";

interface Wired {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}

/**
 * A label above one control, an optional help line below it, and an error line
 * in the fail tint that a screen reader announces as it appears. The control
 * gets its id and its description from here, so a caller cannot forget either.
 */
export function Field({ label, help, error, className, children }: {
  label: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: ReactElement<Wired>;
}) {
  const id = useId();
  const described = [help ? `${id}-help` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ");
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-meta font-medium text-text-dim">{label}</label>
      {cloneElement(children, {
        id, "aria-describedby": described || undefined, "aria-invalid": error ? true : undefined,
      })}
      {help ? <p id={`${id}-help`} className="text-meta text-text-faint">{help}</p> : null}
      {error ? <p id={`${id}-error`} role="alert" className="text-meta text-fail">{error}</p> : null}
    </div>
  );
}

export function Input({ className, ...rest }: ComponentProps<"input">) {
  return <input className={cn(CONTROL, "h-8 px-2.5", className)} {...rest} />;
}

/** The native select, so its list is the platform's, with the chevron drawn over it. */
export function Select({ className, children, ...rest }: ComponentProps<"select">) {
  return (
    <span className={cn("relative block min-w-0", className)}>
      <select className={cn(CONTROL, "h-8 cursor-pointer appearance-none pl-2.5 pr-8")} {...rest}>
        {children}
      </select>
      <ChevronDown aria-hidden
                   className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-text-faint" />
    </span>
  );
}

export function Textarea({ className, rows = 3, ...rest }: ComponentProps<"textarea">) {
  return <textarea rows={rows} className={cn(CONTROL, "block resize-y px-2.5 py-1.5", className)} {...rest} />;
}
