import decodeMK1Payload from './mk1Decoder.js';
import { decodeAndNormalizeMK2 } from './mk2Decoder.js';

// MK3 gateways reuse the MK1 JSON protocol in most deployments but we
// keep a dedicated decoder so the behaviour can diverge in the future.
export const decodeMK3Payload = (payload) => {
  const records = decodeMK1Payload(payload);
  if (records.length > 0) {
    return records;
  }
  return decodeAndNormalizeMK2(payload);
};

export default decodeMK3Payload;
