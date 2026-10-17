#!/usr/bin/env bash
set -euo pipefail
box_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$box_root"
box_requirements="$box_root/website/box-studio/backend/requirements.txt"
# Both studios pin the same manufacturing runtime. Reuse it when present.
box_python="$box_root/.baustein-venv/bin/python"
if [[ ! -x "$box_python" ]]; then
  box_python="$box_root/.box-venv/bin/python"
  if [[ ! -x "$box_python" ]]; then
    python3 -c 'import sys; assert sys.version_info >= (3, 12), "Python 3.12 oder neuer ist erforderlich."'
    python3 -m venv "$box_root/.box-venv"
  fi
fi
box_runtime="$(dirname -- "$(dirname -- "$box_python")")"
if ! cmp -s "$box_requirements" "$box_runtime/installed-requirements.txt"; then
  "$box_python" -m pip install -r "$box_requirements"
  cp "$box_requirements" "$box_runtime/installed-requirements.txt"
fi
exec "$box_python" "$box_root/website/box-studio/backend/server.py" "$@"
