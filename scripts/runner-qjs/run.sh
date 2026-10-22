#!/bin/sh
# Build the background checker and run it in QuickJS with fake fetch/KV/notifications.
set -e
cd "$(dirname "$0")/../.."
node node_modules/vite/bin/vite.js build --config vite.runner.config.ts --logLevel warn
out="${TMPDIR:-/tmp}/sk-runner-qjs-test.js"
cat scripts/runner-qjs/pre.js dist/runners/background.js scripts/runner-qjs/post.js > "$out"
qjs --std "$out"
