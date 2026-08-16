#!/usr/bin/env python3
from pathlib import Path
import argparse
import datetime as dt
import hashlib
import json
import os
import shutil
import subprocess

STATE_REL = Path(".agent-core/state/graphify.json")
GRAPH_REL = Path("graphify-out/graph.json")
IGNORED_PARTS = {
    ".git", ".agent-core", ".agents", "graphify-out", "node_modules", "vendor",
    "bin", "obj", ".next", "dist", "build", "coverage", ".cache", ".idea", ".vscode"
}
MAX_CONTENT_HASH_BYTES = 5 * 1024 * 1024


def now_iso():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def load_json(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception:
        return {}


def write_json_atomic(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    tmp.replace(path)


def ignored(rel):
    rel = Path(rel)
    return any(part in IGNORED_PARTS for part in rel.parts)


def run_git(project, args):
    if not shutil.which("git") or not (project / ".git").exists():
        return None
    result = subprocess.run(
        ["git", "-C", str(project), *args],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    if result.returncode != 0:
        return None
    return result.stdout


def nul_paths(project, args):
    raw = run_git(project, args)
    if raw is None:
        return []
    return [
        Path(item.decode("utf-8", errors="surrogateescape"))
        for item in raw.split(b"\0")
        if item
    ]


def file_signature(path):
    if not path.exists():
        return "deleted"
    try:
        stat = path.stat()
    except OSError:
        return "unreadable"

    if path.is_file() and stat.st_size <= MAX_CONTENT_HASH_BYTES:
        h = hashlib.sha256()
        try:
            with path.open("rb") as handle:
                for chunk in iter(lambda: handle.read(256 * 1024), b""):
                    h.update(chunk)
            return f"sha256:{h.hexdigest()}"
        except OSError:
            pass

    return f"stat:{stat.st_size}:{stat.st_mtime_ns}"


def git_fingerprint(project):
    head_raw = run_git(project, ["rev-parse", "HEAD"])
    if head_raw is None:
        return None

    changed = set()
    changed.update(nul_paths(project, ["diff", "--name-only", "-z"]))
    changed.update(nul_paths(project, ["diff", "--cached", "--name-only", "-z"]))
    changed.update(nul_paths(project, ["ls-files", "--others", "--exclude-standard", "-z"]))
    changed = sorted(rel for rel in changed if not ignored(rel))

    h = hashlib.sha256()
    head = head_raw.decode("ascii", errors="ignore").strip()
    h.update(f"HEAD:{head}\n".encode())
    for rel in changed:
        h.update(rel.as_posix().encode("utf-8", errors="surrogateescape"))
        h.update(b"\0")
        h.update(file_signature(project / rel).encode())
        h.update(b"\n")

    return {
        "method": "git-working-tree",
        "fingerprint": h.hexdigest(),
        "head": head,
        "changed_files": [rel.as_posix() for rel in changed[:200]],
        "changed_file_count": len(changed),
    }


def filesystem_fingerprint(project):
    h = hashlib.sha256()
    count = 0
    for current_root, dirnames, filenames in os.walk(project):
        current = Path(current_root)
        dirnames[:] = [name for name in dirnames if name not in IGNORED_PARTS]
        for filename in sorted(filenames):
            path = current / filename
            try:
                rel = path.relative_to(project)
            except ValueError:
                continue
            if ignored(rel):
                continue
            try:
                stat = path.stat()
            except OSError:
                continue
            h.update(rel.as_posix().encode("utf-8", errors="surrogateescape"))
            h.update(f":{stat.st_size}:{stat.st_mtime_ns}\n".encode())
            count += 1
    return {
        "method": "filesystem-stat",
        "fingerprint": h.hexdigest(),
        "head": None,
        "changed_files": [],
        "changed_file_count": count,
    }


def project_fingerprint(project):
    return git_fingerprint(project) or filesystem_fingerprint(project)


def base_state(project, fingerprint):
    graph_ready = (project / GRAPH_REL).is_file()
    return {
        "version": 1,
        "graph_path": GRAPH_REL.as_posix(),
        "graph_ready": graph_ready,
        "routing_mode": "graphify-assisted" if graph_ready else "standard",
        "fallback_mode": "standard",
        "dirty": graph_ready,
        "fingerprint_method": fingerprint["method"],
        "current_fingerprint": fingerprint["fingerprint"],
        "last_successful_fingerprint": None,
        "changed_files": fingerprint["changed_files"],
        "changed_file_count": fingerprint["changed_file_count"],
        "last_refresh_status": "needs-refresh" if graph_ready else "not-ready",
        "last_refresh_at": None,
        "fallback_for_task": False,
        "fallback_task_id": None,
        "last_error": None,
        "command": "graphify update .",
        "updated_at": now_iso(),
    }


def save_state(project, state):
    state["updated_at"] = now_iso()
    write_json_atomic(project / STATE_REL, state)


def initialize(project):
    fingerprint = project_fingerprint(project)
    state_path = project / STATE_REL
    existing = load_json(state_path)
    state = base_state(project, fingerprint)
    if existing:
        state["last_successful_fingerprint"] = existing.get("last_successful_fingerprint")
        state["last_refresh_at"] = existing.get("last_refresh_at")
        state["last_refresh_status"] = existing.get("last_refresh_status", state["last_refresh_status"])
        state["fallback_for_task"] = existing.get("fallback_for_task", False)
        state["fallback_task_id"] = existing.get("fallback_task_id")
        state["last_error"] = existing.get("last_error")
        state["dirty"] = state["graph_ready"] and (
            state["current_fingerprint"] != state["last_successful_fingerprint"]
        )
    save_state(project, state)
    print(
        "Graph Refresh Gate initialized: "
        + ("refresh required before Graphify use" if state["dirty"] else state["routing_mode"])
    )
    return 0


def status(project):
    fingerprint = project_fingerprint(project)
    state = load_json(project / STATE_REL) or base_state(project, fingerprint)
    state["graph_ready"] = (project / GRAPH_REL).is_file()
    state["current_fingerprint"] = fingerprint["fingerprint"]
    state["fingerprint_method"] = fingerprint["method"]
    state["changed_files"] = fingerprint["changed_files"]
    state["changed_file_count"] = fingerprint["changed_file_count"]
    state["dirty"] = state["graph_ready"] and (
        state.get("last_successful_fingerprint") != fingerprint["fingerprint"]
    )
    print(json.dumps(state, indent=2))
    return 0


def mark_fallback(project, state, task_id, fingerprint, status_name, error):
    state.update({
        "graph_ready": (project / GRAPH_REL).is_file(),
        "routing_mode": "standard",
        "dirty": True,
        "fingerprint_method": fingerprint["method"],
        "current_fingerprint": fingerprint["fingerprint"],
        "changed_files": fingerprint["changed_files"],
        "changed_file_count": fingerprint["changed_file_count"],
        "last_refresh_status": status_name,
        "fallback_for_task": True,
        "fallback_task_id": task_id,
        "last_error": str(error),
    })
    save_state(project, state)
    label = task_id or "(unspecified)"
    print(f"Graph Refresh Gate: {error}. Using standard routing for task {label}.")
    return 0


def refresh(project, task_id, retry, timeout):
    graph_path = project / GRAPH_REL
    fingerprint = project_fingerprint(project)
    state_path = project / STATE_REL
    state = load_json(state_path) or base_state(project, fingerprint)

    if not graph_path.is_file():
        state.update({
            "graph_ready": False,
            "routing_mode": "standard",
            "dirty": False,
            "fingerprint_method": fingerprint["method"],
            "current_fingerprint": fingerprint["fingerprint"],
            "changed_files": fingerprint["changed_files"],
            "changed_file_count": fingerprint["changed_file_count"],
            "last_refresh_status": "not-ready",
            "fallback_for_task": False,
            "fallback_task_id": None,
            "last_error": None,
        })
        save_state(project, state)
        print("Graph Refresh Gate: no graphify-out/graph.json; using standard routing.")
        return 0

    if (
        not retry
        and task_id
        and state.get("fallback_for_task")
        and state.get("fallback_task_id") == task_id
    ):
        state.update({
            "routing_mode": "standard",
            "dirty": True,
            "current_fingerprint": fingerprint["fingerprint"],
            "fingerprint_method": fingerprint["method"],
            "changed_files": fingerprint["changed_files"],
            "changed_file_count": fingerprint["changed_file_count"],
        })
        save_state(project, state)
        print(f"Graph Refresh Gate: Graphify already fell back for task {task_id}; continuing in standard mode.")
        return 0

    if state.get("last_successful_fingerprint") == fingerprint["fingerprint"]:
        state.update({
            "graph_ready": True,
            "routing_mode": "graphify-assisted",
            "dirty": False,
            "current_fingerprint": fingerprint["fingerprint"],
            "fingerprint_method": fingerprint["method"],
            "changed_files": fingerprint["changed_files"],
            "changed_file_count": fingerprint["changed_file_count"],
            "last_refresh_status": "clean",
            "fallback_for_task": False,
            "fallback_task_id": None,
            "last_error": None,
        })
        save_state(project, state)
        print("Graph Refresh Gate: repository state unchanged since last successful refresh; no Graphify update needed.")
        return 0

    graphify = os.environ.get("WEB_KIT_GRAPHIFY_BIN") or shutil.which("graphify")
    if not graphify:
        return mark_fallback(
            project, state, task_id, fingerprint, "unavailable",
            "Graphify CLI is not available on PATH"
        )

    print("Graph Refresh Gate: repository changed; running one incremental `graphify update .` refresh...", flush=True)
    try:
        result = subprocess.run(
            [graphify, "update", "."],
            cwd=project,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return mark_fallback(
            project, state, task_id, fingerprint, "timeout",
            f"Graphify refresh exceeded {timeout}s"
        )
    except Exception as exc:
        return mark_fallback(project, state, task_id, fingerprint, "failed", exc)

    if result.returncode != 0:
        return mark_fallback(
            project, state, task_id, fingerprint, "failed",
            f"Graphify refresh exited with status {result.returncode}"
        )

    refreshed = project_fingerprint(project)
    state.update({
        "graph_ready": graph_path.is_file(),
        "routing_mode": "graphify-assisted" if graph_path.is_file() else "standard",
        "dirty": False,
        "fingerprint_method": refreshed["method"],
        "current_fingerprint": refreshed["fingerprint"],
        "last_successful_fingerprint": refreshed["fingerprint"],
        "changed_files": refreshed["changed_files"],
        "changed_file_count": refreshed["changed_file_count"],
        "last_refresh_status": "success",
        "last_refresh_at": now_iso(),
        "fallback_for_task": False,
        "fallback_task_id": None,
        "last_error": None,
    })
    save_state(project, state)
    print("Graph Refresh Gate: refresh succeeded; graphify-assisted routing is fresh.")
    return 0


def main():
    parser = argparse.ArgumentParser(description="Web Kit Graphify freshness gate")
    parser.add_argument("--project", default=".")
    parser.add_argument("--task-id", default=None)
    parser.add_argument("--initialize", action="store_true")
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--retry", action="store_true", help="Retry Graphify after a task-local fallback")
    parser.add_argument(
        "--timeout",
        type=int,
        default=int(os.environ.get("WEB_KIT_GRAPHIFY_TIMEOUT", "300")),
    )
    args = parser.parse_args()

    project = Path(args.project).resolve()
    if args.initialize:
        raise SystemExit(initialize(project))
    if args.status:
        raise SystemExit(status(project))
    raise SystemExit(refresh(project, args.task_id, args.retry, args.timeout))


if __name__ == "__main__":
    main()
