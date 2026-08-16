#!/usr/bin/env python3
from pathlib import Path
import argparse
import json
import os
import shutil
import site
import subprocess
import sys

STATE_REL = Path(".agent-core/state/graphify-install.json")


def write_state(project, **values):
    path = project / STATE_REL
    path.parent.mkdir(parents=True, exist_ok=True)
    current = {}
    try:
        current = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        pass
    current.update(values)
    path.write_text(json.dumps(current, indent=2), encoding="utf-8")


def find_graphify():
    direct = shutil.which("graphify")
    if direct:
        return direct

    candidates = [
        Path.home() / ".local" / "bin" / "graphify",
        Path.home() / ".local" / "bin" / "graphify.exe",
    ]
    try:
        user_base = Path(site.getuserbase())
        candidates.extend([
            user_base / "bin" / "graphify",
            user_base / "Scripts" / "graphify.exe",
        ])
    except Exception:
        pass

    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    return None


def run(cmd, cwd=None):
    print("+ " + " ".join(str(part) for part in cmd), flush=True)
    return subprocess.run(cmd, cwd=cwd, check=False).returncode


def install_cli():
    # Prefer isolated user-level tool installers. The package name is graphifyy;
    # the command it provides is graphify. Install the MCP extra for broad client support.
    if shutil.which("uv"):
        rc = run(["uv", "tool", "install", "graphifyy[mcp]"])
        if rc == 0:
            return "uv"

    if shutil.which("pipx"):
        rc = run(["pipx", "install", "graphifyy[mcp]"])
        if rc == 0:
            return "pipx"

    # Last resort. This may be rejected by externally-managed Python installations;
    # in that case we report the failure instead of modifying system Python.
    rc = run([sys.executable, "-m", "pip", "install", "--user", "graphifyy[mcp]"])
    if rc == 0:
        return "pip-user"
    return None


def configure_project(project, graphify):
    # Current Graphify supports repo-local installation and discovers supported
    # assistants. This keeps project integration commit-friendly and avoids
    # silently rewriting unrelated global AI configuration.
    return run([graphify, "install", "--project"], cwd=project)


def main():
    parser = argparse.ArgumentParser(description="Install/configure Graphify for a Web-Kit project")
    parser.add_argument("--project", default=".")
    parser.add_argument("--yes", action="store_true", help="Confirm installation without another prompt")
    parser.add_argument("--check", action="store_true", help="Only report Graphify availability")
    args = parser.parse_args()

    project = Path(args.project).resolve()
    graphify = find_graphify()

    if args.check:
        print(json.dumps({
            "installed": bool(graphify),
            "binary": graphify,
            "graph_ready": (project / "graphify-out" / "graph.json").is_file(),
        }, indent=2))
        return 0

    if not args.yes:
        print("Refusing non-confirmed Graphify installation. Re-run with --yes.")
        return 2

    installer = None
    if not graphify:
        print("Graphify is not installed. Installing the user-level Graphify CLI with MCP support...")
        installer = install_cli()
        graphify = find_graphify()
        if not installer or not graphify:
            write_state(
                project,
                installed=False,
                configured=False,
                status="install-failed",
                guidance="Install with `uv tool install \"graphifyy[mcp]\"`, then run `graphify install --project`.",
            )
            print("Graphify installation failed. Web Kit will continue using standard routing.")
            print('Manual option: uv tool install "graphifyy[mcp]"')
            return 0
    else:
        print(f"Graphify CLI detected: {graphify}")

    rc = configure_project(project, graphify)
    configured = rc == 0
    graph_ready = (project / "graphify-out" / "graph.json").is_file()
    write_state(
        project,
        installed=True,
        installer=installer or "existing",
        binary=graphify,
        configured=configured,
        status="ready" if configured else "configuration-failed",
        graph_ready=graph_ready,
        initial_graph_required=not graph_ready,
    )

    if not configured:
        print("Graphify CLI is installed, but repo-local assistant registration failed.")
        print("Web Kit will continue using standard routing until Graphify is ready.")
        return 0

    print("Graphify is installed and registered for supported assistants in this project.")
    if graph_ready:
        print("Existing graph detected. Web Kit's Graph Refresh Gate will keep it current after code-changing steps.")
    else:
        print("Next step: open your coding assistant in this project and run `/graphify .` once to build the initial graph.")
        print("Until graphify-out/graph.json exists, Web Kit automatically uses the standard routing loop.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
