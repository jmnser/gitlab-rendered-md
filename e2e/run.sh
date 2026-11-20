#!/usr/bin/env bash
# End-to-end test against a throwaway GitLab CE and Firefox in Kubernetes.
# Usage: e2e/run.sh            (creates namespace rmd-test, runs, deletes it)
#        KEEP=1 e2e/run.sh     (keeps the namespace for debugging)
set -euo pipefail
cd "$(dirname "$0")/.."
NS=rmd-test
TOKEN=glpat-rmdE2eTestOnlyToken0001
ROOT_PW='RmdTest-Only-2026!x'
OUT=${OUT:-e2e/out}
pids=()
cleanup() {
  kill "${pids[@]}" 2>/dev/null || true
  [ "${KEEP:-}" = 1 ] || kubectl delete namespace "$NS" --wait=false
}
trap cleanup EXIT

npm run package >/dev/null
XPI=$(ls -t artifacts/*.zip | head -1)
kubectl apply -f e2e/k8s.yaml
kubectl -n "$NS" rollout status deploy/firefox --timeout=10m
kubectl -n "$NS" rollout status deploy/gitlab --timeout=10m
echo "Waiting for GitLab to answer"
until [ "$(kubectl -n "$NS" exec deploy/gitlab -- curl -s -o /dev/null -w '%{http_code}' http://localhost/users/sign_in)" = 200 ]; do sleep 10; done
kubectl -n "$NS" exec deploy/gitlab -- gitlab-rails runner \
  "u=User.find_by_username('root'); t=u.personal_access_tokens.find_or_initialize_by(name:'e2e'); t.scopes=[:api]; t.expires_at=2.days.from_now; t.set_token('$TOKEN'); t.save!"
# WebDriver may not open moz-extension:// pages; the test needs geckodriver with system access.
# A second start on a running pod fails harmlessly because the port is taken.
kubectl -n "$NS" exec deploy/firefox -- sh -c \
  'nohup geckodriver --host 0.0.0.0 --port 4445 --allow-hosts localhost --allow-system-access >/tmp/gd.log 2>&1 &'
until kubectl -n "$NS" exec deploy/firefox -- curl -sf http://localhost:4445/status >/dev/null; do sleep 2; done
kubectl -n "$NS" port-forward svc/gitlab 18080:80 >/dev/null & pids+=($!)
kubectl -n "$NS" port-forward deploy/firefox 4445:4445 >/dev/null & pids+=($!)
sleep 3

MR=$(TOKEN=$TOKEN node e2e/setup.mjs)
mkdir -p "$OUT"
status=0
for mode in "RAPID|" "CLASSIC|?rapid_diffs_disabled=true"; do
  TAG=${mode%%|*} QUERY=${mode#*|} OUT=$OUT XPI=$XPI TOKEN=$TOKEN ROOT_PW=$ROOT_PW MR=$MR node e2e/e2e.mjs | tee "$OUT/${mode%%|*}.log"
  grep -q '^FAIL\|^ERROR' "$OUT/${mode%%|*}.log" && status=1
done
exit $status
