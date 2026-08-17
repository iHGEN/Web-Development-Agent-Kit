#!/usr/bin/env python3
from pathlib import Path
import argparse, json, os, shutil, subprocess, sys, re
from project_profile import apply_project_profile
from ai_compat import apply_ai_compatibility, find_unmanaged_graphify_conflicts

KIT_ROOT = Path(__file__).resolve().parents[1]
PACK = KIT_ROOT / "pack"
VERSION = (KIT_ROOT / "VERSION").read_text(encoding="utf-8").strip()

IGNORE_DIRS = {
    ".git", ".agents", ".agent-core", "node_modules", "vendor", "bin", "obj",
    ".next", "dist", "build", "coverage", ".idea", ".vscode", ".cache",
    "graphify-out"
}


def walk_files(project):
    project = project.resolve()
    for current_root, dirnames, filenames in os.walk(project):
        current = Path(current_root)
        dirnames[:] = [name for name in dirnames if name not in IGNORE_DIRS]
        try:
            rel_root = current.relative_to(project)
        except ValueError:
            continue
        for filename in filenames:
            p = current / filename
            rel = (rel_root / filename) if rel_root != Path(".") else Path(filename)
            yield p, rel


def build_project_index(project):
    project = project.resolve()
    files = list(walk_files(project))
    extension_counts = {}
    top_dirs = set()
    manifests = []
    test_roots = set()
    migration_roots = set()
    config_files = []

    manifest_names = {
        "package.json", "composer.json", "tsconfig.json", "pyproject.toml",
        "go.mod", "Cargo.toml", "Dockerfile", "docker-compose.yml",
        "docker-compose.yaml", "compose.yml", "compose.yaml"
    }

    for p, rel in files:
        if rel.parts:
            top_dirs.add(rel.parts[0])
        suffix = rel.suffix.lower() or "<none>"
        extension_counts[suffix] = extension_counts.get(suffix, 0) + 1

        if rel.name in manifest_names or rel.suffix.lower() in {".csproj", ".sln"}:
            manifests.append(rel.as_posix())

        lower_parts = [x.lower() for x in rel.parts]
        if any(x in {"test", "tests", "__tests__", "spec", "specs"} for x in lower_parts):
            if len(rel.parts) > 1:
                test_roots.add(rel.parts[0])

        if "migrations" in lower_parts or "migration" in lower_parts:
            if len(rel.parts) > 1:
                migration_roots.add(rel.parts[0])

        if rel.name.lower() in {
            "appsettings.json", "appsettings.development.json",
            "vite.config.ts", "vite.config.js", "next.config.js", "next.config.mjs",
            "tailwind.config.js", "tailwind.config.ts"
        }:
            config_files.append(rel.as_posix())

    return {
        "top_level": sorted(top_dirs),
        "manifests": sorted(set(manifests))[:200],
        "config_files": sorted(set(config_files))[:200],
        "test_roots": sorted(test_roots),
        "migration_roots": sorted(migration_roots),
        "extension_counts": dict(sorted(extension_counts.items(), key=lambda kv: (-kv[1], kv[0]))),
        "note": "Structural routing index only; source contents are intentionally not embedded."
    }


def load_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def npm_packages(project_files):
    out = set()
    for p, rel in project_files:
        if rel.name != "package.json":
            continue
        data = load_json(p)
        for section in ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies"):
            values = data.get(section, {})
            if isinstance(values, dict):
                out.update(values.keys())
    return out


def composer_packages(project_files):
    out = set()
    for p, rel in project_files:
        if rel.name != "composer.json":
            continue
        data = load_json(p)
        for section in ("require", "require-dev"):
            values = data.get(section, {})
            if isinstance(values, dict):
                out.update(values.keys())
    return out


def file_matches(rel, pattern):
    posix = rel.as_posix()
    if pattern.startswith("**/"):
        tail = pattern[3:]
        return rel.match(pattern) or rel.name == tail
    return rel.match(pattern) or posix == pattern or rel.name == pattern


def matching_file_contains(project_files, mapping):
    hits = []
    if not isinstance(mapping, dict):
        return hits
    for filename, needles in mapping.items():
        for p, rel in project_files:
            if rel.name != filename:
                continue
            try:
                text = p.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                continue
            for needle in needles:
                if needle.lower() in text.lower():
                    hits.append(f"{rel.as_posix()}: {needle}")
    return hits


