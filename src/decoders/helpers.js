export const hexToBytes = (hex) => {
  if (!hex) {
    return new Uint8Array();
  }
  const clean = hex.replace(/\s+/g, '').toLowerCase();
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.slice(i, i + 2), 16);
  }
  return bytes;
};

export const bufferToSignedInt = (hi, lo) => {
  const value = (hi << 8) | lo;
  return value > 0x7fff ? value - 0x10000 : value;
};

export const roundMetric = (value) => {
  if (value === undefined || value === null || Number.isNaN(Number(value))) {
    return null;
  }
  return Math.round(Number(value) * 1000) / 1000;
};
