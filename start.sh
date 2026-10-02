#!/bin/bash
set -euo pipefail

DATA_DIR="/app/data/meshcentral-data"
FILES_DIR="/app/data/meshcentral-files"
CERT_DIR="/run/certs"
TLS_CERT="/etc/certs/tls_cert.pem"
TLS_KEY="/etc/certs/tls_key.pem"

mkdir -p "${DATA_DIR}" "${FILES_DIR}" "${CERT_DIR}"

if [[ -f "${TLS_CERT}" && -f "${TLS_KEY}" ]]; then
    cp "${TLS_CERT}" "${CERT_DIR}/tls_cert.pem"
    cp "${TLS_KEY}" "${CERT_DIR}/tls_key.pem"
    tls_source="cloudron"
elif [[ "${CLOUDRON:-}" == "1" ]]; then
    echo "Cloudron certificate is not mounted yet" >&2
    exit 1
else
    tls_source="self-signed"
    openssl req -x509 -newkey rsa:2048 -nodes \
        -keyout "${CERT_DIR}/tls_key.pem" \
        -out "${CERT_DIR}/tls_cert.pem" \
        -days 3650 \
        -subj "/CN=${CLOUDRON_APP_DOMAIN:-localhost}" \
        >/dev/null 2>&1
fi
chmod 640 "${CERT_DIR}/tls_cert.pem" "${CERT_DIR}/tls_key.pem"

node /app/pkg/configure.js
echo "startup tls=${tls_source} domain=${CLOUDRON_APP_DOMAIN:-unset}"

if id cloudron >/dev/null 2>&1; then
    chown -R cloudron:cloudron /app/data "${CERT_DIR}"
    run_as=(su-exec cloudron:cloudron)
else
    run_as=()
fi

cert_pid=""
mesh_pid=""

shutdown() {
    local status="${1:-0}"
    if [[ -n "${mesh_pid}" ]]; then
        kill -INT "${mesh_pid}" 2>/dev/null || true
        wait "${mesh_pid}" 2>/dev/null || true
    fi
    if [[ -n "${cert_pid}" ]]; then
        kill "${cert_pid}" 2>/dev/null || true
        wait "${cert_pid}" 2>/dev/null || true
    fi
    exit "${status}"
}
trap 'shutdown 0' SIGTERM SIGINT

node /app/pkg/cert-listener.js &
cert_pid=$!

cd /opt/meshcentral/meshcentral
"${run_as[@]}" node meshcentral --datapath "${DATA_DIR}" &
mesh_pid=$!
wait "${mesh_pid}"
status=$?
mesh_pid=""
shutdown "${status}"
