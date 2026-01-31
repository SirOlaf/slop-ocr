#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SWIFT_DIR="$PROJECT_ROOT/swift"

echo "Building OCR CLI..."

cd "$SWIFT_DIR"

# Build in release mode
swift build -c release

# Copy the binary to a convenient location
BUILD_DIR="$PROJECT_ROOT/build"
mkdir -p "$BUILD_DIR"
cp ".build/release/ocrcli" "$BUILD_DIR/ocrcli"

echo "Build complete!"
echo "Binary location: $BUILD_DIR/ocrcli"
echo ""
echo "Usage:"
echo "  Start the CLI:  $BUILD_DIR/ocrcli"
echo ""
echo "  Then send JSON commands via stdin:"
echo '    {"action": "pick"}                        - Show native window picker'
echo '    {"action": "scan"}                        - Capture and OCR (shows picker if needed)'
echo '    {"action": "scan", "saveTo": "/tmp/x.png"} - Also save the captured image'
echo '    {"action": "quit"}                        - Exit the CLI'
