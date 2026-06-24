#!/usr/bin/env bats
# Tests for the alert post-and-verify predicate shared by
# .github/workflows/showcase_promote_notify.yml and its dry-run helper.
#
# The bug under test: the thread-reply and #oss-alerts cross-post used to pipe
# the Slack API response to /dev/null. Slack returns HTTP 200 with
# `{"ok":false,"error":"channel_not_found"}` on LOGICAL failures, so a failed
# failure-ALERT (the page-the-humans message) was silently dropped — no warning,
# no non-zero exit. `slack_alert_posted_ok` is the testable predicate that now
# surfaces such drops via a GitHub `::warning::` and a non-zero return.
#
# NB on assertion gating: bats does NOT run test bodies under errexit. Only the
# FINAL command's status decides pass/fail, so every non-final assertion is
# written `[[ ... ]] || fail "message"`. The `|| fail` is what forces the hard
# failure; dropping it turns the assertion into a silent false-green.

fail() {
  echo "$1" >&2
  return 1
}

setup() {
  # The predicate lives in the workflow's dry-run helper. Source it (the helper
  # has an EXECUTION GUARD so sourcing defines functions without running the
  # dry-run body).
  HELPER="$BATS_TEST_DIRNAME/../../../.github/workflows/showcase_promote_notify.dry-run.sh"
  [ -f "$HELPER" ] || fail "helper not found: $HELPER"
  # shellcheck source=/dev/null
  source "$HELPER"
}

@test "slack_alert_posted_ok: ok:true response returns 0 and emits no warning" {
  run slack_alert_posted_ok "#oss-alerts cross-post" '{"ok":true,"ts":"123.456"}'
  [ "$status" -eq 0 ] || fail "expected status 0 on ok:true, got $status"
  [[ "$output" != *"::warning::"* ]] || fail "expected NO warning on ok:true, got: $output"
}

@test "slack_alert_posted_ok: ok:false (channel_not_found) returns non-zero and warns" {
  # This is the silent-drop the fix surfaces: HTTP 200 but logical failure.
  run slack_alert_posted_ok "#oss-alerts cross-post" '{"ok":false,"error":"channel_not_found"}'
  [ "$status" -ne 0 ] || fail "expected non-zero status on ok:false, got $status"
  [[ "$output" == *"::warning::"* ]] || fail "expected a ::warning:: on ok:false, got: $output"
  [[ "$output" == *"channel_not_found"* ]] || fail "expected the Slack error in the warning, got: $output"
  [[ "$output" == *"#oss-alerts cross-post"* ]] || fail "expected the call label in the warning, got: $output"
}

@test "slack_alert_posted_ok: transport-failure sentinel ({}) returns non-zero and warns" {
  # slack_api returns "{}" on non-2xx/transport failure; treat that as a drop.
  run slack_alert_posted_ok "thread reply" '{}'
  [ "$status" -ne 0 ] || fail "expected non-zero status on empty response, got $status"
  [[ "$output" == *"::warning::"* ]] || fail "expected a ::warning:: on empty response, got: $output"
  [[ "$output" == *"thread reply"* ]] || fail "expected the call label in the warning, got: $output"
}
