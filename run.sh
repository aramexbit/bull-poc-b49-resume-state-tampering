#!/bin/bash
# Run the B-49 PoC end to end: pure settle-state tests (K-4621 etc.) + node live-SDK mode k4621.
# Exits 0 when the bug reproduces, 1 when it does not.
# Local only: fresh Anvil 4663 for the node leg, mock API, live SDK b6e7d25c verbatim (pinned file).
# No mainnet, no real funds, no Bull infrastructure.
# HISTORICAL CLAIM: proven against SDK b6e7d25c (164,314 B). SDK c81ec058 (23 Nov 2026)
# signs request.* in the state MAC, so this no longer reproduces against the live SDK.
set -u
cd "$(dirname "$0")"
export NODE_PATH=/home/hatch/workspace/bull-audit/node_modules
echo "=== pure: test-settle-pure-minor19.mjs (38 cases) ==="
node test-settle-pure-minor19.mjs > test-settle-pure-staging.log 2>&1
PURE_EXIT=$?
echo "pure exit=$PURE_EXIT"
if [ "$PURE_EXIT" -ne 0 ]; then echo "B-49 NOT reproduced (pure test failed)"; exit 1; fi
if ! grep -q '"tamperedArbiterAccepted":true' test-settle-pure-staging.log; then echo "B-49 NOT reproduced (arbiter tamper not accepted)"; exit 1; fi
if ! grep -q '"tamperedTemplateAccepted":true' test-settle-pure-staging.log; then echo "B-49 NOT reproduced (template tamper not accepted)"; exit 1; fi
if ! grep -q '"openedArbiterIsAttacker":true' test-settle-pure-staging.log; then echo "B-49 NOT reproduced (machine did not open with attacker arbiter)"; exit 1; fi
echo "=== node: run-sdk-b46.mjs k4621 ==="
bash run-node.sh k4621 > run-staging.log 2>&1
if grep -q '"sellerPaid25WithoutDelivery": true' node-result-k4621.json && grep -q '"released": true' node-result-k4621.json; then
  echo "B-49 reproduced: request.* outside stateMac lets a stored settle state resume with an attacker arbiter; seller paid \$25 without delivery (pure leg green, node k4621)"
  exit 0
fi
echo "B-49 NOT reproduced (node results mismatch)"
exit 1
