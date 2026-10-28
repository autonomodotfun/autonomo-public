import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-4 pt-24 text-center sm:px-6">
      <p className="font-mono text-sm text-accent">404</p>
      <h1 className="heading mt-2 text-3xl">Nothing launched here</h1>
      <p className="mt-3 text-muted">This project doesn&apos;t exist or has been removed.</p>
      <Link href="/projects" className="mt-6 inline-block underline">Explore APIs</Link>
    </div>
  );
}
