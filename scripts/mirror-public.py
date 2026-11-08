#!/usr/bin/env python3
"""Mirrors main's history to the public repo, cleaned: the commits with their real dates and changes, but without
what stays private (scripts/public-release.json). Pull requests are GitHub pages, not git history, so none go along.

    python scripts/mirror-public.py <public repo URL or path> [--source <repo>] [--push] [--force]

From a fresh clone of main it uses git filter-repo to drop the excluded paths from every commit, redact the denied
addresses, map the author email to the no-reply one, and strip pull request references from messages ("Add X (#28)"
becomes "Add X"; "Merge pull request #2 from org/branch" becomes "Merge: <title>"). The result is the same every
time, so each run only adds the new commits on top of the last. It then scans every commit for anything that looks
secret or denied and refuses if it finds any. --push sends main to the public repo; --force replaces its history
(only for the first mirror).

Needs git-filter-repo (pip install git-filter-repo).
"""

import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG = json.loads((ROOT / "scripts" / "public-release.json").read_text(encoding="utf-8"))

SECRET = [
    rb"sk-ant-[A-Za-z0-9_-]{10,}",
    rb"\bsk-[A-Za-z0-9]{20,}",
    rb"ghp_[A-Za-z0-9]{20,}",
    rb"github_pat_[A-Za-z0-9_]{20,}",
    rb"AKIA[0-9A-Z]{16}",
    rb"npg_[A-Za-z0-9]{8,}",
    rb"postgres(ql)?://[^\s\"'`]*:[^\s\"'`@]+@",
    rb"alchemy\.com/v2/[A-Za-z0-9_-]{10,}",
    rb"BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY",
    rb"\b\d{8,10}:AA[A-Za-z0-9_-]{30,}",
]
# The patterns above, as this repo's own safety scripts spell them, are text, not secrets.
SCANNER_FILES = {"scripts/release-public.mjs", "scripts/mirror-public.py"}
# A well-known test key (Anvil's account 1) that the SDK tests use on purpose; it holds nothing.
ALLOWED_KEYS = {b"0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"}

MESSAGE_CALLBACK = r"""
import re
renames = RENAMES
first, sep, rest = message.partition(bytes([10]))
if first.strip() in renames:
    message = renames[first.strip()] + sep + rest
m = re.match(rb"Merge pull request #\d+ from [^\n]*\n\n(.*)", message, re.S)
if m:
    message = b"Merge: " + m.group(1)
message = re.sub(rb" \(#\d+\)(?=\r?\n|$)", b"", message)
return message
"""


def remove(path):
    """shutil.rmtree that also removes git's read-only files on Windows."""
    def retry(func, p, _):
        os.chmod(p, stat.S_IWRITE)
        func(p)
    shutil.rmtree(path, onerror=retry)


def run(*args, cwd=None, capture=False):
    r = subprocess.run(args, cwd=cwd, check=True, capture_output=capture)
    return r.stdout if capture else None


def filter_repo():
    exe = shutil.which("git-filter-repo")
    if exe:
        return [exe]
    venv = Path(sys.executable).parent / ("git-filter-repo.exe" if sys.platform == "win32" else "git-filter-repo")
    if venv.exists():
        return [str(venv)]
    sys.exit("git-filter-repo isn't installed: pip install git-filter-repo")


def scan(repo: Path) -> list[str]:
    """Every added line in every commit, checked for secrets and denied addresses."""
    deny = [a.lower().encode() for a in CONFIG["deny"]]
    problems = set()
    log = run("git", "log", "-p", "--format=@@COMMIT %h", "main", capture=True, cwd=repo)
    commit, file = "", ""
    for line in log.split(b"\n"):
        if line.startswith(b"@@COMMIT "):
            commit = line[9:].decode()
            continue
        if line.startswith(b"+++ b/"):
            file = line[6:].decode(errors="replace")
            continue
        if not line.startswith(b"+") or line.startswith(b"+++"):
            continue
        low = line.lower()
        for a in deny:
            if a in low:
                problems.add(f"{commit} {file}: a denied address")
        if file not in SCANNER_FILES:
            for pat in SECRET:
                if re.search(pat, line):
                    problems.add(f"{commit} {file}: looks like a secret")
        for m in re.finditer(rb"(?i)(?:private|secret|key).{0,40}(0x[0-9a-f]{64})", line):
            if m.group(1).lower() not in ALLOWED_KEYS:
                problems.add(f"{commit} {file}: a 64-hex value next to 'key'")
    messages = run("git", "log", "--format=%B", "main", capture=True, cwd=repo).lower()
    for a in deny:
        if a in messages:
            problems.add("a commit message holds a denied address")
    return sorted(problems)


def main():
    args = sys.argv[1:]
    if not args or args[0].startswith("--"):
        sys.exit("Usage: python scripts/mirror-public.py <public repo URL or path> [--source <repo>] [--push] [--force]")
    target = args[0]
    source = args[args.index("--source") + 1] if "--source" in args else str(ROOT)
    push, force = "--push" in args, "--force" in args

    work = Path(tempfile.mkdtemp(prefix="autonomo-mirror-"))
    try:
        repo = work / "repo"
        run("git", "clone", "-q", "--no-local", "--single-branch", "--branch", "main", source, str(repo))

        (work / "replace.txt").write_text("".join(f"regex:(?i){re.escape(a)}==>0xREDACTED\n" for a in CONFIG["deny"]), encoding="utf-8")
        author = CONFIG["author"]
        (work / "mailmap").write_text(f"{author['name']} <{author['email']}> <autonomodotfun@gmail.com>\n", encoding="utf-8")
        paths = []
        for p in CONFIG["exclude"]:
            paths += ["--path", p]
        run(
            *filter_repo(), "--force", "--quiet",
            "--invert-paths", *paths,
            "--replace-text", str(work / "replace.txt"),
            "--mailmap", str(work / "mailmap"),
            "--message-callback", MESSAGE_CALLBACK.replace(
                "RENAMES", repr({k.encode(): v.encode() for k, v in CONFIG.get("messages", {}).items()})
            ),
            cwd=repo,
        )

        problems = scan(repo)
        if problems:
            sys.exit("Not published. Fix these first:\n- " + "\n- ".join(problems))
        count = run("git", "rev-list", "--count", "main", capture=True, cwd=repo).decode().strip()
        head = run("git", "log", "-1", "--format=%h %ad %s", "--date=short", "main", capture=True, cwd=repo).decode().strip()
        print(f"Cleaned history: {count} commits, latest {head}")

        if not push:
            out = Path(target)
            if out.exists():
                remove(out)
            shutil.copytree(repo, out)
            print(f"Not pushed. A copy is at {out} to look over.")
            return
        run("git", "remote", "add", "public", target, cwd=repo)
        run("git", "push", "-q", *(["--force"] if force else []), "public", "main:main", cwd=repo)
        print("Pushed." if not force else "Pushed, replacing the public history.")
    finally:
        try:
            remove(work)
        except OSError:
            pass


if __name__ == "__main__":
    main()
