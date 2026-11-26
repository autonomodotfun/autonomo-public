import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// The skill tells an agent which commands to run with real money, so it must not drift from the CLI it describes.
const root = process.cwd();
const skill = readFileSync(join(root, "skills", "autonomo", "SKILL.md"), "utf8").replace(/\r\n/g, "\n");
const cli = readFileSync(join(root, "sdk", "typescript", "src", "cli.ts"), "utf8");
const sdk = readFileSync(join(root, "sdk", "typescript", "src", "index.ts"), "utf8");

const [, frontmatter = "", body = ""] = skill.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/) ?? [];
const field = (name: string) => frontmatter.match(new RegExp(`^${name}: (.*)$`, "m"))?.[1] ?? "";

test("the skill's header follows the Agent Skills format", () => {
  const name = field("name");
  assert.equal(name, "autonomo", "the name must match the folder, skills/autonomo");
  assert.match(name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  const description = field("description");
  assert.ok(description.length > 0 && description.length <= 1024, `description is ${description.length} characters`);
  const compatibility = field("compatibility");
  assert.ok(compatibility.length > 0 && compatibility.length <= 500, `compatibility is ${compatibility.length} characters`);
  assert.ok(body.split("\n").length < 500, "keep the skill under 500 lines");
});

test("every command the skill names is a command of the CLI", () => {
  const help = cli.slice(cli.indexOf("const HELP = `"), cli.indexOf("const ADDRESS"));
  const named = new Set<string>();
  // Commands in the two tables: a row whose first cell is code, e.g. | `risk <token address>` | … |
  for (const [, cell] of body.matchAll(/^\| `([a-z]+)[ `]/gm)) named.add(cell);
  // Commands in the examples: npx -y autonomo-sdk <command>
  for (const [, command] of body.matchAll(/npx -y autonomo-sdk ([a-z]+)/g)) named.add(command);
  assert.ok(named.size >= 15, `only found ${[...named].join(", ")}`);
  for (const command of named) {
    assert.ok(help.includes(`autonomo ${command} `) || help.includes(`autonomo ${command}\n`), `"${command}" is not in the CLI's help`);
  }
});

test("every option the skill names is an option of the CLI", () => {
  const options = new Set([...body.matchAll(/`(--[a-z-]+)/g)].map(([, option]) => option));
  assert.ok(options.has("--dry-run") && options.has("--json"));
  for (const option of options) assert.ok(cli.includes(`"${option.slice(2)}"`) || cli.includes(`${option.slice(2)}: {`), `"${option}" is not a CLI option`);
});

test("the limits the skill states are the CLI's defaults", () => {
  const [, perCall, perCallToken, daily, dailyToken] =
    sdk.match(/DEFAULT_LIMITS = \{\s*perCall: \{ usdg: "([\d.]+)", autonomo: "(\d+)" \},\s*daily: \{ usdg: "([\d.]+)", autonomo: "(\d+)" \}/) ?? [];
  assert.ok(perCall && perCallToken && daily && dailyToken, "couldn't read DEFAULT_LIMITS from the SDK");
  assert.ok(body.includes(`${perCall} dollars a call and ${daily} dollar a day`), "the money rules state other dollar defaults");
  assert.ok(body.includes(`${perCallToken} a call\n   and ${dailyToken} a day in $AUTONOMO`), "the money rules state other $AUTONOMO defaults");
  for (const value of [perCall, daily, perCallToken, dailyToken]) {
    assert.ok(body.includes(`(default ${value})`), `the options table doesn't state the default ${value}`);
  }
});

test("the skill never shows a way to pass the wallet key", () => {
  assert.ok(!/--(private-)?key\b/.test(body));
  assert.ok(!/AUTONOMO_WALLET_KEY=/.test(body));
});
