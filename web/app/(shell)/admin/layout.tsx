/**
 * The admin shell, S10.
 *
 * Faculty see the Overview, Roster read-only, Submissions in full and
 * Disagreements; everything else is admin only (docs/01 S10, amended 8 October
 * 2026 for the Overview). The staff check is here rather than on each screen,
 * so a new screen added under this directory is closed to learners by default
 * rather than open by oversight. A layout cannot see which page it wraps, so
 * an admin-only page also refuses faculty itself.
 *
 * The measure is 1280 pixels, against 960 on the learner screens, because these
 * tables carry seven to ten columns.
 */
import { notFound } from "next/navigation";
import { permits } from "@/lib/admin/guard";
import { currentLearner } from "@/lib/session/current";
import { AdminTabs } from "./admin-tabs";

export const dynamic = "force-dynamic";

const TABS = [
  { href: "/admin", label: "Overview", faculty: true },
  { href: "/admin/roster", label: "Roster", faculty: true },
  { href: "/admin/import", label: "Problems", faculty: false },
  { href: "/admin/submissions", label: "Submissions", faculty: true },
  { href: "/admin/disagreements", label: "Disagreements", faculty: true },
  { href: "/admin/ops", label: "Ops", faculty: false },
] as const;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const learner = await currentLearner();
  if (!permits(learner.role, "faculty")) notFound();

  const visible = TABS.filter((tab) => learner.role === "admin" || tab.faculty);

  return (
    <div className="mx-auto max-w-[1280px] px-6 pb-16 pt-6">
      <AdminTabs tabs={visible.map((tab) => ({ href: tab.href, label: tab.label }))} />
      <main className="mt-8 space-y-8">{children}</main>
    </div>
  );
}
