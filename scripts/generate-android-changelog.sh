#!/usr/bin/env bash
# Generate a Play Store changelog file for the current Android versionCode
# from recent git history (PR titles via merge commits, or plain commit subjects).
#
# Output: fastlane/metadata/android/<locale>/changelogs/<versionCode>.txt
#
# Usage:
#   bash scripts/generate-android-changelog.sh                 # locale=en-US, since last tag
#   bash scripts/generate-android-changelog.sh en-US v1.2.3    # explicit since-ref
#   CHANGELOG_LOCALE=ar CHANGELOG_LIMIT=20 bash scripts/generate-android-changelog.sh
#
# Env vars:
#   CHANGELOG_LOCALE   override locale (default: en-US, or arg 1)
#   CHANGELOG_SINCE    git ref to diff from (default: latest tag, or arg 2)
#   CHANGELOG_LIMIT    max number of bullet entries (default: 15)
#   CHANGELOG_MAX_LEN  max characters per file (Play limit: 500, default: 480)
#   CHANGELOG_HEADER   optional header line prepended to the bullets
#
# Behaviour:
#   * Prefers PR titles parsed from "Merge pull request #N from ..." / squash
#     commits ending in "(#123)" — falls back to commit subjects.
#   * Skips chore/docs/style/test/ci/build/refactor commits and bot commits.
#   * Truncates safely to CHANGELOG_MAX_LEN characters (Play hard-limit 500).
#   * If GITHUB_TOKEN + GITHUB_REPOSITORY are present and `gh` is installed,
#     uses real PR titles (handles long/edited titles better than commit subjects).

set -euo pipefail

GRADLE_FILE="android/app/build.gradle"
if [[ ! -f "$GRADLE_FILE" ]]; then
  echo "android/app/build.gradle not found — run \`npx cap add android && npx cap sync android\` first." >&2
  exit 1
fi

VERSION_CODE="$(grep -Eo 'versionCode[[:space:]]+[0-9]+' "$GRADLE_FILE" | head -1 | awk '{print $2}')"
if [[ -z "${VERSION_CODE:-}" ]]; then
  echo "Could not parse versionCode from $GRADLE_FILE" >&2
  exit 1
fi

LOCALE="${CHANGELOG_LOCALE:-${1:-en-US}}"
SINCE_REF="${CHANGELOG_SINCE:-${2:-}}"
LIMIT="${CHANGELOG_LIMIT:-15}"
MAX_LEN="${CHANGELOG_MAX_LEN:-480}"
HEADER="${CHANGELOG_HEADER:-}"

if [[ -z "$SINCE_REF" ]]; then
  SINCE_REF="$(git describe --tags --abbrev=0 2>/dev/null || true)"
fi

RANGE_DESC=""
if [[ -n "$SINCE_REF" ]]; then
  if git rev-parse --verify "$SINCE_REF" >/dev/null 2>&1; then
    GIT_RANGE=("$SINCE_REF..HEAD")
    RANGE_DESC="since $SINCE_REF"
  else
    echo "Ref \"$SINCE_REF\" not found — falling back to last 30 commits." >&2
    GIT_RANGE=("-n" "30")
    RANGE_DESC="last 30 commits"
  fi
else
  GIT_RANGE=("-n" "30")
  RANGE_DESC="last 30 commits"
fi

OUT_DIR="fastlane/metadata/android/${LOCALE}/changelogs"
OUT_FILE="${OUT_DIR}/${VERSION_CODE}.txt"
mkdir -p "$OUT_DIR"

TMP_RAW="$(mktemp)"
trap 'rm -f "$TMP_RAW"' EXIT

# 1) Try `gh` for real PR titles when running in CI.
USED_GH=0
if command -v gh >/dev/null 2>&1 \
   && [[ -n "${GITHUB_TOKEN:-}" || -n "${GH_TOKEN:-}" ]] \
   && [[ -n "${GITHUB_REPOSITORY:-}" ]] \
   && [[ -n "$SINCE_REF" ]]; then
  if gh pr list \
        --repo "$GITHUB_REPOSITORY" \
        --state merged \
        --search "merged:>=$(git log -1 --format=%cI "$SINCE_REF" 2>/dev/null || echo '1970-01-01')" \
        --limit "$LIMIT" \
        --json number,title \
        --jq '.[] | "\(.title) (#\(.number))"' \
        > "$TMP_RAW" 2>/dev/null; then
    [[ -s "$TMP_RAW" ]] && USED_GH=1
  fi
fi

# 2) Fallback: parse git log for PR-style commits + plain subjects.
if [[ "$USED_GH" -ne 1 ]]; then
  git log "${GIT_RANGE[@]}" --no-merges --pretty=format:'%s' > "$TMP_RAW" || true
  # Append squash-merge titles like "feat: do thing (#123)" already present above;
  # also pull merge commits to capture "Merge pull request #N from branch" titles.
  git log "${GIT_RANGE[@]}" --merges --pretty=format:'%b' \
    | awk 'NF' >> "$TMP_RAW" || true
fi

python3 - "$TMP_RAW" "$OUT_FILE" "$LIMIT" "$MAX_LEN" "$HEADER" "$RANGE_DESC" <<'PY'
import re, sys, pathlib

raw_path, out_path, limit, max_len, header, range_desc = sys.argv[1:7]
limit = int(limit)
max_len = int(max_len)

SKIP_PREFIXES = ("chore", "docs", "style", "test", "ci", "build", "refactor", "wip")
SKIP_AUTHORS  = ("dependabot", "renovate", "lovable")

def clean(line: str) -> str | None:
    s = line.strip().lstrip("*-• \t")
    if not s:
        return None
    low = s.lower()
    if any(low.startswith(p + ":") or low.startswith(p + "(") for p in SKIP_PREFIXES):
        return None
    if any(a in low for a in SKIP_AUTHORS):
        return None
    # Drop conventional-commit type prefix: "feat(scope): foo" -> "foo"
    s = re.sub(r"^(feat|fix|perf|revert)(\([^)]+\))?:\s*", "", s, flags=re.I)
    # Capitalize first letter for nicer display.
    if s and s[0].islower():
        s = s[0].upper() + s[1:]
    return s

seen = set()
entries: list[str] = []
for line in pathlib.Path(raw_path).read_text(errors="replace").splitlines():
    cleaned = clean(line)
    if not cleaned:
        continue
    key = cleaned.lower()
    if key in seen:
        continue
    seen.add(key)
    entries.append(cleaned)
    if len(entries) >= limit:
        break

if not entries:
    entries = ["Stability improvements and bug fixes."]

lines: list[str] = []
if header:
    lines.append(header.strip())
    lines.append("")
lines.extend(f"• {e}" for e in entries)

text = "\n".join(lines).strip() + "\n"

if len(text) > max_len:
    # Trim entries from the bottom until under the limit.
    while entries and len("\n".join((([header, ""] if header else []) + [f"• {e}" for e in entries])).strip()) + 1 > max_len:
        entries.pop()
    rebuilt = ([header, ""] if header else []) + [f"• {e}" for e in entries]
    text = "\n".join(rebuilt).strip() + "\n"
    if len(text) > max_len:
        text = text[: max_len - 1].rstrip() + "…\n"

pathlib.Path(out_path).write_text(text)
print(f"Wrote {out_path} ({len(entries)} entries, {len(text)} chars, {range_desc})")
PY