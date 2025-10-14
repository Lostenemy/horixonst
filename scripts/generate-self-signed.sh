#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERT_DIR_INPUT="${1:-${SCRIPT_DIR}/../certs}"
mkdir -p "${CERT_DIR_INPUT}"
CERT_DIR="$(cd "${CERT_DIR_INPUT}" && pwd)"

# Matriz de certificados a generar: nombre lógico y puerto asociado
# Los certificados se reutilizan si ya existen; en cualquier caso se
# regenera el bundle PEM y se normalizan los permisos.
declare -a CERT_TARGETS=(
  "app:8080"
  "mqtt:18083"
  "pgadmin:505"
  "pgadmin:5050"
)

subject_alt_names="DNS:localhost,DNS:horizonst.com.es,DNS:*.horizonst.com.es,IP:127.0.0.1"

ensure_certificate() {
  local name="$1"
  local port="$2"
  local prefix="${name}-${port}"
  local key_file="${CERT_DIR}/${prefix}.key"
  local cert_file="${CERT_DIR}/${prefix}.crt"
  local pem_file="${CERT_DIR}/${prefix}.pem"

  if [[ -f "${key_file}" && -f "${cert_file}" ]]; then
    echo "Certificado existente para ${name} (${port}) en ${CERT_DIR}."
  else
    echo "Generando certificado autofirmado para ${name} (${port}) en ${CERT_DIR}..."
    openssl req -x509 -nodes -newkey rsa:4096 \
      -keyout "${key_file}" \
      -out "${cert_file}" \
      -days 825 \
      -subj "/C=ES/ST=Madrid/L=Madrid/O=Horizonst/OU=${name^}/CN=${name}-${port}.horizonst.local" \
      -addext "subjectAltName=${subject_alt_names}"
  fi

  cat "${cert_file}" "${key_file}" > "${pem_file}"
  chmod 644 "${cert_file}" "${pem_file}" "${key_file}"
}

for target in "${CERT_TARGETS[@]}"; do
  IFS=":" read -r name port <<<"${target}"
  ensure_certificate "${name}" "${port}"
done

# Archivos legacy para compatibilidad con despliegues anteriores
cp "${CERT_DIR}/app-8080.crt" "${CERT_DIR}/selfsigned.crt"
cp "${CERT_DIR}/app-8080.key" "${CERT_DIR}/selfsigned.key"
cat "${CERT_DIR}/selfsigned.crt" "${CERT_DIR}/selfsigned.key" > "${CERT_DIR}/selfsigned.pem"
chmod 644 "${CERT_DIR}/selfsigned.crt" "${CERT_DIR}/selfsigned.key" "${CERT_DIR}/selfsigned.pem"

echo "Certificados disponibles en ${CERT_DIR}:"
for target in "${CERT_TARGETS[@]}"; do
  IFS=":" read -r name port <<<"${target}"
  prefix="${name}-${port}"
  echo "  ${prefix}:"
  echo "    Key : ${CERT_DIR}/${prefix}.key"
  echo "    Cert: ${CERT_DIR}/${prefix}.crt"
  echo "    PEM : ${CERT_DIR}/${prefix}.pem"
done
echo "  legacy-selfsigned:"
echo "    Key : ${CERT_DIR}/selfsigned.key"
echo "    Cert: ${CERT_DIR}/selfsigned.crt"
echo "    PEM : ${CERT_DIR}/selfsigned.pem"
