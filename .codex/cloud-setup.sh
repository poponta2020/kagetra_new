#!/usr/bin/env bash
# Refresh the shared devflow checkout and install its Codex adapters.
set -euo pipefail

devflow_repo="${DEVFLOW_REPO:-poponta2020/claude-devflow}"
devflow_ref="${DEVFLOW_REF:-main}"
codex_root="${CODEX_HOME:-${HOME}/.codex}"
devflow_dir="${DEVFLOW_DIR:-${codex_root}/shared/claude-devflow}"

if [ -n "${DEVFLOW_GITHUB_TOKEN:-}" ]; then
  export GH_TOKEN="${DEVFLOW_GITHUB_TOKEN}"
fi

mkdir -p "$(dirname "$devflow_dir")"

if [ -d "$devflow_dir/.git" ]; then
  git -C "$devflow_dir" fetch --depth 1 origin "$devflow_ref"
  git -C "$devflow_dir" checkout --detach FETCH_HEAD
elif command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  gh repo clone "$devflow_repo" "$devflow_dir" -- --depth 1 --branch "$devflow_ref"
else
  git clone --depth 1 --branch "$devflow_ref" "https://github.com/${devflow_repo}.git" "$devflow_dir"
fi

bash "$devflow_dir/scripts/setup-codex.sh"
