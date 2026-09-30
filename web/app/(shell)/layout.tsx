/**
 * Every full-page screen shares the header. The workspace, the rehearsal
 * shell and the voice cockpit live in (focus) instead, where the header would
 * cost vertical space a learner is using.
 */
import { AppHeader } from "@/components/shell/app-header";
import { paletteIndex } from "@/lib/problems/catalogue";
import { currentLearner } from "@/lib/session/current";

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const learner = await currentLearner();
  const problems = await paletteIndex(learner.enrolmentId);
  return (
    <>
      <AppHeader learner={learner} problems={problems} />
      <div id="main">{children}</div>
    </>
  );
}
