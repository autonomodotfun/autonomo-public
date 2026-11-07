import { CardBones, HeadingBones, Loading } from "@/components/skeleton";

// The launch dashboard and an API's page in it, while the owner's data loads.
export default function DashboardLoading() {
  return (
    <Loading className="mx-auto max-w-5xl px-4 pt-10 sm:px-6">
      <HeadingBones />
      <div className="mt-10">
        <CardBones cards={3} />
      </div>
    </Loading>
  );
}
