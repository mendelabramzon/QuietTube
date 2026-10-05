#!/bin/bash
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
node "$PROJECT_ROOT/scripts/generate-xcode.mjs"
ditto -c -k "$PROJECT_ROOT/extension" "$PROJECT_ROOT/build/QuietTube-extension.zip"
echo "Packaged $PROJECT_ROOT/build/QuietTube-extension.zip"
