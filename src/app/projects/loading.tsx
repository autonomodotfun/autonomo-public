import { Bone, HeadingBones, Loading, RowBones } from "@/components/skeleton";

// Explore APIs: the heading, search and category tabs, then the chain filter and the results, while the directory loads.
export default function ProjectsLoading() {
  return (
    <Loading className="mx-auto max-w-6xl px-4 pt-10 sm:px-6">
      <HeadingBones wide />
      <Bone className="mt-6 h-11 w-full max-w-2xl" />
      <div className="mt-6 flex gap-4 border-b border-line pb-3">
        {Array.from({ length: 5 }, (_, i) => (
          <Bone key={i} className="h-4 w-20" />
        ))}
      </div>
      <div className="mt-8 grid gap-8 lg:grid-cols-[12rem_1fr]">
        <div className="hidden space-y-3 lg:block">
          {Array.from({ length: 7 }, (_, i) => (
            <Bone key={i} className="h-4 w-3/4" />
          ))}
        </div>
        <div className="min-w-0">
          <Bone className="mb-4 h-4 w-32" />
          <RowBones rows={8} />
        </div>
      </div>
    </Loading>
  );
}