def csproj_text(project_files):
    chunks = []
    for p, rel in project_files:
        if rel.suffix.lower() == ".csproj":
            try:
                chunks.append(p.read_text(encoding="utf-8", errors="ignore"))
            except Exception:
                pass
    return "\n".join(chunks)


def compose_text(project_files):
    chunks = []
    names = {"docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"}
    for p, rel in project_files:
        if rel.name in names:
            try:
                chunks.append(p.read_text(encoding="utf-8", errors="ignore"))
            except Exception:
                pass
    return "\n".join(chunks).lower()


def detect(project):
    project = project.resolve()
    files = list(walk_files(project))
    npms = npm_packages(files)
    composers = composer_packages(files)
    csproj = csproj_text(files)
    compose = compose_text(files)
    manifest = load_json(PACK / "router" / "skill-map.json")

    detected = set(manifest.get("always_install", []))
    evidence = {s: ["web pack baseline"] for s in detected}

    for rule in manifest.get("rules", []):
        skill = rule["skill"]
        reasons = []

        patterns = rule.get("any_files", [])
        matches = []
        for _, rel in files:
            if any(file_matches(rel, pat) for pat in patterns):
                matches.append(rel.as_posix())
        if matches:
            reasons.append("files: " + ", ".join(sorted(set(matches))[:5]))

        pkg_hits = sorted(npms.intersection(rule.get("npm_packages", [])))
        if pkg_hits:
            reasons.append("npm: " + ", ".join(pkg_hits))

        comp_hits = sorted(composers.intersection(rule.get("composer_packages", [])))
        if comp_hits:
            reasons.append("composer: " + ", ".join(comp_hits))

        c_hits = [needle for needle in rule.get("csproj_contains", []) if needle.lower() in csproj.lower()]
        if c_hits:
            reasons.append("csproj: " + ", ".join(c_hits))

        image_hits = [needle for needle in rule.get("compose_images", []) if re.search(rf"\b{re.escape(needle.lower())}([:/@\s]|$)", compose)]
        if image_hits:
            reasons.append("compose image: " + ", ".join(image_hits))

        file_contains_hits = matching_file_contains(files, rule.get("file_contains", {}))
        if file_contains_hits:
            reasons.append("file content: " + ", ".join(file_contains_hits[:5]))

        if reasons:
            detected.add(skill)
            evidence[skill] = reasons

    return sorted(detected), evidence


def copy_tree(src, dst):
    if not src.exists():
        return
    for p in src.rglob("*"):
        rel = p.relative_to(src)
        target = dst / rel
        if p.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(p, target)


def render_config(skills, evidence):
    return {
        "kit": "web-dev-agent-kit",
        "version": VERSION,
        "domain": "web",
        "detected_skills": skills,
        "evidence": evidence
    }


def install(project, force_agents=False):
    project = project.resolve()
    skills, evidence = detect(project)

    core = project / ".agent-core"
    copy_tree(PACK / "agents", core / "agents")
    copy_tree(PACK / "rules", core / "rules")
    copy_tree(PACK / "contracts", core / "contracts")
    copy_tree(PACK / "registry", core / "registry")

    skill_root = project / ".agents" / "skills"
    skill_root.mkdir(parents=True, exist_ok=True)
    for skill in skills:
        copy_tree(PACK / "skills" / skill, skill_root / skill)

    agents_template = (KIT_ROOT / "AGENTS.template.md").read_text(encoding="utf-8")
    agents_path = project / "AGENTS.md"
    if agents_path.exists() and not force_agents:
        (project / "AGENTS.web-kit.md").write_text(agents_template, encoding="utf-8")
        agents_note = "preserved existing AGENTS.md; wrote AGENTS.web-kit.md"
    else:
        agents_path.write_text(agents_template, encoding="utf-8")
        agents_note = "wrote AGENTS.md"

    (project / ".agent-kit.json").write_text(
        json.dumps(render_config(skills, evidence), indent=2),
        encoding="utf-8"
    )

    index_dir = core / "index"
    index_dir.mkdir(parents=True, exist_ok=True)
    (index_dir / "project-index.json").write_text(
        json.dumps(build_project_index(project), indent=2),
        encoding="utf-8"
    )

    routing_dir = core / "routing"
    routing_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(PACK / "router" / "context-policy.json", routing_dir / "context-policy.json")
    shutil.copy2(PACK / "router" / "agent-route-map.json", routing_dir / "agent-route-map.json")

    catalog_dir = core / "catalog"
    catalog_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(PACK / "router" / "skill-catalog.json", catalog_dir / "skill-catalog.json")

    profile_result = apply_project_profile(
        project,
        kit_root=KIT_ROOT,
        version=VERSION,
        force_agents=force_agents
    )
    agents_note = profile_result["action"]
    compatibility = apply_ai_compatibility(project, profile_result["path"])

    print(f"Web Agent Kit {VERSION} installed")
    print(f"Project: {profile_result['profile']['name']}")
    print(f"Project directory: {project}")
    print(f"Agents: {len(list((core / 'agents').glob('*.md')))}")
    print("Skills: " + ", ".join(skills))
    print("AGENTS: " + agents_note)
    print("AI compatibility: Codex/Kimi native AGENTS + Claude/Gemini/Cursor/Copilot bridges")
    print("Canonical instructions: " + compatibility["canonical_instructions"])


