#!/usr/bin/env node
// Publishes released code to the public repo as one clean commit, with none of this repo's branches, pull requests or
// history. Development stays here; the public repo only ever gets what's on `main`.
//
//   node scripts/release-public.mjs <public repo folder> "<release title>" [--ref origin/main] [--push]
//
// It exports <ref> (default origin/main), leaves out what scripts/public-release.json lists, refuses if the copy holds
// anything that looks secret or any address on the deny list, then replaces the public folder's files with the copy
// and commits. Without --push it stops there, so the commit can be looked over first.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const [target, title] = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1] === "--ref"));
if (!target || !title) {
  console.error('Usage: node scripts/release-public.mjs <public repo folder> "<release title>" [--ref origin/main] [--push]');
  process.exit(1);
}
const ref = option("--ref", "origin/main");
const root = resolve(import.meta.dirname, "..");
const config = JSON.parse(readFileSync(join(root, "scripts", "public-release.json"), "utf8"));
const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const out = resolve(target);
if (!existsSync(join(out, ".git"))) {
  console.error(`${out} isn't a git repo. Clone the public repo there first.`);
  process.exit(1);
}
if (resolve(out) === root) {
  console.error("The public folder can't be this repo.");
  process.exit(1);
}
if (git(out, "status", "--porcelain")) {
  console.error(`${out} has uncommitted changes. Commit or discard them first.`);
  process.exit(1);
}

// 1. Export the released code, without this repo's history.
const sha = git(root, "rev-parse", "--short", ref);
const stage = mkdtempSync(join(tmpdir(), "autonomo-public-"));
execFileSync("git", ["archive", "--format=tar", "-o", join(stage, "code.tar"), ref], { cwd: root });
const copy = join(stage, "code");
mkdirSync(copy);
execFileSync("tar", ["-xf", "code.tar", "-C", "code"], { cwd: stage });
rmSync(join(stage, "code.tar"));

// 2. Leave out what stays private.
for (const p of config.exclude) rmSync(join(copy, p), { recursive: true, force: true });

// 3. Refuse anything that looks secret, and any denied address.
const SECRET = [
  /sk-ant-[A-Za-z0-9_-]{10,}/,
  /\bsk-[A-Za-z0-9]{20,}/,
  /ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /npg_[A-Za-z0-9]{8,}/,
  /postgres(ql)?:\/\/[^\s"'`]*:[^\s"'`@]+@/,
  /alchemy\.com\/v2\/[A-Za-z0-9_-]{10,}/,
  /BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/,
  /\b\d{8,10}:AA[A-Za-z0-9_-]{30,}/,
];
// A well-known test key (Anvil's account 1) that the SDK tests use on purpose; it holds nothing.
const ALLOWED_KEYS = new Set(["0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"]);
const deny = config.deny.map((a) => a.toLowerCase());
const problems = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (statSync(p).size < 2_000_000) {
      const file = relative(copy, p).replaceAll("\\", "/");
      if (/^\.env($|\.)/.test(name) && name !== ".env.example") problems.push(`${file}: an env file`);
      const text = readFileSync(p, "utf8");
      const lower = text.toLowerCase();
      for (const re of SECRET) if (re.test(text)) problems.push(`${file}: looks like a secret (${re.source.slice(0, 24)}…)`);
      for (const a of deny) if (lower.includes(a)) problems.push(`${file}: holds a denied address ${a.slice(0, 10)}…`);
      for (const m of text.matchAll(/(?:private|secret|key)[^\n]{0,40}(0x[0-9a-fA-F]{64})/gi)) {
        if (!ALLOWED_KEYS.has(m[1].toLowerCase())) problems.push(`${file}: a 64-hex value next to "key"`);
      }
    }
  }
};
walk(copy);
if (problems.length) {
  console.error(`Not published. Fix these first:\n- ${[...new Set(problems)].join("\n- ")}`);
  rmSync(stage, { recursive: true, force: true });
  process.exit(1);
}

// 4. Replace the public folder's files with the copy, and commit.
for (const name of readdirSync(out)) if (name !== ".git") rmSync(join(out, name), { recursive: true, force: true });
cpSync(copy, out, { recursive: true });
rmSync(stage, { recursive: true, force: true });
git(out, "add", "-A");
if (!git(out, "status", "--porcelain")) {
  console.log("Nothing changed since the last release.");
  process.exit(0);
}
// Always as Autonomo's own GitHub identity (its no-reply email), never this computer's global git identity.
const { name, email } = config.author;
git(out, "-c", `user.name=${name}`, "-c", `user.email=${email}`, "commit", "-q", "--author", `${name} <${email}>`, "-m", `Release: ${title}`, "-m", `From ${sha}.`);
console.log(`Committed "Release: ${title}" in ${out} (from ${sha}).`);
console.log(git(out, "show", "--stat", "--format=", "HEAD").split("\n").slice(-1)[0]);
if (flag("--push")) {
  git(out, "push", "-q", "origin", "HEAD:main");
  console.log("Pushed.");
} else console.log("Not pushed. Look it over, then run it with --push, or push from that folder.");
