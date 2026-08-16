#!/usr/bin/env python3
from pathlib import Path
import argparse, hashlib, json, shutil, subprocess, sys, tempfile, urllib.request, urllib.parse, zipfile

ACTIONS = {"install", "update", "doctor", "scan"}


def read_json(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception:
        return {}


def digest(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1024 * 1024), b""):
            h.update(b)
    return h.hexdigest()


def _fetch_with_curl(url, out):
    curl = shutil.which("curl")
    if not curl:
        return False

    print("Download transport: curl (15s connect timeout, 180s total timeout, 3 retries)")
    cmd = [
        curl,
        "--fail",
        "--location",
        "--retry", "3",
        "--retry-delay", "1",
        "--connect-timeout", "15",
        "--max-time", "180",
        "--progress-bar",
        "--output", str(out),
        url,
    ]
    result = subprocess.run(cmd)
    if result.returncode != 0:
        if out.exists():
            out.unlink()
        raise RuntimeError(f"curl exited with status {result.returncode}")
    return True


def _fetch_with_urllib(url, out):
    print("Download transport: Python urllib (30s socket timeout)")
    req = urllib.request.Request(url, headers={"User-Agent": "web-dev-agent-kit/1.1"})
    with urllib.request.urlopen(req, timeout=30) as r, open(out, "wb") as f:
        total_header = r.headers.get("Content-Length")
        try:
            total = int(total_header) if total_header else 0
        except ValueError:
            total = 0

        received = 0
        next_report = 10
        while True:
            chunk = r.read(256 * 1024)
            if not chunk:
                break
            f.write(chunk)
            received += len(chunk)

            if total > 0:
                percent = int(received * 100 / total)
                if percent >= next_report:
                    print(f"Download progress: {min(percent, 100)}%", flush=True)
                    next_report += 10
            elif received // (1024 * 1024) > (received - len(chunk)) // (1024 * 1024):
                print(f"Downloaded {received / (1024 * 1024):.1f} MiB", flush=True)

    print(f"Download complete: {out.stat().st_size / (1024 * 1024):.1f} MiB")


def fetch(url, out):
    curl_error = None
    if shutil.which("curl"):
        try:
            _fetch_with_curl(url, out)
            print(f"Download complete: {out.stat().st_size / (1024 * 1024):.1f} MiB")
            return
        except Exception as exc:
            curl_error = exc
            print(f"curl download failed ({exc}); falling back to Python urllib.", file=sys.stderr)

    try:
        _fetch_with_urllib(url, out)
    except Exception as exc:
        if out.exists():
            out.unlink()
        if curl_error:
            raise RuntimeError(f"curl failed: {curl_error}; urllib failed: {exc}") from exc
        raise


def source_for(args, project):
    saved = read_json(project / ".agent-kit-source.json")

    # An explicitly supplied ZIP source always wins.
    if args.source:
        return args.source, args.repo or saved.get("repo"), args.ref or saved.get("ref") or "main"

    # An explicitly supplied repo/ref means the caller intentionally selected a version.
    # This is what lets `npx @ihgen/web-kit@X.Y.Z update` move a project from an older tag.
    if args.repo or args.ref:
        repo = args.repo or saved.get("repo")
        ref = args.ref or saved.get("ref") or "main"
        if not repo:
            raise SystemExit("A GitHub --ref requires --repo or a previously saved repository.")
        return f"https://codeload.github.com/{repo}/zip/{ref}", repo, ref

    # Otherwise reuse the project's remembered source exactly.
    saved_source = saved.get("source")
    saved_repo = saved.get("repo")
    saved_ref = saved.get("ref") or "main"
    if saved_source:
        return saved_source, saved_repo, saved_ref
    if saved_repo:
        return f"https://codeload.github.com/{saved_repo}/zip/{saved_ref}", saved_repo, saved_ref

    raise SystemExit(
        "Use --repo OWNER/REPO or --source ZIP_URL for the first remote action."
    )


def find_root(folder):
    hits = []
    for cli in folder.rglob("scripts/agent-kit.py"):
        root = cli.parent.parent
        if (root / "pack").exists() and (root / "AGENTS.template.md").exists():
            hits.append(root)
    if not hits:
        raise RuntimeError("Kit root not found in downloaded archive.")
    return sorted(hits, key=lambda p: len(p.parts))[0]


def main():
    ap = argparse.ArgumentParser(description="Remote Web Development Agent Kit runner")
    ap.add_argument("--action", choices=sorted(ACTIONS), default="install")
    ap.add_argument("--repo")
    ap.add_argument("--ref")
    ap.add_argument("--source")
    ap.add_argument("--sha256")
    ap.add_argument("--project", default=".")
    ap.add_argument("--force-agents", action="store_true")
    args = ap.parse_args()

    project = Path(args.project).resolve()
    if args.action in {"install", "update"}:
        project.mkdir(parents=True, exist_ok=True)
    elif not project.exists():
        raise SystemExit(f"Project does not exist: {project}")

    src, repo, ref = source_for(args, project)

    with tempfile.TemporaryDirectory(prefix="web-kit-") as td:
        td = Path(td)
        archive = td / "kit.zip"
        local = Path(src).expanduser()

        if local.exists():
            print(f"Using local Web Kit archive: {local}")
            shutil.copy2(local, archive)
        elif src.startswith("file://"):
            local_file = Path(urllib.parse.urlparse(src).path)
            print(f"Using local Web Kit archive: {local_file}")
            shutil.copy2(local_file, archive)
        else:
            print(f"Downloading {src}", flush=True)
            try:
                fetch(src, archive)
            except Exception as exc:
                raise SystemExit(
                    f"Failed to download Web Kit source: {src}\n"
                    f"If this is an npm release, make sure the matching GitHub tag exists before publishing.\n"
                    f"Details: {exc}"
                )

        print("Verifying downloaded archive...", flush=True)
        sha = digest(archive)
        if args.sha256 and sha.lower() != args.sha256.lower():
            raise SystemExit(f"SHA-256 mismatch. Expected {args.sha256}, got {sha}")

        print("Extracting Web Kit...", flush=True)
        extract = td / "extract"
        extract.mkdir()
        with zipfile.ZipFile(archive) as z:
            z.extractall(extract)

        kit = find_root(extract)
        cli = kit / "scripts" / "agent-kit.py"
        cmd = [sys.executable, str(cli), args.action, str(project)]

        if args.action == "install" and args.force_agents:
            cmd.append("--force-agents")

        print(f"Running Web Kit {args.action} against {project}...", flush=True)
        result = subprocess.run(cmd)
        if result.returncode != 0:
            raise SystemExit(result.returncode)

        if args.action in {"install", "update"}:
            (project / ".agent-kit-source.json").write_text(
                json.dumps({
                    "repo": repo,
                    "ref": ref,
                    "source": src,
                    "sha256": sha
                }, indent=2),
                encoding="utf-8"
            )

            bindir = project / ".agent-core" / "bin"
            bindir.mkdir(parents=True, exist_ok=True)
            shutil.copy2(Path(__file__).resolve(), bindir / "remote-install.py")

            print("Remote Web Development Agent Kit action complete.")
            print("Project-aware AGENTS context generated from repository structure and detected stack.")
            print("Future update: python .agent-core/bin/remote-install.py --action update --project .")


if __name__ == "__main__":
    main()