def doctor(project):
    project = project.resolve()
    expected, evidence = detect(project)
    cfg = load_json(project / ".agent-kit.json")
    profile = load_json(project / ".agent-core" / "index" / "project-profile.json")
    graph_state = load_json(project / ".agent-core" / "state" / "graphify.json")
    install_state = load_json(project / ".agent-core" / "state" / "graphify-install.json")
    actual_graph_ready = (project / "graphify-out" / "graph.json").is_file()

    installed = sorted(
        p.name for p in (project / ".agents" / "skills").iterdir()
        if p.is_dir() and (p / "SKILL.md").exists()
    ) if (project / ".agents" / "skills").exists() else []

    missing = sorted(set(expected) - set(installed))
    stale = sorted(set(installed) - set(expected))
    agent_files = list((project / ".agent-core" / "agents").glob("*.md")) if (project / ".agent-core" / "agents").exists() else []
    bridge_paths = [
        project / "CLAUDE.md",
        project / "GEMINI.md",
        project / ".github" / "copilot-instructions.md",
        project / ".cursor" / "rules" / "ihgen-web-kit.mdc",
    ]
    bridges_ok = all(path.exists() for path in bridge_paths)

    warnings = []
    cfg_graphify = cfg.get("capabilities", {}).get("graphify", {}) if cfg else {}
    profile_graphify = profile.get("capabilities", {}).get("graphify", {}) if profile else {}

    for key in ("detected", "graph_ready", "routing_mode"):
        if cfg_graphify and profile_graphify and cfg_graphify.get(key) != profile_graphify.get(key):
            warnings.append(
                f"Graphify metadata mismatch for {key}: .agent-kit.json={cfg_graphify.get(key)!r}, "
                f"project-profile.json={profile_graphify.get(key)!r}"
            )

    if cfg_graphify and cfg_graphify.get("graph_ready") != actual_graph_ready:
        warnings.append(
            f".agent-kit.json Graphify graph_ready={cfg_graphify.get('graph_ready')!r} "
            f"but graphify-out/graph.json presence is {actual_graph_ready}"
        )
    if profile_graphify and profile_graphify.get("graph_ready") != actual_graph_ready:
        warnings.append(
            f"project-profile.json Graphify graph_ready={profile_graphify.get('graph_ready')!r} "
            f"but graphify-out/graph.json presence is {actual_graph_ready}"
        )
    if install_state and install_state.get("graph_ready") != actual_graph_ready:
        warnings.append(
            f"graphify-install.json graph_ready={install_state.get('graph_ready')!r} "
            f"but graphify-out/graph.json presence is {actual_graph_ready}"
        )
    if actual_graph_ready and not graph_state:
        warnings.append("Graphify graph exists but .agent-core/state/graphify.json freshness state is missing")

    assistant_paths = {
        "CLAUDE.md": project / "CLAUDE.md",
        "GEMINI.md": project / "GEMINI.md",
        "GitHub Copilot": project / ".github" / "copilot-instructions.md",
    }
    for label, path in assistant_paths.items():
        for issue in find_unmanaged_graphify_conflicts(path):
            warnings.append(f"{label}: {issue}; canonical Graph Refresh Gate should control Graphify refresh/use")

    print(f"Web Agent Kit Doctor — {project}")
    print(f"Detected skills: {', '.join(expected)}")
    print(f"Installed skills: {', '.join(installed) if installed else '(none)'}")
    print(f"Agent definitions: {len(agent_files)}")
    print(f"Config: {'OK' if cfg else 'MISSING'}")
    print(f"Project index: {'OK' if (project/'.agent-core/index/project-index.json').exists() else 'MISSING'}")
    print(f"Project profile: {'OK' if (project/'.agent-core/index/project-profile.json').exists() else 'MISSING'}")
    print(f"Routing policy: {'OK' if (project/'.agent-core/routing/context-policy.json').exists() else 'MISSING'}")
    print(f"Root instructions: {'OK' if (project/'AGENTS.md').exists() or (project/'AGENTS.web-kit.md').exists() else 'MISSING'}")
    print(f"Cross-AI bridges: {'OK' if bridges_ok else 'MISSING'}")
    print(f"Graphify graph: {'READY' if actual_graph_ready else 'NOT READY'}")
    if missing:
        print("Missing skills: " + ", ".join(missing))
    if stale:
        print("Installed but no longer detected: " + ", ".join(stale))
    if warnings:
        print("Warnings:")
        for warning in warnings:
            print("  - " + warning)
        print("Metadata repair: run the canonical Graph Refresh Gate once; it synchronizes Graphify metadata without changing app code.")

    healthy = (
        not missing
        and agent_files
        and cfg
        and bridges_ok
        and (project / ".agent-core" / "index" / "project-profile.json").exists()
    )
    if healthy:
        print("Status: HEALTHY WITH WARNINGS" if warnings else "Status: HEALTHY")
        return 0
    print("Status: NEEDS ATTENTION")
    return 1


