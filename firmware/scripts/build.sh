#!/usr/bin/env bash

set -euo pipefail

CP_VERSION=10.3.1
export CP_VERSION
BOARD=sunton_esp32_2432S028
SUBMODULES=(extmod/ulab lib/mp3 lib/tlsf lib/quirc lib/mbedtls lib/certificates tools/huffman tools/bitmap_font)
PY_PACKAGES=(cascadetoml jinja2 typer sh "click<8.2.0" polib pyyaml tomlkit minify_html jsmin intelhex)

here="$(cd "$(dirname "$0")/.." && pwd)"
cp_dir="$here/.build/circuitpython"
port_dir="$cp_dir/ports/webassembly"
out_dir="$here/../web/public/firmware"

command -v emcc >/dev/null || { echo "emcc not found: install Emscripten (brew install emscripten)" >&2; exit 1; }

if [ ! -d "$cp_dir" ]; then
    mkdir -p "$here/.build"
    git clone --depth 1 --branch "$CP_VERSION" https://github.com/adafruit/circuitpython.git "$cp_dir"
fi
git -C "$cp_dir" submodule update --init --depth 1 "${SUBMODULES[@]}"

for patch in "$here"/patches/*.patch; do
    if ! git -C "$cp_dir" apply --reverse --check "$patch" 2>/dev/null; then
        git -C "$cp_dir" apply "$patch"
    fi
done

venv="$here/.build/venv"
if [ ! -x "$venv/bin/python3" ]; then
    python3 -m venv "$venv"
    "$venv/bin/pip" install --quiet "${PY_PACKAGES[@]}"
fi
export PATH="$venv/bin:$PATH"

if [ ! -x "$cp_dir/mpy-cross/build/mpy-cross" ]; then
    make -C "$cp_dir/mpy-cross" -j"$(sysctl -n hw.ncpu 2>/dev/null || nproc)"
fi

mkdir -p "$port_dir"
rsync -a --delete --exclude "build-*" "$here/port/" "$port_dir/"
upstream="$cp_dir/ports/espressif/boards/$BOARD"
cp "$upstream/board.c" "$upstream/pins.c" "$upstream/mpconfigboard.h" "$port_dir/boards/$BOARD/"

make -C "$port_dir" BOARD="$BOARD" -j"$(sysctl -n hw.ncpu 2>/dev/null || nproc)" "$@"

mkdir -p "$out_dir"
cp "$port_dir/build-$BOARD/circuitpython.mjs" "$port_dir/build-$BOARD/circuitpython.wasm" "$out_dir/"
echo "Built $out_dir/circuitpython.{mjs,wasm}"
