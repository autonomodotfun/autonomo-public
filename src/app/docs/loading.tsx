import { Bone, HeadingBones, Loading } from "@/components/skeleton";

// A docs page that loads data (Docs home, the directory guide), inside the docs layout so the sidebar stays.
// Guides that are built ahead of time open straight away and never show this.
export default function DocsLoading() {
  return (
    <Loading className="min-w-0 max-w-3xl">
      <HeadingBones wide />
      <div className="mt-10 space-y-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Bone key={i} className={`h-4 ${i % 3 === 2 ? "w-2/3" : "w-full"}`} />
        ))}
      </div>
    </Loading>
  );
}
