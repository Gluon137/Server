#!/usr/bin/env bash
set -euo pipefail
studio_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$studio_root"
studio_requirements="$studio_root/website/baustein-studio/backend/requirements.txt"
studio_python="$studio_root/.baustein-venv/bin/python"
if [[ ! -x "$studio_python" ]]; then
  python3 -c 'import sys; assert sys.version_info >= (3, 12), "Python 3.12 oder neuer ist erforderlich."'
  python3 -m venv "$studio_root/.baustein-venv"
fi
if ! cmp -s "$studio_requirements" "$studio_root/.baustein-venv/installed-requirements.txt"; then
  "$studio_python" -m pip install -r "$studio_requirements"
  cp "$studio_requirements" "$studio_root/.baustein-venv/installed-requirements.txt"
fi
exec "$studio_python" "$studio_root/website/baustein-studio/backend/server.py" "$@"
