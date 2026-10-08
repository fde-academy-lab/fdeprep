/**
 * /admin, which the header's Admin link opens. It lands on Roster, the first
 * tab faculty and admins both see, until the Overview takes this page.
 *
 * The redirect sits here rather than in the layout because a layout cannot
 * see which page below it is rendering (Next.js 16.3.5, layout.md, "Layouts
 * do not have access to the route segments below itself").
 */
import { redirect } from "next/navigation";

export default function AdminIndex(): never {
  redirect("/admin/roster");
}
