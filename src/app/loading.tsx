import { CardBones, HeadingBones, Loading } from "@/components/skeleton";

// Shown right after a click on any page that loads data and has no loading screen of its own (home, Playground,
// Numbers, Submit, Admin), until the page is ready.
export default function PageLoading() {
  return (
    <Loading className="mx-auto max-w-6xl px-4 pt-12 sm:px-6">
      <HeadingBones wide />
      <div className="mt-10">
        <CardBones cards={6} />
      </div>
    </Loading>
  );
}
