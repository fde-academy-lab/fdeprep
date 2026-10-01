"use client";

/** Any page under the shared header that fails to render. components/ui/page-error.tsx says why. */
import { PageError } from "@/components/ui/page-error";

export default function ShellError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return <PageError {...props} />;
}
