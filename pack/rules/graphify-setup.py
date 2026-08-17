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
BOOTSTRAP_ROLE_REL = Path(".agent-core/state/graphify-bootstrap-role.md")
GRAPH_REL = Path("graphify-out/graph.json")


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
    if shutil.which("uv"):
        rc = run(["uv", "tool", "install", "graphifyy[mcp]"])
        if rc == 0:
            return "uv"

    if shutil.which("pipx"):
        rc = run(["pipx", "install", "graphifyy[mcp]"])
        if rc == 0:
            return "pipx"

    rc = run([sys.executable, "-m", "pip", "install", "--user", "graphifyy[mcp]"])
    if rc == 0:
        return "pip-user"
    return None


def configure_project(project, graphify):
    return run([graphify, "install", "--project"], cwd=project)


def bootstrap_role_text():
    return """# Temporary Role — Build the Initial Graphify Project Graph

This role is temporary and applies to the **current AI coding assistant working in this project**.

## Goal

Create the initial `graphify-out/graph.json` so Web Kit can use refresh-gated Graphify navigation.

## Required action

1. Check whether `graphify-out/graph.json` already exists.
2. If it does not exist, invoke the Graphify skill registered for this assistant and build the graph for the repository root (`.`).
   - In slash-command assistants, use `/graphify .`.
   - In Codex, invoke the installed Graphify skill (`$graphify`) for the repository root.
3. Wait for Graphify to finish and verify that `graphify-out/graph.json` exists.
4. As soon as the graph exists, run:

```bash
python .agent-core/rules/graphify-setup.py --project . --complete
```

5. The completion command deactivates this role and removes this file. Do not continue treating this as an active role after completion.

## Boundaries

- Do not replace the initial Graphify build with broad repository grepping.
- Do not edit application code as part of this temporary role.
- After completion, normal Web Kit rules apply: Graphify is navigation evidence only, freshness is controlled by the Graph Refresh Gate, and exact source/diff/tests/runtime remain authoritative.
"""


def activate_bootstrap_role(project):
    role_path = project / BOOTSTRAP_ROLE_REL
    role_path.parent.mkdir(parents=True, exist_ok=True)
    role_path.write_text(bootstrap_role_text(), encoding="utf-8")
    write_state(
        project,
        bootstrap_role_active=True,
        bootstrap_role_path=BOOTSTRAP_ROLE_REL.as_posix(),
        current_ai_action_required=True,
        completion_command="python .agent-core/rules/graphify-setup.py --project . --complete",
    )


def remove_bootstrap_role(project):
    role_path = project / BOOTSTRAP_ROLE_REL
    if role_path.exists():
        role_path.unlink()
    write_state(
        project,
        bootstrap_role_active=False,
        current_ai_action_required=False,
    )


def initialize_refresh_state(project):
    refresh_script = Path(__file__).with_name("graphify-refresh.py")
    if refresh_script.is_file():
        return run([sys.executable, str(refresh_script), "--project", str(project), "--initialize"], cwd=project)
    return 0


def complete_bootstrap(project):
    graph_ready = (project / GRAPH_REL).is_file()
    if not graph_ready:
        print("Graphify bootstrap cannot complete yet: graphify-out/graph.json is still missing.")
        print("Keep the temporary current-AI role active and build the initial graph first.")
        write_state(
            project,
            graph_ready=False,
            initial_graph_required=True,
            bootstrap_role_active=True,
            current_ai_action_required=True,
            status="awaiting-initial-graph",
        )
        return 2

    remove_bootstrap_role(project)
    write_state(
        project,
        graph_ready=True,
        initial_graph_required=False,
        status="graph-built-awaiting-freshness-gate",
    )
    initialize_refresh_state(project)
    print("Initial Graphify graph detected.")
    print("Temporary current-AI Graphify bootstrap role removed.")
    print("Before the first relationship query, Web Kit's Graph Refresh Gate will confirm/refresh graph freshness.")
    return 0


def main():
    parser = argparse.ArgumentParser(description="Install/configure Graphify for a Web-Kit project")
    parser.add_argument("--project", default=".")
    parser.add_argument("--yes", action="store_true", help="Confirm installation without another prompt")
    parser.add_argument("--check", action="store_true", help="Only report Graphify availability")
    parser.add_argument("--complete", action="store_true", help="Complete and remove the temporary current-AI bootstrap role after graph creation")
    args = parser.parse_args()

    project = Path(args.project).resolve()
    graphify = find_graphify()

    if args.check:
        print(json.dumps({
            "installed": bool(graphify),
            "binary": graphify,
            "graph_ready": (project / GRAPH_REL).is_file(),
            "bootstrap_role_active": (project / BOOTSTRAP_ROLE_REL).is_file(),
            "bootstrap_role_path": BOOTSTRAP_ROLE_REL.as_posix(),
        }, indent=2))
        return 0

    if args.complete:
        return complete_bootstrap(project)

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
                bootstrap_role_active=False,
                guidance='Install with `uv tool install "graphifyy[mcp]"`, then run `graphify install --project`.',
            )
            print("Graphify installation failed. Web Kit will continue using standard routing.")
            print('Manual option: uv tool install "graphifyy[mcp]"')
            return 0
    else:
        print(f"Graphify CLI detected: {graphify}")

    rc = configure_project(project, graphify)
    configured = rc == 0
    graph_ready = (project / GRAPH_REL).is_file()

    if not configured:
        remove_bootstrap_role(project)
        write_state(
            project,
            installed=True,
            installer=installer or "existing",
            binary=graphify,
            configured=False,
            status="configuration-failed",
            graph_ready=graph_ready,
            initial_graph_required=not graph_ready,
        )
        print("Graphify CLI is installed, but repo-local assistant registration failed.")
        print("Web Kit will continue using standard routing until Graphify is ready.")
        return 0

    write_state(
        project,
        installed=True,
        installer=installer or "existing",
        binary=graphify,
        configured=True,
        status="ready" if graph_ready else "awaiting-current-ai-build",
        graph_ready=graph_ready,
        initial_graph_required=not graph_ready,
    )

    print("Graphify is installed and registered for supported assistants in this project.")
    if graph_ready:
        remove_bootstrap_role(project)
        initialize_refresh_state(project)
        print("Existing graph detected. No temporary initial-build role is needed.")
        print("Web Kit's Graph Refresh Gate will control freshness after code-changing steps.")
    else:
        activate_bootstrap_role(project)
        print("Temporary current-AI Graphify bootstrap role activated:")
        print(f"  {BOOTSTRAP_ROLE_REL.as_posix()}")
        print("The current AI should now build the initial graph using its installed Graphify skill.")
        print("After graphify-out/graph.json is created, the role instructs the AI to run the completion command, which removes the temporary role.")
        print("Until completion, Web Kit automatically uses standard repository routing.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
