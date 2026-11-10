import { redirect } from "next/navigation";

// The research agent lives in the Agent Playground's Research mode now.
export default function ResearchPage() {
  redirect("/playground?mode=research");
}
