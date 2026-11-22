import { DocsNav, DocsPager, DocsToc } from "./docs-nav";
import { NAV } from "./nav";

// Every docs page: the menu on the left, the guide, and its sections on the right when the screen is wide enough.
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto grid max-w-6xl gap-8 px-4 pt-10 sm:px-6 lg:grid-cols-[13rem_minmax(0,1fr)] xl:grid-cols-[13rem_minmax(0,1fr)_auto]">
      <DocsNav groups={NAV} />
      <div id="docs-content" className="min-w-0">
        <DocsToc variant="top" />
        {children}
        <DocsPager groups={NAV} />
      </div>
      <DocsToc variant="side" />
    </div>
  );
}
