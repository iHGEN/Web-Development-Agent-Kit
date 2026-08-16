#!/usr/bin/env bash
set -euo pipefail
REPO=""; REF="main"; SOURCE=""; PROJECT="."; SHA=""; FORCE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO="$2"; shift 2;;
    --ref) REF="$2"; shift 2;;
    --source) SOURCE="$2"; shift 2;;
    --project) PROJECT="$2"; shift 2;;
    --sha256) SHA="$2"; shift 2;;
    --force-agents) FORCE="--force-agents"; shift;;
    *) echo "Unknown argument: $1" >&2; exit 2;;
  esac
done
if [[ -z "$SOURCE" && -z "$REPO" ]]; then
  echo "Provide --repo OWNER/REPO or --source ZIP_URL" >&2; exit 2
fi
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
if [[ -n "$SOURCE" ]]; then URL="$SOURCE"; else URL="https://codeload.github.com/${REPO}/zip/${REF}"; fi
curl -fL "$URL" -o "$TMP/kit.zip"
if [[ -n "$SHA" ]]; then
  ACTUAL="$(python3 - "$TMP/kit.zip" <<'PY'
import hashlib,sys
h=hashlib.sha256()
with open(sys.argv[1],"rb") as f:
    for b in iter(lambda:f.read(1024*1024),b""): h.update(b)
print(h.hexdigest())
PY
)"
  [[ "$ACTUAL" == "$SHA" ]] || { echo "SHA-256 mismatch" >&2; exit 3; }
fi
python3 - "$TMP/kit.zip" "$PROJECT" "$FORCE" "$REPO" "$REF" "$URL" <<'PY'
import json,sys,zipfile,tempfile,subprocess,shutil
from pathlib import Path
archive=Path(sys.argv[1]); project=Path(sys.argv[2]).resolve()
force,repo,ref,url=sys.argv[3:7]
project.mkdir(parents=True,exist_ok=True)
with tempfile.TemporaryDirectory(prefix="web-kit-extract-") as td:
    td=Path(td)
    with zipfile.ZipFile(archive) as z:z.extractall(td)
    hits=list(td.rglob("scripts/agent-kit.py"))
    if not hits: raise SystemExit("agent-kit.py not found")
    cli=hits[0]; kit=cli.parent.parent
    cmd=[sys.executable,str(cli),"install",str(project)]
    if force: cmd.append(force)
    subprocess.check_call(cmd)
    (project/".agent-kit-source.json").write_text(json.dumps({"repo":repo or None,"ref":ref or None,"source":url},indent=2),encoding="utf-8")
    remote=kit/"bootstrap"/"remote-install.py"
    if remote.exists():
        b=project/".agent-core"/"bin"; b.mkdir(parents=True,exist_ok=True)
        shutil.copy2(remote,b/"remote-install.py")
PY
echo "Web Development Agent Kit installed into $PROJECT"
