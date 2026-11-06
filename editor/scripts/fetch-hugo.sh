#!/usr/bin/env bash
# Downloads the official Hugo extended build for the preview into hugo-bin/, verified against
# Hugo's published checksums. Same version as the website build (deploy.yml).
#   scripts/fetch-hugo.sh windows   → hugo-bin/hugo.exe
#   scripts/fetch-hugo.sh mac       → hugo-bin/hugo   (universal: Intel and Apple Silicon)
set -euo pipefail
version="${HUGO_VERSION:-0.131.0}"
case "${1:-}" in
  windows) archive="hugo_extended_${version}_windows-amd64.zip"; exe=hugo.exe ;;
  mac)     archive="hugo_extended_${version}_darwin-universal.tar.gz"; exe=hugo ;;
  *) echo "usage: $0 windows|mac" >&2; exit 1 ;;
esac
cd "$(dirname "$0")/.."
base="https://github.com/gohugoio/hugo/releases/download/v${version}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fsSL -o "$tmp/$archive" "$base/$archive"
curl -fsSL -o "$tmp/checksums.txt" "$base/hugo_${version}_checksums.txt"
expected="$(grep " ${archive}\$" "$tmp/checksums.txt" | cut -d' ' -f1)"
actual="$( (sha256sum "$tmp/$archive" 2>/dev/null || shasum -a 256 "$tmp/$archive") | cut -d' ' -f1)"
if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
  echo "checksum mismatch for $archive" >&2
  exit 1
fi
# Only one platform's binary may be bundled at a time.
mkdir -p hugo-bin
rm -f hugo-bin/hugo hugo-bin/hugo.exe
case "$archive" in
  *.zip) unzip -q -o "$tmp/$archive" "$exe" -d hugo-bin ;;
  *)     tar -xzf "$tmp/$archive" -C hugo-bin "$exe" ;;
esac
chmod +x "hugo-bin/$exe"
echo "hugo-bin/$exe: Hugo $version ($archive, checksum OK)"
