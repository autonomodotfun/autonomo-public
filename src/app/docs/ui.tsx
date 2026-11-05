import Link from "next/link";
import { CopyButton } from "@/components/copy-button";

// Building blocks shared by the docs pages.

export function Page({ eyebrow = "Guide", title, children }: { eyebrow?: string; title: string; children: React.ReactNode }) {
  return (
    <article className="min-w-0 max-w-3xl">
      <p className="font-mono text-xs tracking-wide text-accent uppercase">{eyebrow}</p>
      <h1 className="heading mt-2 text-4xl sm:text-5xl">{title}</h1>
      <div className="docs-body mt-6 space-y-4">{children}</div>
    </article>
  );
}

export function Section({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 space-y-4 pt-10">
      <h2 className="heading text-2xl">{title}</h2>
      {children}
    </section>
  );
}

export function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 pt-1">
      <h3 className="flex items-baseline gap-2 font-medium">
        <span className="font-mono text-xs text-accent">{String(n).padStart(2, "0")}</span>
        {title}
      </h3>
      {children}
    </div>
  );
}

export function Cards({ children, cols = 3 }: { children: React.ReactNode; cols?: 2 | 3 }) {
  return (
    <div className={`grid gap-px overflow-hidden rounded-lg border border-line bg-line ${cols === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
      {children}
    </div>
  );
}

/** A card; a link when `href` is set. */
export function Card({ title, body, href }: { title: string; body: string; href?: string }) {
  const inner = (
    <>
      <span className="font-medium text-ink">
        {title}
        {href ? " →" : ""}
      </span>
      <span className="mt-1 block text-sm text-muted">{body}</span>
    </>
  );
  if (!href) return <div className="bg-bg p-4">{inner}</div>;
  return (
    <Link href={href} className="bg-bg p-4 no-underline hover:bg-surface">
      {inner}
    </Link>
  );
}

export function Code({ code, lang }: { code: string; lang: string }) {
  return (
    <div className="relative rounded-lg border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
        <span className="font-mono text-xs text-faint">{lang}</span>
        <CopyButton text={code} label="Copy code" className="font-mono text-xs text-muted uppercase hover:text-ink" />
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function Table({ rows, mono = false }: { rows: [React.ReactNode, React.ReactNode][]; mono?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full text-sm">
        <tbody className="divide-y divide-line">
          {rows.map(([a, b], i) => (
            <tr key={i}>
              <td className={`py-2.5 pr-4 pl-4 align-top ${mono ? "font-mono text-xs whitespace-nowrap" : ""}`}>{a}</td>
              <td className="py-2.5 pr-4 align-top text-muted">{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Faq({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="divide-y divide-line border-y border-line">
      {items.map(([q, a]) => (
        <div key={q} className="py-4">
          <dt className="font-medium">{q}</dt>
          <dd className="mt-1 text-muted">{a}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A screenshot with a caption. `width`/`height` are the image's size in CSS pixels (half its pixel size). */
export function Shot({ src, alt, caption, width, height, narrow = false }: { src: string; alt: string; caption: string; width: number; height: number; narrow?: boolean }) {
  return (
    <figure className={`space-y-2 ${narrow ? "max-w-sm" : ""}`}>
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading="lazy"
        decoding="async"
        className="h-auto w-full rounded-lg border border-line"
      />
      <figcaption className="text-xs text-muted">{caption}</figcaption>
    </figure>
  );
}
