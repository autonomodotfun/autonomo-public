import { Bone, HeadingBones, Loading } from "@/components/skeleton";

// One API's page: breadcrumb, name and description, its facts, and its endpoints.
export default function ProjectLoading() {
  return (
    <Loading className="mx-auto max-w-6xl px-4 pt-10 sm:px-6">
      <Bone className="h-3 w-40" />
      <div className="mt-6">
        <HeadingBones />
      </div>
      <div className="mt-10 grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-4">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i}>
            <Bone className="h-3 w-16" />
            <Bone className="mt-2 h-4 w-24" />
          </div>
        ))}
      </div>
      <Bone className="mt-10 h-6 w-40" />
      <Bone className="mt-4 h-40 w-full" />
    </Loading>
  );
}
