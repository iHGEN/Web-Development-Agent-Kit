#!/usr/bin/env python3
from pathlib import Path
import json
import os

MANAGED_MARKER = "<!-- WEB-AGENT-KIT:MANAGED -->"
PROJECT_CONTEXT_START = "<!-- WEB-AGENT-KIT:PROJECT-CONTEXT:START -->"
PROJECT_CONTEXT_END = "<!-- WEB-AGENT-KIT:PROJECT-CONTEXT:END -->"

IGNORE_DIRS = {
    ".git", ".agents", ".agent-core", "node_modules", "vendor", "bin", "obj",
    ".next", "dist", "build", "coverage", ".idea", ".vscode", ".cache"
}

ALLOWED_HIDDEN_DIRS = {".github", ".devcontainer"}

IMPORTANT_ROOT_FILES = {
    "package.json", "composer.json", "tsconfig.json", "pyproject.toml", "go.mod",
    "Cargo.toml", "Dockerfile", "docker-compose.yml", "docker-compose.yaml",
    "compose.yml", "compose.yaml", "pnpm-workspace.yaml", "turbo.json", "nx.json",
    "vite.config.ts", "vite.config.js", "next.config.js", "next.config.mjs",
    "next.config.ts", "artisan"
}

CATEGORY_LABELS = {
    "languages": "Languages",
    "frontend": "Frontend",
    "backend": "Backend",
    "api-realtime": "API / Realtime",
    "auth": "Authentication / Authorization",
    "data": "Data / ORM",
    "distributed-jobs": "Distributed / Jobs",
    "storage-media": "Storage / Media",
    "testing": "Testing",
    "observability-performance": "Observability / Performance",
    "devops-delivery": "DevOps / Delivery",
    "packages": "Package Management",
    "integrations": "Integrations",
    "architecture-patterns": "Architecture"
}


