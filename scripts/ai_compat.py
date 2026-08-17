#!/usr/bin/env python3
from pathlib import Path
import json

BRIDGE_START = "<!-- WEB-AGENT-KIT:AI-BRIDGE:START -->"
BRIDGE_END = "<!-- WEB-AGENT-KIT:AI-BRIDGE:END -->"


def load_json(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception:
        return {}


def write_json(path, data):
    Path(path).write_text(json.dumps(data, indent=2), encoding="utf-8")


def upsert_section(path, section):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        current = path.read_text(encoding="utf-8", errors="ignore")
        if BRIDGE_START in current and BRIDGE_END in current:
            before = current.split(BRIDGE_START, 1)[0].rstrip()
            after = current.split(BRIDGE_END, 1)[1].lstrip("\r\n")
            pieces = [before, section.rstrip()]
            if after:
                pieces.append(after.rstrip())
            content = "\n\n".join(piece for piece in pieces if piece) + "\n"
        else:
            content = current.rstrip() + "\n\n" + section.rstrip() + "\n"
    else:
        content = section.rstrip() + "\n"
    path.write_text(content, encoding="utf-8")


def unmanaged_bridge_text(path):
    path = Path(path)
    if not path.is_file():
        return ""
    text = path.read_text(encoding="utf-8", errors="ignore")
    if BRIDGE_START not in text or BRIDGE_END not in text:
        return text
    before = text.split(BRIDGE_START, 1)[0]
    after = text.split(BRIDGE_END, 1)[1]
    return before + "\n" + after


def find_unmanaged_graphify_conflicts(path):
    """Report project-owned instructions that may bypass the canonical refresh gate."""
    lower = unmanaged_bridge_text(path).lower()
    patterns = {
        "graphify update": "direct Graphify update command outside the managed bridge",
        "graphify query": "Graphify-first query instruction outside the managed bridge",
        "/graphify .": "direct Graphify build/query command outside the managed bridge",
        "always use graphify": "unconditional Graphify-first instruction outside the managed bridge",
        "graphify first": "Graphify-first instruction outside the managed bridge",
    }
    return [message for needle, message in patterns.items() if needle in lower]


def bridge_markdown(canonical_file, assistant_name):
    return f"""{BRIDGE_START}
## iHGEN Web Development Agent Kit — {assistant_name} bridge

This project uses one **vendor-neutral canonical agent workflow**. Do not invent a separate {assistant_name}-specific lifecycle.

Before repository-changing work:

1. Read `{canonical_file}` for project context and Web-Kit authority.
2. Follow `.agent-core/rules/workflow.md` as the installed canonical lifecycle.
3. Use `.agent-core/index/project-profile.json` and `.agent-core/routing/context-policy.json` for routed context instead of broad repository ingestion.
4. If Graphify may be used, run the Graph Refresh Gate first: `python .agent-core/rules/graphify-refresh.py --project . --task-id <task-id>`.
5. Never run `graphify update .` directly as a substitute for the gate. The gate owns refresh cadence, metadata synchronization, and standard-mode fallback.
6. Use Graphify only when `.agent-core/state/graphify.json` reports `routing_mode: graphify-assisted` and `dirty: false`; otherwise use the standard repository-navigation branch.
7. Graphify is navigation evidence only. Current source, diffs, tests, and runtime evidence remain authoritative.
8. Preserve any user/project-specific instructions in this file, but if they conflict with the canonical lifecycle, the Web-Kit lifecycle controls Web-Kit-managed work and `doctor` should report the conflict.

Codex and Kimi consume `AGENTS.md` directly. Claude, Gemini, Cursor, GitHub Copilot, and other assistants use managed bridge files so the same workflow is applied without duplicating the rules.
{BRIDGE_END}"""


def cursor_bridge(canonical_file):
    body = bridge_markdown(canonical_file, "Cursor")
    return """---
description: iHGEN Web Development Agent Kit canonical workflow bridge
alwaysApply: true
---

""" + body


def apply_ai_compatibility(project, canonical_path):
    project = Path(project).resolve()
    canonical_path = Path(canonical_path)
    canonical_file = canonical_path.name

    # If a user-owned AGENTS.md was preserved, bridge native AGENTS consumers into
    # the generated AGENTS.web-kit.md without turning the user file into a Web-Kit-owned file.
    if canonical_file != "AGENTS.md" and (project / "AGENTS.md").exists():
        upsert_section(project / "AGENTS.md", bridge_markdown(canonical_file, "AGENTS-compatible assistants"))

    targets = {
        "claude": project / "CLAUDE.md",
        "gemini": project / "GEMINI.md",
        "github-copilot": project / ".github" / "copilot-instructions.md",
    }
    for assistant, path in targets.items():
        label = {
            "claude": "Claude Code",
            "gemini": "Gemini CLI",
            "github-copilot": "GitHub Copilot",
        }[assistant]
        upsert_section(path, bridge_markdown(canonical_file, label))

    cursor_path = project / ".cursor" / "rules" / "ihgen-web-kit.mdc"
    cursor_path.parent.mkdir(parents=True, exist_ok=True)
    cursor_path.write_text(cursor_bridge(canonical_file), encoding="utf-8")

    compatibility = {
        "canonical_instructions": canonical_file,
        "canonical_workflow": ".agent-core/rules/workflow.md",
        "native_agents_md": ["codex", "kimi", "agents-md-compatible"],
        "managed_bridges": {
            "claude": "CLAUDE.md",
            "gemini": "GEMINI.md",
            "github-copilot": ".github/copilot-instructions.md",
            "cursor": ".cursor/rules/ihgen-web-kit.mdc",
        },
        "policy": "One canonical workflow; assistant-specific files are thin bridges only.",
    }

    cfg_path = project / ".agent-kit.json"
    cfg = load_json(cfg_path)
    if cfg:
        cfg["ai_compatibility"] = compatibility
        write_json(cfg_path, cfg)

    profile_path = project / ".agent-core" / "index" / "project-profile.json"
    profile = load_json(profile_path)
    if profile:
        profile["ai_compatibility"] = compatibility
        write_json(profile_path, profile)

    return compatibility