def scan(project):
    project = project.resolve()
    skills, evidence = detect(project)
    result = render_config(skills, evidence)
    result["project_index"] = build_project_index(project)
    print(json.dumps(result, indent=2))


def show_catalog():
    catalog = load_json(PACK / "router" / "skill-catalog.json")
    print(f"Web skill catalog: {catalog.get('count', 0)} skills")
    for category, names in sorted(catalog.get("categories", {}).items()):
        print(f"\n[{category}] {len(names)}")
        print("  " + ", ".join(names))


def add_skill(project, skill):
    project = project.resolve()
    source = PACK / "skills" / skill
    if not (source / "SKILL.md").exists():
        print(f"Unknown skill: {skill}", file=sys.stderr)
        return 2
    target = project / ".agents" / "skills" / skill
    copy_tree(source, target)
    cfg_path = project / ".agent-kit.json"
    cfg = load_json(cfg_path)
    if cfg:
        active = set(cfg.get("activated_skills", []))
        active.add(skill)
        cfg["activated_skills"] = sorted(active)
        cfg_path.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
    print(f"Activated skill: {skill}")
    return 0


def setup_graphify(project):
    script = PACK / "rules" / "graphify-setup.py"
    return subprocess.run([
        sys.executable, str(script), "--project", str(Path(project).resolve()), "--yes"
    ], check=False).returncode


def main():
    parser = argparse.ArgumentParser(description="Web Development Agent Kit")
    sub = parser.add_subparsers(dest="command", required=True)

    for name in ("scan", "doctor", "update"):
        p = sub.add_parser(name)
        p.add_argument("project", nargs="?", default=".")

    p = sub.add_parser("install")
    p.add_argument("project", nargs="?", default=".")
    p.add_argument("--force-agents", action="store_true",
                   help="Overwrite existing AGENTS.md instead of writing AGENTS.web-kit.md")

    p = sub.add_parser("graphify")
    p.add_argument("project", nargs="?", default=".")

    sub.add_parser("catalog")
    p = sub.add_parser("add-skill")
    p.add_argument("project")
    p.add_argument("skill")

    args = parser.parse_args()
    project = Path(getattr(args, "project", "."))

    if args.command == "scan":
        scan(project)
    elif args.command == "install":
        install(project, args.force_agents)
    elif args.command == "update":
        install(project, False)
    elif args.command == "doctor":
        raise SystemExit(doctor(project))
    elif args.command == "graphify":
        raise SystemExit(setup_graphify(project))
    elif args.command == "catalog":
        show_catalog()
    elif args.command == "add-skill":
        raise SystemExit(add_skill(project, args.skill))


if __name__ == "__main__":
    main()
