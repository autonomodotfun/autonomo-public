// A referral link is never shown without its disclosure on the same page. Read as text, since pages are JSX.
// Run: npx tsx --conditions=react-server --test src/app/docs/qhooks/referral.test.ts

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = process.cwd();
const REF_LINK = /[?&]ref=autonomo/;
const read = (...parts: string[]) => readFileSync(join(root, ...parts), "utf8").replace(/\r\n/g, "\n");

/** Every source file that carries our referral link. */
function carriers() {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(tsx?|mdx?)$/.test(name) && !name.endsWith(".test.ts") && REF_LINK.test(readFileSync(path, "utf8"))) found.push(path.slice(root.length + 1).replace(/\\/g, "/"));
    }
  };
  walk(join(root, "src"));
  return found;
}

test("the referral link lives only in the QHooks guide", () => {
  assert.deepEqual(carriers(), ["src/app/docs/qhooks/page.tsx"]);
});

test("the guide says who earns, how much, and that the trader pays the same", () => {
  const page = read("src", "app", "docs", "qhooks", "page.tsx").replace(/&apos;/g, "'").replace(/\s+/g, " ");
  assert.match(page, /Autonomo's referral link/);
  assert.match(page, /earn Autonomo 20% of the QHooks fee/, "QHooks' own line is kept as written");
  assert.match(page, /20% of QHooks' fee/);
  assert.match(page, /The trader pays the same either way/);
  assert.match(page, /Autonomo places no trades/);
  assert.match(page, /without Autonomo's referral/, "the way to add it without the referral");
  assert.ok(page.indexOf("Autonomo's referral link") < page.indexOf("<Code code={CLAUDE_CODE}"), "the notice comes before the command");
  assert.ok(!/\b(yield|guaranteed?|risk-free)\b/i.test(page), "no promise of gains");
});

test("the partners card links to the guide and carries no referral link of its own", () => {
  const partners = read("src", "components", "partners.tsx");
  assert.ok(!REF_LINK.test(partners));
  assert.match(partners, /\{ href: "\/docs\/qhooks", label: "[^"]+" \}/);
});
