/**
 * The admin shell, S10.
 *
 * "Faculty see Roster read-only and Submissions in full. Everything else is
 * admin only." The check is here rather than on each screen, so a new screen
 * added under this directory is closed by default rather than open by
 * oversight.
 */
import { notFound } from "next/navigation";
import { currentLearner } from "@/lib/session/current";
import { AdminTabs } from "./admin-tabs";

export const dynamic = "force-dynamic";

const TABS = [
  { href: "/admin/roster", label: "Roster", faculty: true },
  { href: "/admin/import", label: "Problems", faculty: false },
  { href: "/admin/submissions", label: "Submissions", faculty: true },
  { href: "/admin/disagreements", label: "Disagreements", faculty: true },
  { href: "/admin/ops", label: "Ops", faculty: false },
] as const;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const learner = await currentLearner();
  if (learner.role !== "admin" && learner.role !== "faculty") notFound();

  const visible = TABS.filter((tab) => learner.role === "admin" || tab.faculty);

  return (
    <div className="mx-auto max-w-[1280px] px-4 pb-16 pt-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {/* The section title; each admin page carries the page's one h1. */}
        <p className="text-display font-semibold tracking-[-0.02em] text-text">Admin</p>
        <span className="text-meta capitalize text-text-faint">
          {learner.displayName}, {learner.role}
        </span>
      </div>
      <div className="mt-5">
        <AdminTabs tabs={visible.map((tab) => ({ href: tab.href, label: tab.label }))} />
      </div>
      <div className="mt-6 [&_h1]:text-title [&_h1]:font-semibold [&_h1]:text-text">{children}</div>
    </div>
  );
}
