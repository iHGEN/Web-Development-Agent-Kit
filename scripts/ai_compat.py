#!/usr/bin/env python3
from pathlib import Path
import json

ROLE_START = "<!-- WEB-AGENT-KIT:AI-ROLES:START -->"
ROLE_END = "<!-- WEB-AGENT-KIT:AI-ROLES:END -->"
LEGACY_BRIDGE_START = "<!-- WEB-AGENT-KIT:AI-BRIDGE:START -->"
LEGACY_BRIDGE_END = "<!-- WEB-AGENT-KIT:AI-BRIDGE:END -->"
SUMMARY_START = "<!-- WEB-AGENT-KIT:PROJECT-SUMMARY:START -->"
SUMMARY_END = "<!-- WEB-AGENT-KIT:PROJECT-SUMMARY:END -->"


def load_json(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception:
        return {}


def write_json(path, data):
    Path(path).write_text(json.dumps(data, indent=2), encoding="utf-8")


def _replace_marked_section(text, start_marker, end_marker, section):
    if start_marker not in text or end_marker not in text:
        return None
    start = text.index(start_marker)
    end = text.index(end_marker, start) + len(end_marker)
    return text[:start] + section + text[end:]


def _append_without_changing_existing(text, section):
    if not text:
        return section + "\n"
    separator = "" if text.endswith(("\n", "\r")) else "\n"
    return text + separator + "\n" + section + "\n"


def upsert_roles(path, section, initial_content=None):
    """Preserve all user content exactly; only add/replace the Web-Kit roles block."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)

    if not path.exists():
        pieces = []
        if initial_content:
            pieces.append(initial_content.rstrip("\n"))
        pieces.append(section.rstrip("\n"))
        path.write_text("\n\n".join(pieces) + "\n", encoding="utf-8")
        return "created-with-summary-and-roles"

    current = path.read_text(encoding="utf-8", errors="ignore")
    updated = _replace_marked_section(current, ROLE_START, ROLE_END, section)
    if updated is None:
        # Seamlessly migrate the older managed bridge block while preserving everything else byte-for-byte.
        updated = _replace_marked_section(current, LEGACY_BRIDGE_START, LEGACY_BRIDGE_END, section)
    if updated is None:
        updated = _append_without_changing_existing(current, section)
    path.write_text(updated, encoding="utf-8")
    return "preserved-existing-added-roles"


def unmanaged_role_text(path):
    path = Path(path)
    if not path.is_file():
        return ""
    text = path.read_text(encoding="utf-8", errors="ignore")
    for start_marker, end_marker in (
        (ROLE_START, ROLE_END),
        (LEGACY_BRIDGE_START, LEGACY_BRIDGE_END),
    ):
        if start_marker in text and end_marker in text:
            start = text.index(start_marker)
            end = text.index(end_marker, start) + len(end_marker)
            text = text[:start] + text[end:]
    return text


def find_unmanaged_graphify_conflicts(path):
    """Report project-owned instructions that may bypass the canonical refresh gate."""
    lower = unmanaged_role_text(path).lower()
    patterns = {
        "graphify update": "direct Graphify update command outside the managed roles block",
        "graphify query": "Graphify-first query instruction outside the managed roles block",
        "/graphify .": "direct Graphify build/query command outside the managed roles block",
        "always use graphify": "unconditional Graphify-first instruction outside the managed roles block",
        "graphify first": "Graphify-first instruction outside the managed roles block",
    }
    return [message for needle, message in patterns.items() if needle in lower]


def _flatten_stack(profile):
    values = []
    for items in profile.get("technology_groups", {}).values():
        values.extend(items)
    return sorted(set(values))


def project_summary(profile, assistant_name):
    stack = _flatten_stack(profile)
    structure = profile.get("structure", [])[:16]
    manifests = profile.get("manifests", [])[:8]
    tests = profile.get("test_roots", [])[:8]

    def inline(values, empty="none detected"):
        return ", ".join(f"`{value}`" for value in values) if values else empty

    structure_block = "\n".join(structure) if structure else "(no shallow structure detected)"
    return f"""{SUMMARY_START}
# Project Summary — {profile.get('name', 'Web Project')}

This summary was created only because this {assistant_name} project-instruction file did not already exist. Web Kit will not rewrite this summary on later updates. Current machine-readable project metadata lives in `.agent-core/index/project-profile.json`.

- **Project:** `{profile.get('name', 'unknown')}`
- **Domain:** Web Development
- **Detected stack:** {inline(stack)}
- **Manifests/build files:** {inline(manifests)}
- **Test roots:** {inline(tests)}

## Shallow project map

```text
{structure_block}
```

{SUMMARY_END}"""


def roles_markdown(assistant_name):
    return f"""{ROLE_START}
## iHGEN Web Development Agent Kit — {assistant_name} Roles

Preserve all project/user instructions outside this managed block. This block adds Web-Kit roles; it does not replace this file.

For Web-Kit-managed engineering work:

1. Follow `.agent-core/rules/workflow.md` as the single lifecycle.
2. Follow `.agent-core/rules/repository-navigation.md` for question-aware repository navigation.
3. Read `.agent-core/index/project-profile.json` first for lightweight project routing metadata.
4. Use `.agent-core/routing/context-policy.json` to keep context bounded and activate only the roles/skills needed for the current step.
5. Act only in the role routed for the current phase: Captain, discovery/indexing/router, architect/planner, implementation worker, specialist reviewer, Handoff Validator, or Final Integration Validator.
6. Never self-approve a plan, implementation handoff, or final integration result when the workflow requires an independent validator.
7. For exact text/symbol/path lookup, use targeted current-source search (`rg` or equivalent) directly.
8. For relationship/dependency/ownership/impact discovery, use Graphify first only when the Graph Refresh Gate reports a fresh graph; then verify exact source before planning or editing.
9. Never run `graphify update .` directly as a replacement for the managed Graph Refresh Gate.
10. Current source, current diff, tests/build, and runtime evidence override Graphify/index summaries.

If project-owned instructions outside this block conflict with Web-Kit workflow mechanics, preserve them but report the conflict with `doctor`; do not silently delete user content.
{ROLE_END}"""


def cursor_initial(profile):
    return """---
description: Project instructions and iHGEN Web Kit roles
alwaysApply: true
---

""" + project_summary(profile, "Cursor")


def apply_ai_compatibility(project, canonical_path=None, profile=None):
    project = Path(project).resolve()
    profile = profile or load_json(project / ".agent-core" / "index" / "project-profile.json")

    targets = {
        "agents": (project / "AGENTS.md", "AGENTS-compatible assistants"),
        "claude": (project / "CLAUDE.md", "Claude Code"),
        "gemini": (project / "GEMINI.md", "Gemini CLI"),
        "github-copilot": (project / ".github" / "copilot-instructions.md", "GitHub Copilot"),
    }

    actions = {}
    for key, (path, label) in targets.items():
        actions[key] = upsert_roles(
            path,
            roles_markdown(label),
            initial_content=project_summary(profile, label),
        )

    cursor_path = project / ".cursor" / "rules" / "ihgen-web-kit.mdc"
    actions["cursor"] = upsert_roles(
        cursor_path,
        roles_markdown("Cursor"),
        initial_content=cursor_initial(profile),
    )

    compatibility = {
        "canonical_instructions": "AGENTS.md",
        "canonical_workflow": ".agent-core/rules/workflow.md",
        "canonical_navigation_rule": ".agent-core/rules/repository-navigation.md",
        "native_agents_md": ["codex", "kimi", "agents-md-compatible"],
        "managed_roles": {
            "agents": "AGENTS.md",
            "claude": "CLAUDE.md",
            "gemini": "GEMINI.md",
            "github-copilot": ".github/copilot-instructions.md",
            "cursor": ".cursor/rules/ihgen-web-kit.mdc",
        },
        "file_policy": "Existing instruction files are preserved; Web Kit changes only its marked roles block. Missing instruction files are created once with a project summary plus the roles block.",
        "actions": actions,
    }

    cfg_path = project / ".agent-kit.json"
    cfg = load_json(cfg_path)
    if cfg:
        cfg["ai_compatibility"] = compatibility
        write_json(cfg_path, cfg)

    profile_path = project / ".agent-core" / "index" / "project-profile.json"
    current_profile = load_json(profile_path)
    if current_profile:
        current_profile["ai_compatibility"] = compatibility
        write_json(profile_path, current_profile)

    return compatibility