def load_json(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception:
        return {}


def detect_project_name(project):
    project = Path(project).resolve()

    package = load_json(project / "package.json")
    name = package.get("name")
    if isinstance(name, str) and name.strip():
        return name.strip()

    composer = load_json(project / "composer.json")
    name = composer.get("name")
    if isinstance(name, str) and name.strip():
        return name.strip()

    sln = sorted(project.glob("*.sln"))
    if sln:
        return sln[0].stem

    csproj = sorted(project.glob("*.csproj"))
    if csproj:
        return csproj[0].stem

    return project.name


def build_structure_summary(project, max_depth=2, max_entries=70):
    """Build a shallow structural map without walking dependency/build directories."""
    project = Path(project).resolve()
    directories = set()
    root_files = set()

    for current_root, dirnames, filenames in os.walk(project):
        current = Path(current_root)
        try:
            rel_root = current.relative_to(project)
        except ValueError:
            continue

        # Prune ignored and irrelevant hidden directories before os.walk descends into them.
        dirnames[:] = [
            name for name in dirnames
            if name not in IGNORE_DIRS
            and (not name.startswith(".") or name in ALLOWED_HIDDEN_DIRS)
        ]

        depth = 0 if rel_root == Path(".") else len(rel_root.parts)
        if depth >= max_depth:
            dirnames[:] = []

        for dirname in dirnames:
            rel_dir = (rel_root / dirname) if rel_root != Path(".") else Path(dirname)
            if 1 <= len(rel_dir.parts) <= max_depth:
                directories.add(rel_dir.as_posix() + "/")

        if depth == 0:
            for filename in filenames:
                p = Path(filename)
                if filename in IMPORTANT_ROOT_FILES or p.suffix.lower() in {".sln", ".csproj"}:
                    root_files.add(filename)

        if len(directories) + len(root_files) >= max_entries * 2:
            # Enough candidates for a deterministic capped summary.
            break

    entries = sorted(directories) + sorted(root_files)
    return entries[:max_entries]


def group_detected_skills(skills, kit_root):
    catalog = load_json(Path(kit_root) / "pack" / "router" / "skill-catalog.json")
    category_by_skill = {
        item.get("name"): item.get("category")
        for item in catalog.get("skills", [])
        if isinstance(item, dict)
    }

    grouped = {}
    for skill in skills:
        category = category_by_skill.get(skill)
        if category not in CATEGORY_LABELS:
            continue
        grouped.setdefault(CATEGORY_LABELS[category], []).append(skill)

    return {
        label: sorted(set(values))
        for label, values in grouped.items()
        if values
    }


def build_project_profile(project, kit_root, version):
    project = Path(project).resolve()
    cfg = load_json(project / ".agent-kit.json")
    index = load_json(project / ".agent-core" / "index" / "project-index.json")
    skills = cfg.get("detected_skills", []) if isinstance(cfg.get("detected_skills", []), list) else []

    return {
        "name": detect_project_name(project),
        "directory": project.name,
        "domain": "web",
        "kit_version": version,
        "technology_groups": group_detected_skills(skills, kit_root),
        "detected_skills": sorted(set(skills)),
        "structure": build_structure_summary(project),
        "manifests": index.get("manifests", []),
        "config_files": index.get("config_files", []),
        "test_roots": index.get("test_roots", []),
        "migration_roots": index.get("migration_roots", []),
        "source": "Generated from lightweight structural discovery; source contents are not embedded."
    }


def _bullet_list(values, empty="None detected"):
    if not values:
        return f"- {empty}"
    return "\n".join(f"- `{value}`" for value in values)


def render_project_context(profile):
    technology_lines = []
    for label, values in profile.get("technology_groups", {}).items():
        technology_lines.append(f"- **{label}:** " + ", ".join(f"`{v}`" for v in values))
    if not technology_lines:
        technology_lines.append("- No framework/language-specific skills were strongly detected yet; use routed discovery before assuming a stack.")

    structure = profile.get("structure", [])
    structure_block = "\n".join(structure) if structure else "(No shallow structure detected)"

    return f"""{MANAGED_MARKER}
{PROJECT_CONTEXT_START}
# Project Agent Context — {profile.get('name', 'Web Project')}

This section is generated by the Web Development Agent Kit installer and is intentionally lightweight.
Use it for **initial routing**, then verify exact behavior with targeted discovery before making changes.

## Project Identity

- **Project name:** `{profile.get('name', 'unknown')}`
- **Project directory:** `{profile.get('directory', 'unknown')}`
- **Development domain:** Web Development
- **Web Kit version:** `{profile.get('kit_version', 'unknown')}`

## Detected Technology Stack

{chr(10).join(technology_lines)}

## Project Structure — Shallow Routing Map

```text
{structure_block}
```

This is a routing map, not permission to read every listed directory.
The Context Router still controls which files/symbols each agent may inspect.

## Important Manifests / Build Files

{_bullet_list(profile.get('manifests', []))}

## Important Configuration Files

{_bullet_list(profile.get('config_files', []))}

## Test Roots

{_bullet_list(profile.get('test_roots', []))}

## Migration / Data Change Roots

{_bullet_list(profile.get('migration_roots', []))}

## Project-aware Routing Rules

- Read this generated project context before selecting agents or skills.
- Treat detected technologies as routing evidence, not as proof that every part of the repository uses them.
- Start from the user-requested feature and route only the relevant project slice.
- Do not read the entire repository because it appears in the structure map.
- Prefer existing project conventions and ownership discovered from the code over generic framework assumptions.
- If the repository structure or stack changes materially, regenerate the project profile with the Web Kit update/install command.
- The machine-readable copy of this profile is `.agent-core/index/project-profile.json`.

{PROJECT_CONTEXT_END}

---
"""


def is_kit_managed(content):
    if MANAGED_MARKER in content:
        return True
    # Recognize pre-project-profile Web Kit AGENTS files so upgrades can migrate them safely.
    return "# Web Development Agent Kit v1" in content and "## Canonical workflow authority" in content


def apply_project_profile(project, kit_root=None, version=None, force_agents=False):
    project = Path(project).resolve()
    kit_root = Path(kit_root).resolve() if kit_root else Path(__file__).resolve().parents[1]
    if version is None:
        version_file = kit_root / "VERSION"
        version = version_file.read_text(encoding="utf-8").strip() if version_file.exists() else "unknown"

    profile = build_project_profile(project, kit_root, version)
    template = (kit_root / "AGENTS.template.md").read_text(encoding="utf-8")
    generated = render_project_context(profile) + template.rstrip() + "\n"

    agents_path = project / "AGENTS.md"
    fallback_path = project / "AGENTS.web-kit.md"

    if agents_path.exists():
        existing = agents_path.read_text(encoding="utf-8", errors="ignore")
        if force_agents or is_kit_managed(existing):
            agents_path.write_text(generated, encoding="utf-8")
            if fallback_path.exists():
                fallback_path.unlink()
            output_path = agents_path
            action = "updated project-aware AGENTS.md"
        else:
            fallback_path.write_text(generated, encoding="utf-8")
            output_path = fallback_path
            action = "preserved existing AGENTS.md; wrote project-aware AGENTS.web-kit.md"
    else:
        agents_path.write_text(generated, encoding="utf-8")
        if fallback_path.exists():
            fallback_path.unlink()
        output_path = agents_path
        action = "wrote project-aware AGENTS.md"

    index_dir = project / ".agent-core" / "index"
    index_dir.mkdir(parents=True, exist_ok=True)
    (index_dir / "project-profile.json").write_text(json.dumps(profile, indent=2), encoding="utf-8")

    cfg_path = project / ".agent-kit.json"
    cfg = load_json(cfg_path)
    if cfg:
        cfg["project"] = {
            "name": profile["name"],
            "directory": profile["directory"],
            "domain": profile["domain"],
            "technology_groups": profile["technology_groups"]
        }
        cfg_path.write_text(json.dumps(cfg, indent=2), encoding="utf-8")

    return {
        "path": str(output_path),
        "action": action,
        "profile": profile
    }


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Generate project-aware AGENTS.md context")
    parser.add_argument("project", nargs="?", default=".")
    parser.add_argument("--force-agents", action="store_true")
    args = parser.parse_args()

    result = apply_project_profile(args.project, force_agents=args.force_agents)
    print(result["action"])
    print(f"Project: {result['profile']['name']}")


if __name__ == "__main__":
    main()
