#!/bin/bash
# Node runner driver: fresh Anvil per mode, then one node mode.
# Usage: bash run-node.sh k4621
set -u
cd "$(dirname "$0")"
ANVIL="$HOME/.foundry/bin/anvil"
MODES="${*:-k4621}"
for m in $MODES; do
  echo "=== MODE $m ==="
  "$ANVIL" --port 8559 --chain-id 4663 > "anvil-$m.log" 2>&1 &
  APID=$!
  for i in $(seq 1 30); do
    curl -s -X POST -H 'Content-Type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' http://127.0.0.1:8559 >/dev/null 2>&1 && break
    sleep 0.5
  done
  NODE_PATH=/home/hatch/workspace/bull-audit/node_modules node run-sdk-b46.mjs "$m" > "node-$m.log" 2>&1
  echo "node $m exit=$?"
  kill $APID 2>/dev/null; wait $APID 2>/dev/null
  sleep 1
done
echo "=== SUMMARY ==="
grep -h "^\[" node-k*.log 2>/dev/null
