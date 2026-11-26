import { readFileSync } from "node:fs";
import { join } from "node:path";

// The agent skill, served from the one file in skills/autonomo, so the link and the repository never differ.
// Read when the site is built: the file ships with the build, and nothing is read from disk per request.
export const dynamic = "force-static";

export function GET() {
  const text = readFileSync(join(process.cwd(), "skills", "autonomo", "SKILL.md"), "utf8");
  return new Response(text, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
