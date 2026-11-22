#!/usr/bin/env bash
# Creates the GitHub Release (and tag v<version>) for the version in upstream.json, if missing.
# Runs in CI after a successful npm publish; needs GH_TOKEN with contents: write.
set -euo pipefail
version=$(jq -r .version upstream.json)
commit=$(jq -r .commit upstream.json)
scope=$(jq -r .npmScope config.json)
suffix=$(jq -r .packageSuffix config.json)
tag="v$version"

if gh release view "$tag" >/dev/null 2>&1; then
  echo "release $tag already exists"
  exit 0
fi

pkgs=""
for dim in $(jq -r '.dims[]' config.json); do
  name="$scope/rapier${dim}d-$suffix"
  pkgs+="- [\`$name@$version\`](https://www.npmjs.com/package/$name/v/$version)"$'\n'
done

notes=$(cat <<EOF
Multi-threaded WebAssembly build of Rapier **$version** (unofficial).

### Packages
$pkgs
### Built from
Upstream [dimforge/rapier@\`${commit:0:10}\`](https://github.com/dimforge/rapier/commit/$commit), the commit
npm lists for \`@dimforge/rapier3d-simd-compat@$version\`. The physics code is unmodified; see
[NOTICE](NOTICE) for the build-time changes.

Tested in headless Chromium against the official \`-simd-compat\` packages of the same version
(same results, full API), plus Vite dev and production builds.
EOF
)

gh release create "$tag" --target "$(git rev-parse HEAD)" --title "Rapier $version (threads)" --notes "$notes"
echo "created release $tag"
