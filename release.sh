#!/bin/bash

# Builds and pushes the md-bug server image to Docker Hub as
# xerofuzzion/md-bug:<tag>, where <tag> is "v<N>-<arch>" plus "latest-<arch>".
#
# amd64 is built by default. arm64 is only built when --arm64 is passed: the
# backend is compiled from Rust source, so an arm64 build on an x86 host runs
# under QEMU emulation and takes many minutes.
#
# Requires `docker login` for the xerofuzzion account.

# -E so the ERR trap also fires for failures inside functions/subshells
set -eE

# Change to the directory of the script
cd "$(dirname "$0")"

IMAGE_NAME="xerofuzzion/md-bug"

# File containing the version
VERSION_FILE="version.json"

# The frontend depends on standard-ts-lib as "file:../../standard-ts-lib", i.e.
# a sibling of this repo. Inside MonoParra that sibling (tools/standard-ts-lib)
# is a symlink into common/, and BuildKit does not follow symlinks out of the
# build context — so it is handed to the build as a named context instead.
STANDARD_TS_LIB="../standard-ts-lib"

BUILD_ARM64=0
for arg in "$@"; do
  case "$arg" in
    --arm64 | --all)
      BUILD_ARM64=1
      ;;
    -h | --help)
      echo "Usage: $0 [--arm64]"
      echo "  --arm64  also build and push the aarch64 image (slow: emulated Rust build)"
      exit 0
      ;;
    *)
      echo "error: unknown argument '$arg' (see --help)" >&2
      exit 1
      ;;
  esac
done

if [ ! -d "$STANDARD_TS_LIB" ]; then
  echo "error: standard-ts-lib not found at $STANDARD_TS_LIB" >&2
  echo "       the frontend build needs it as a sibling of this repo" >&2
  exit 1
fi

# Check if version.json exists, if not initialize it
if [ ! -f "$VERSION_FILE" ]; then
  echo '{"version": -1}' > "$VERSION_FILE"
fi

# Read current version
CURRENT_VERSION=$(jq -r '.version' "$VERSION_FILE")

# Increment version
NEW_VERSION=$((CURRENT_VERSION + 1))

TAGNAME="v${NEW_VERSION}"

build_and_push() {
  local platform="$1"
  local arch="$2"
  echo "Building and pushing version ${TAGNAME}-${arch} and latest-${arch}..."
  docker buildx build \
    --build-context standard_ts_lib="$STANDARD_TS_LIB" \
    --platform "$platform" \
    -t "${IMAGE_NAME}:${TAGNAME}-${arch}" -t "${IMAGE_NAME}:latest-${arch}" \
    --output type=image,push=true,compression=zstd,force-compression=true,compression-level=3 .
}

build_and_push linux/amd64 x86_64

if [ "$BUILD_ARM64" -eq 1 ]; then
  build_and_push linux/arm64 aarch64
else
  echo "Skipping aarch64 — pass --arm64 to build it."
fi

# version.json is only bumped after every push has succeeded, so a failed
# release does not burn a version number.
jq --arg v "$NEW_VERSION" '.version = ($v | tonumber)' "$VERSION_FILE" > version.tmp.json && mv version.tmp.json "$VERSION_FILE"

echo "Successfully built and pushed ${IMAGE_NAME}:${TAGNAME}-x86_64 (and latest-x86_64)"
if [ "$BUILD_ARM64" -eq 1 ]; then
  echo "Successfully built and pushed ${IMAGE_NAME}:${TAGNAME}-aarch64 (and latest-aarch64)"
fi
echo "version.json updated to version ${NEW_VERSION}"
