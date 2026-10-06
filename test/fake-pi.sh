#!/usr/bin/env bash
# Fake pi shim for pitboss tests. Simulates dev-agents phases by inspecting the prompt.
# Env: FAKE_PI_MODE=pass|fail|flaky, FAKE_PI_STATE=<dir> (tracks review count for flaky)
set -u
PROMPT="$2"
OUT=".dev-agents"
MODE="${FAKE_PI_MODE:-pass}"

mkdir -p "$OUT/specs" "$OUT/output"
if [[ "$PROMPT" != *"synod-lite assistant"* ]]; then
  echo "[fake-pi] mode=$MODE prompt=${PROMPT:0:80}"
fi

if [[ "$PROMPT" == *"synod-lite assistant"* ]]; then
  echo "Assistant (fake): S-005 is blocked because its review failed 3 times in a row."
  echo "You could press r to retry it, or K to cancel and re-spec it."
  if [[ "$PROMPT" == *"create"* ]]; then
    echo 'ACTION: new "Chat-created story"'
  fi
elif [[ "$PROMPT" == *"spec workflow"* ]]; then
  echo "# Spec (fake)" > "$OUT/specs/fake-feature.md"
  echo "## Gate decision — PASS" >> "$OUT/specs/fake-feature.md"
elif [[ "$PROMPT" == *"test-design workflow"* ]]; then
  echo "# Test design (fake)" > "$OUT/specs/test-design-fake-feature.md"
elif [[ "$PROMPT" == *"implement workflow"* ]]; then
  echo "// implemented" > src-fake.js 2>/dev/null || true
  echo "# Implement report (fake)" > "$OUT/output/implement-fake-feature.md"
  git add -A >/dev/null 2>&1 && git -c user.email=f@f -c user.name=fake commit -m "implement (fake)" >/dev/null 2>&1 || true
elif [[ "$PROMPT" == *"review workflow"* ]]; then
  if [[ "$MODE" == "fail" ]]; then
    echo "# Review (fake)" > "$OUT/output/review-fake-feature.md"
    echo "## Gate decision — FAIL: AC1 not met" >> "$OUT/output/review-fake-feature.md"
  elif [[ "$MODE" == "flaky" ]]; then
    COUNT_FILE="${FAKE_PI_STATE:-/tmp}/review-count"
    N=$(( $(cat "$COUNT_FILE" 2>/dev/null || echo 0) + 1 ))
    echo "$N" > "$COUNT_FILE"
    echo "# Review (fake) round $N" > "$OUT/output/review-fake-feature.md"
    if (( N <= 1 )); then
      echo "## Gate decision — FAIL: flaky first round" >> "$OUT/output/review-fake-feature.md"
    else
      echo "## Gate decision — PASS" >> "$OUT/output/review-fake-feature.md"
    fi
  else
    echo "# Review (fake)" > "$OUT/output/review-fake-feature.md"
    echo "## Gate decision — PASS" >> "$OUT/output/review-fake-feature.md"
  fi
else
  echo "[fake-pi] unrecognized prompt, exiting 1" >&2
  exit 1
fi
exit 0
