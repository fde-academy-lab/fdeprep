/**
 * The admin shell, S10.
 *
 * "Faculty see Roster read-only and Submissions in full. Everything else is
 * admin only." The check is here rather than on each screen, so a new screen
 * added under this directory is closed by default rather than open by
 * oversight.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { currentLearner } from "@/lib/session/current";

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
    <div className="mx-auto max-w-6xl">
      <nav className="flex items-center gap-4 border-b border-border px-4 py-2">
        <Link href="/" className="text-text-dim hover:text-text">&lt; FDE Prep</Link>
        {visible.map((tab) => (
          <Link key={tab.href} href={tab.href} className="text-text-dim hover:text-text">
            {tab.label}
          </Link>
        ))}
        <span className="ml-auto text-text-faint">{learner.displayName} | {learner.role}</span>
      </nav>
      {children}
    </div>
  );
}
