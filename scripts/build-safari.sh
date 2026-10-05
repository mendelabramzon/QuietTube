#!/bin/bash
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
bash "$PROJECT_ROOT/scripts/package-safari.sh"
xcodebuild \
  -project "$PROJECT_ROOT/build/safari/QuietTube/QuietTube.xcodeproj" \
  -scheme QuietTube \
  -configuration Debug \
  -derivedDataPath "$PROJECT_ROOT/build/DerivedData" \
  -destination 'platform=macOS' \
  CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= \
  build
