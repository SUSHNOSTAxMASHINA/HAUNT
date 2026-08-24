#!/bin/zsh
set -e
ROOT=${0:A:h}; OUT="$ROOT/Possess.saver"; rm -rf "$OUT"; mkdir -p "$OUT/Contents/MacOS" "$OUT/Contents/Resources"; cp -X "$ROOT/Info.plist" "$OUT/Contents/Info.plist"; cp -X "$ROOT/Hack-Regular.ttf" "$OUT/Contents/Resources/Hack-Regular.ttf"; swiftc -emit-library -module-name Possess -framework ScreenSaver -framework AppKit -o "$OUT/Contents/MacOS/Possess" "$ROOT/PossessScreenSaver.swift"; xattr -cr "$OUT"; codesign --force --deep --sign - "$OUT" >/dev/null; echo "the room is ready: Possess.saver"
