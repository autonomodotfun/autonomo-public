import { Bone, Loading, RowBones } from "@/components/skeleton";

// Explore APIs: the filters on the left and the results, while the directory loads.
export default function ProjectsLoading() {
  return (
    <Loading className="mx-auto grid max-w-6xl gap-10 px-4 pt-10 sm:px-6 lg:grid-cols-[13rem_1fr]">
      <div className="hidden space-y-3 lg:block">
        <Bone className="h-9 w-full" />
        {Array.from({ length: 7 }, (_, i) => (
          <Bone key={i} className="h-4 w-3/4" />
        ))}
      </div>
      <div className="min-w-0">
        <Bone className="h-9 w-56 max-w-full" />
        <Bone className="mt-3 h-4 w-72 max-w-full" />
        <div className="mt-6">
          <RowBones rows={8} />
        </div>
      </div>
    </Loading>
  );
}
