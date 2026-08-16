#!/usr/bin/env python3
from pathlib import Path
import argparse, hashlib, json, shutil, subprocess, sys, tempfile, urllib.request, urllib.parse, zipfile

def read_json(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception:
        return {}

def digest(path):
    h=hashlib.sha256()
    with open(path,"rb") as f:
        for b in iter(lambda:f.read(1024*1024),b""):
            h.update(b)
    return h.hexdigest()

def fetch(url, out):
    req=urllib.request.Request(url,headers={"User-Agent":"web-dev-agent-kit/1.1"})
    with urllib.request.urlopen(req,timeout=90) as r, open(out,"wb") as f:
        shutil.copyfileobj(r,f)

def source_for(args, project):
    saved=read_json(project/".agent-kit-source.json")
    repo=args.repo or saved.get("repo")
    ref=args.ref or saved.get("ref") or "main"
    src=args.source or saved.get("source")
    if src:
        return src,repo,ref
    if repo:
        return f"https://codeload.github.com/{repo}/zip/{ref}",repo,ref
    raise SystemExit("Use --repo OWNER/REPO or --source ZIP_URL for the first remote install.")

def find_root(folder):
    hits=[]
    for cli in folder.rglob("scripts/agent-kit.py"):
        r=cli.parent.parent
        if (r/"pack").exists() and (r/"AGENTS.template.md").exists():
            hits.append(r)
    if not hits: raise RuntimeError("Kit root not found in downloaded archive.")
    return sorted(hits,key=lambda p:len(p.parts))[0]

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--repo")
    ap.add_argument("--ref")
    ap.add_argument("--source")
    ap.add_argument("--sha256")
    ap.add_argument("--project",default=".")
    ap.add_argument("--force-agents",action="store_true")
    args=ap.parse_args()

    project=Path(args.project).resolve()
    project.mkdir(parents=True,exist_ok=True)
    src,repo,ref=source_for(args,project)

    with tempfile.TemporaryDirectory(prefix="web-kit-") as td:
        td=Path(td); archive=td/"kit.zip"
        local=Path(src).expanduser()
        if local.exists():
            shutil.copy2(local,archive)
        elif src.startswith("file://"):
            shutil.copy2(Path(urllib.parse.urlparse(src).path),archive)
        else:
            print(f"Downloading {src}")
            fetch(src,archive)

        sha=digest(archive)
        if args.sha256 and sha.lower()!=args.sha256.lower():
            raise SystemExit(f"SHA-256 mismatch. Expected {args.sha256}, got {sha}")

        extract=td/"extract"; extract.mkdir()
        with zipfile.ZipFile(archive) as z: z.extractall(extract)
        kit=find_root(extract)

        cmd=[sys.executable,str(kit/"scripts/agent-kit.py"),"install",str(project)]
        if args.force_agents: cmd.append("--force-agents")
        subprocess.check_call(cmd)

        (project/".agent-kit-source.json").write_text(json.dumps({
            "repo":repo,"ref":ref,"source":src,"sha256":sha
        },indent=2),encoding="utf-8")

        bindir=project/".agent-core"/"bin"; bindir.mkdir(parents=True,exist_ok=True)
        shutil.copy2(Path(__file__).resolve(),bindir/"remote-install.py")

        print("Remote installation complete.")
        print("Project-aware AGENTS context generated from repository structure and detected stack.")
        print("Future update: python .agent-core/bin/remote-install.py --project .")

if __name__=="__main__":
    main()
