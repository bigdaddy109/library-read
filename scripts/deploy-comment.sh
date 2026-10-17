#!/usr/bin/env bash
# Post the deploy-check result on the PR that introduced DEPLOY_SHA, or on
# the commit when that SHA has no pull request.
set -euo pipefail

OUT_DIR="${DEPLOY_CHECK_OUT:-${RUNNER_TEMP:-/tmp}/deploy-proof}"
BODY_FILE="$OUT_DIR/comment.md"
SHA="${DEPLOY_SHA:?DEPLOY_SHA is required}"
REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
export GH_TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
if [[ -z "$GH_TOKEN" ]]; then
  echo "GH_TOKEN is not set" >&2
  exit 1
fi

if [[ ! -s "$BODY_FILE" ]]; then
  echo "missing comment body at $BODY_FILE" >&2
  exit 1
fi

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  cat "$BODY_FILE" >> "$GITHUB_STEP_SUMMARY"
  echo >> "$GITHUB_STEP_SUMMARY"
fi

owner="${REPO%%/*}"
name="${REPO#*/}"

pr_number="$(gh api graphql -f query='
  query($owner: String!, $name: String!, $sha: String!) {
    repository(owner: $owner, name: $name) {
      object(expression: $sha) {
        ... on Commit {
          associatedPullRequests(first: 10) {
            nodes { number state }
          }
        }
      }
    }
  }' -F owner="$owner" -F name="$name" -F sha="$SHA" \
  --jq '
    [.data.repository.object.associatedPullRequests.nodes[]]
    | (map(select(.state == "OPEN")) | .[0].number) //
      (map(select(.state == "MERGED")) | .[0].number) //
      .[0].number // empty
  ')"

if [[ -z "$pr_number" && "${GITHUB_EVENT_NAME:-}" == "workflow_dispatch" && -n "${GITHUB_REF_NAME:-}" ]]; then
  pr_number="$(gh pr list --repo "$REPO" --head "$GITHUB_REF_NAME" --state open --json number --jq '.[0].number // empty')"
fi

if [[ -n "$pr_number" ]]; then
  echo "commenting on PR #${pr_number}"
  gh pr comment "$pr_number" --repo "$REPO" --body-file "$BODY_FILE"
else
  echo "no pull request for ${SHA}; commenting on the commit"
  gh api --method POST "repos/${REPO}/commits/${SHA}/comments" -f body="$(cat "$BODY_FILE")" >/dev/null
fi
