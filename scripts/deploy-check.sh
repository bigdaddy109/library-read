#!/usr/bin/env bash
# Curl the live site and core shell assets. Require HTTP 200, and require the
# live sw.js cache name to match docs/sw.js (or EXPECTED_CACHE). Retry for a
# few minutes so GitHub Pages can finish propagating.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BASE="${DEPLOY_URL:-https://bigdaddy109.github.io/library-read/}"
BASE="${BASE%/}/"
TIMEOUT="${DEPLOY_CHECK_TIMEOUT_SEC:-240}"
INTERVAL="${DEPLOY_CHECK_INTERVAL_SEC:-15}"
OUT_DIR="${DEPLOY_CHECK_OUT:-${RUNNER_TEMP:-/tmp}/deploy-proof}"
mkdir -p "$OUT_DIR"

repo_cache="$(sed -n 's/^const CACHE = "\(library-read-shell-v[0-9][0-9]*\)";$/\1/p' docs/sw.js | head -n 1)"
if [[ -z "$repo_cache" ]]; then
  echo "docs/sw.js has no library-read-shell-vN cache name" >&2
  exit 1
fi

expected="${EXPECTED_CACHE:-}"
expected="${expected#"${expected%%[![:space:]]*}"}"
expected="${expected%"${expected##*[![:space:]]}"}"
if [[ -z "$expected" ]]; then
  expected="$repo_cache"
fi

mapfile -t assets < <(sed -n '/^const ASSETS = \[/,/^];/p' docs/sw.js | grep -o '"[^"]*"' | tr -d '"')
if [[ "${#assets[@]}" -eq 0 ]]; then
  echo "docs/sw.js has no ASSETS list" >&2
  exit 1
fi

http_status="0"
live_cache=""
detail=""
asset_report=""
ok=0
attempt=0

curl_code() {
  local url="$1" dest="$2" code
  code="$(curl -sS -L --max-time 30 \
    -H "Cache-Control: no-cache" \
    -H "Pragma: no-cache" \
    -A "library-read-deploy-proof" \
    -o "$dest" \
    -w "%{http_code}" \
    "$url" || true)"
  if [[ ! "$code" =~ ^[0-9]{3}$ ]]; then
    code="000"
  fi
  printf '%s' "$code"
}

cache_bust() {
  local url="$1" cb="$2"
  if [[ "$url" == *\?* ]]; then
    printf '%s&cb=%s' "$url" "$cb"
  else
    printf '%s?cb=%s' "$url" "$cb"
  fi
}

note_fail() {
  if [[ -z "$detail" ]]; then
    detail="$1"
  fi
  ok=0
}

check_once() {
  local cb="$1"
  local tmp code url rel label dest n
  tmp="$(mktemp -d)"
  ok=1
  detail=""
  http_status="200"
  live_cache=""
  asset_report=""

  dest="$tmp/sw.js"
  code="$(curl_code "$(cache_bust "${BASE}sw.js" "$cb")" "$dest")"
  asset_report+="sw.js ${code}"$'\n'
  if [[ "$code" != "200" ]]; then
    http_status="$code"
    note_fail "sw.js 回 HTTP ${code}"
  else
    live_cache="$(sed -n 's/^const CACHE = "\(library-read-shell-v[0-9][0-9]*\)";$/\1/p' "$dest" | head -n 1)"
    if [[ -z "$live_cache" ]]; then
      note_fail "線上 sw.js 沒有 library-read-shell-vN"
    elif [[ "$live_cache" != "$expected" ]]; then
      note_fail "線上 sw.js 快取名稱與預期版本不符"
    fi
  fi

  for asset in "${assets[@]}"; do
    [[ -z "$asset" ]] && continue
    rel="${asset#./}"
    url="${BASE}${rel}"
    label="${rel:-/}"
    dest="$tmp/body"
    code="$(curl_code "$(cache_bust "$url" "$cb")" "$dest")"
    asset_report+="${label} ${code}"$'\n'
    if [[ "$code" != "200" ]]; then
      if [[ "$http_status" == "200" ]]; then
        http_status="$code"
      fi
      note_fail "核心殼層資源 ${label} 回 HTTP ${code}"
      continue
    fi
    if [[ "$rel" == "index.html" && -n "$live_cache" && "$live_cache" == "$expected" ]]; then
      n="${live_cache#library-read-shell-v}"
      if ! grep -q "app.js?v=${n}" "$dest"; then
        note_fail "線上 index.html 的 ?v= 與 sw.js 的 ${live_cache} 不一致"
      fi
    fi
  done

  rm -rf "$tmp"
  if [[ "$ok" == 1 ]]; then
    detail="線上版本與預期一致，核心殼層資源皆為 HTTP 200"
  fi
}

write_comment() {
  local when result version_line
  when="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if [[ "$ok" == 1 ]]; then
    result="通過"
    version_line="${live_cache}"
  else
    result="失敗"
    version_line="線上 ${live_cache:-（讀不到）}；預期 ${expected}"
  fi
  {
    printf '上線檢查：%s\n\n' "$result"
    printf '%s\n' "- 網址：${BASE}"
    printf '%s\n' "- HTTP 狀態：${http_status}"
    printf '%s\n' "- 版本：${version_line}"
    printf '%s\n' "- 時間：${when}"
    if [[ -n "${GITHUB_RUN_ID:-}" && -n "${GITHUB_REPOSITORY:-}" ]]; then
      printf '%s\n' "- 執行：${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"
    fi
    if [[ -n "$detail" ]]; then
      printf '%s\n' "- 說明：${detail}"
    fi
  } > "$OUT_DIR/comment.md"
  echo "$when" > "$OUT_DIR/checked-at.txt"
  cat "$OUT_DIR/comment.md"
}

if [[ ! "$expected" =~ ^library-read-shell-v[0-9]+$ ]]; then
  detail="預期版本格式不正確：${expected}"
  ok=0
  http_status="0"
  write_comment
  exit 1
fi

deadline=$((SECONDS + TIMEOUT))
while true; do
  attempt=$((attempt + 1))
  echo "attempt ${attempt}: expected ${expected} (repo ${repo_cache})"
  check_once "${attempt}-$(date +%s)"
  echo "attempt ${attempt}: http ${http_status}; live ${live_cache:-（讀不到）}; ${detail}"
  printf '%s' "$asset_report" | sed 's/^/  /'
  if [[ "$ok" == 1 ]]; then
    break
  fi
  if (( SECONDS >= deadline )); then
    break
  fi
  echo "retry in ${INTERVAL}s"
  sleep "$INTERVAL"
done

write_comment
if [[ "$ok" == 1 ]]; then
  exit 0
fi
exit 1
