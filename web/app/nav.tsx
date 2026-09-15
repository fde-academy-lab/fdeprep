/**
 * The nav bar from S2, shared by every full-page screen.
 *
 * Server component: it takes the active item as a prop rather than reading the
 * pathname, so nothing here has to become a client bundle to draw four links.
 */
import Link from "next/link";

/**
 * docs/01 S2 draws four items. Voice is a fifth, added because the Voice
 * Screen is a screen a learner has to reach and a screen reachable only by
 * typing a URL is a screen nobody uses. Worth saying out loud rather than
 * changing the wireframe quietly.
 */
const ITEMS = [
  { href: "/", label: "Roadmap", key: "roadmap" },
  { href: "/problems", label: "Problems", key: "problems" },
  { href: "/rehearsal", label: "Rehearsal", key: "rehearsal" },
  { href: "/voice/session", label: "Voice", key: "voice" },
  { href: "/progress", label: "Progress", key: "progress" },
] as const;

export default function Nav({ active }: { active: string }) {
  return (
    <nav className="flex items-center gap-4 border-b border-border px-4 py-2">
      {ITEMS.map((item) => (
        <Link key={item.key} href={item.href}
              aria-current={item.key === active ? "page" : undefined}
              className={item.key === active ? "text-text" : "text-text-dim hover:text-text"}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
