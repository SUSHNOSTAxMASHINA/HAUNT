#!/bin/zsh
set -e
ROOT=${0:A:h}; OUT="$ROOT/Possess.saver"
for attempt in 1 2 3; do
  rm -rf "$OUT"; mkdir -p "$OUT/Contents/MacOS" "$OUT/Contents/Resources"
  cp -X "$ROOT/Info.plist" "$OUT/Contents/Info.plist"; cp -X "$ROOT/Hack-Regular.ttf" "$OUT/Contents/Resources/Hack-Regular.ttf"
  swiftc -emit-library -module-name Possess -framework ScreenSaver -framework AppKit -framework CoreImage -framework CoreText -o "$OUT/Contents/MacOS/Possess" "$ROOT/PossessScreenSaver.swift"
  xattr -cr "$OUT" 2>/dev/null; dot_clean -m "$OUT" 2>/dev/null
  if codesign --force --deep --sign - "$OUT" >/dev/null 2>&1; then echo "the room is ready: Possess.saver"; exit 0; fi
  sleep 1
done
echo "codesign kept failing — iCloud may still be stamping xattrs"; exit 1
