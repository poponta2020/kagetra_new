#!/usr/bin/env bash
# Refresh the shared devflow checkout and install its Codex adapters.
set -euo pipefail

devflow_repo="${DEVFLOW_REPO:-poponta2020/claude-devflow}"
devflow_ref="${DEVFLOW_REF:-main}"
codex_root="${CODEX_HOME:-${HOME}/.codex}"
devflow_dir="${DEVFLOW_DIR:-${codex_root}/shared/claude-devflow}"

git_auth_args=()
if [ -n "${DEVFLOW_GITHUB_TOKEN:-}" ]; then
  auth_header="$(printf 'x-access-token:%s' "${DEVFLOW_GITHUB_TOKEN}" | base64 | tr -d '\r\n')"
  git_auth_args=(-c "http.extraHeader=Authorization: Basic ${auth_header}")
fi

mkdir -p "$(dirname "$devflow_dir")"

if [ -d "$devflow_dir/.git" ]; then
  git "${git_auth_args[@]}" -C "$devflow_dir" fetch --depth 1 origin "$devflow_ref"
  git -C "$devflow_dir" checkout --detach FETCH_HEAD
elif [ "${#git_auth_args[@]}" -gt 0 ]; then
  git "${git_auth_args[@]}" clone --depth 1 --branch "$devflow_ref" "https://github.com/${devflow_repo}.git" "$devflow_dir"
elif command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  gh repo clone "$devflow_repo" "$devflow_dir" -- --depth 1 --branch "$devflow_ref"
else
  git clone --depth 1 --branch "$devflow_ref" "https://github.com/${devflow_repo}.git" "$devflow_dir"
fi

bash "$devflow_dir/scripts/setup-codex.sh"
