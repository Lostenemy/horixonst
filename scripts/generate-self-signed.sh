#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERT_DIR_INPUT="${1:-${SCRIPT_DIR}/../certs}"
mkdir -p "${CERT_DIR_INPUT}"
CERT_DIR="$(cd "${CERT_DIR_INPUT}" && pwd)"
KEY_FILE="${CERT_DIR}/selfsigned.key"
CERT_FILE="${CERT_DIR}/selfsigned.crt"
PEM_FILE="${CERT_DIR}/selfsigned.pem"

if [[ -f "${KEY_FILE}" && -f "${CERT_FILE}" ]]; then
  echo "Existing certificate and key found in ${CERT_DIR}. Skipping creation."
  exit 0
fi

echo "Generating self-signed certificate under ${CERT_DIR}..."
openssl req -x509 -nodes -newkey rsa:4096 \
  -keyout "${KEY_FILE}" \
  -out "${CERT_FILE}" \
  -days 825 \
  -subj "/C=ES/ST=Madrid/L=Madrid/O=Horizonst/OU=Platform/CN=*.horizonst.local" \
  -addext "subjectAltName=DNS:localhost,DNS:horizonst.com.es,DNS:*.horizonst.com.es,IP:127.0.0.1"

cat "${CERT_FILE}" "${KEY_FILE}" > "${PEM_FILE}"
chmod 600 "${KEY_FILE}" "${CERT_FILE}" "${PEM_FILE}"

echo "Self-signed certificate created:"
echo "  Key : ${KEY_FILE}"
echo "  Cert: ${CERT_FILE}"
echo "  PEM : ${PEM_FILE}"
