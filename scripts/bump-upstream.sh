#!/bin/bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "${root}"

api_url="${MESHCENTRAL_RELEASES_URL:-https://api.github.com/repos/Ylianst/MeshCentral/releases/latest}"
image_repo="ghcr.io/ylianst/meshcentral"
image_name="ylianst/meshcentral"

curl_args=(-fsSL -H "Accept: application/vnd.github+json" -H "User-Agent: meshcentral-cloudron")
if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    curl_args+=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
fi

latest="$(curl "${curl_args[@]}" "${api_url}" | python3 -c '
import json, sys
release = json.load(sys.stdin)
if release.get("draft") or release.get("prerelease"):
    raise SystemExit("latest GitHub release is a draft or prerelease")
tag = release.get("tag_name") or ""
if tag.startswith("v"):
    tag = tag[1:]
if not tag:
    raise SystemExit("GitHub did not return a MeshCentral release tag")
print(tag)
')"

if [[ ! "${latest}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Refusing non-semver MeshCentral tag: ${latest}" >&2
    exit 1
fi

current="$(sed -n 's/^FROM ghcr.io\/ylianst\/meshcentral:\([0-9.]*\)-postgresql$/\1/p' Dockerfile)"
if [[ -z "${current}" ]]; then
    echo "Could not read the pinned MeshCentral version from Dockerfile" >&2
    exit 1
fi

write_output() {
    local name="$1"
    local value="$2"
    echo "${name}=${value}"
    if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
        echo "${name}=${value}" >> "${GITHUB_OUTPUT}"
    fi
}

# GHCR anonymous manifest reads need a pull token. 200 means the tag exists.
# 404 means the release is published but the image is not ready yet.
upstream_image_published() {
    local tag="$1"
    local token code
    token="$(curl -fsSL "https://ghcr.io/token?service=ghcr.io&scope=repository:${image_name}:pull" | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')"
    code="$(curl -sS -o /dev/null -w '%{http_code}' \
        -H "Authorization: Bearer ${token}" \
        -H "Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json" \
        "https://ghcr.io/v2/${image_name}/manifests/${tag}-postgresql")"
    if [[ "${code}" == "200" ]]; then
        return 0
    fi
    if [[ "${code}" == "404" ]]; then
        return 1
    fi
    echo "Could not check ${image_repo}:${tag}-postgresql (HTTP ${code})" >&2
    exit 1
}

if [[ "${current}" == "${latest}" && "${FORCE_BUMP:-}" != "true" ]]; then
    echo "Already at MeshCentral ${latest}"
    write_output changed false
    write_output version "${latest}"
    exit 0
fi

if [[ "${current}" != "${latest}" ]]; then
    echo "Checking ${image_repo}:${latest}-postgresql"
    if ! upstream_image_published "${latest}"; then
        echo "Upstream image ${image_repo}:${latest}-postgresql is not available yet" >&2
        write_output changed false
        write_output version "${current}"
        exit 0
    fi
    sed -i "s|FROM ghcr.io/ylianst/meshcentral:${current}-postgresql|FROM ghcr.io/ylianst/meshcentral:${latest}-postgresql|" Dockerfile
fi

publish_version="$(python3 - "${root}" "${latest}" <<'PY'
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
latest = sys.argv[2]

def parse_version(value):
    parts = str(value).split(".")
    if len(parts) != 3 or any(not part.isdigit() for part in parts):
        raise SystemExit(f"Refusing non-semver version: {value}")
    return tuple(int(part) for part in parts)

manifest_path = root / "CloudronManifest.json"
original_manifest = manifest_path.read_text()
manifest = json.loads(original_manifest)
package_version = manifest.get("version")
if not package_version:
    raise SystemExit("CloudronManifest.json has no version")

latest_parts = parse_version(latest)
package_parts = parse_version(package_version)

# The package version matches the MeshCentral release when that release is
# newer. Never write a lower MeshCentral number over a higher package version.
if latest_parts > package_parts:
    manifest["version"] = latest
    manifest["upstreamVersion"] = latest
    publish = latest
    changelog_path = root / "CHANGELOG"
    body = changelog_path.read_text() if changelog_path.exists() else ""
    header = f"[{latest}]"
    if header not in body:
        if body and not body.endswith("\n"):
            body += "\n"
        updated = f"{header}\n* MeshCentral {latest}\n\n{body}"
        if not updated.endswith("\n"):
            updated += "\n"
        changelog_path.write_text(updated)
elif latest_parts == package_parts:
    manifest["version"] = latest
    manifest["upstreamVersion"] = latest
    publish = latest
else:
    publish = package_version
    print(
        f"MeshCentral {latest} is older than package {package_version}; keeping {package_version}",
        file=sys.stderr,
    )

updated_manifest = json.dumps(manifest, indent=2) + "\n"
if updated_manifest != original_manifest:
    manifest_path.write_text(updated_manifest)

print(publish)
PY
)"

echo "Publishing MeshCentral ${publish_version}"
write_output changed true
write_output version "${publish_version}"
