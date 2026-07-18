#!/usr/bin/env bash
# Codex cloud maintenance entrypoint: refresh the centrally managed devflow.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec bash "$repo_root/.codex/cloud-setup.sh"
