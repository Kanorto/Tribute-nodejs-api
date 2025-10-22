import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Normalize various binary inputs into a Buffer or Uint8Array.
 * @param {Buffer | ArrayBuffer | ArrayBufferView | string} rawBody
 * @returns {Buffer | Uint8Array}
 */
function normalizeBody(rawBody) {
  if (Buffer.isBuffer(rawBody)) {
    return rawBody;
  }
  if (rawBody instanceof Uint8Array) {
    return rawBody;
  }
  if (typeof rawBody === 'string') {
    return Buffer.from(rawBody);
  }
  if (rawBody instanceof ArrayBuffer) {
    return new Uint8Array(rawBody);
  }
  if (ArrayBuffer.isView(rawBody)) {
    return new Uint8Array(rawBody.buffer, rawBody.byteOffset, rawBody.byteLength);
  }
  throw new TypeError('Expected rawBody to be a Buffer, Uint8Array, ArrayBuffer or string');
}

/**
 * Calculate HMAC digest using Bun's native hasher when available, falling back to Node compatible crypto.
 * @param {Buffer | Uint8Array} body
 * @param {string} apiKey
 * @param {"hex"|"base64"} encoding
 * @returns {string}
 */
function computeDigest(body, apiKey, encoding) {
  if (typeof Bun !== 'undefined' && Bun?.CryptoHasher) {
    const hasher = new Bun.CryptoHasher('sha256', apiKey);
    hasher.update(body);
    return hasher.digest(encoding);
  }
  const source = Buffer.isBuffer(body)
    ? body
    : Buffer.from(body.buffer, body.byteOffset ?? 0, body.byteLength ?? body.length);
  const hmac = createHmac('sha256', apiKey);
  hmac.update(source);
  return hmac.digest(encoding);
}

/**
 * Verify Tribute webhook signature.
 *
 * @param {Buffer | ArrayBuffer | ArrayBufferView | string} rawBody - Raw request body.
 * @param {string | undefined | null} signatureHeader - Value of `trbt-signature` header.
 * @param {string} apiKey - Tribute API key (HMAC secret).
 * @param {"hex"|"base64"} [encoding="hex"] - Encoding used by Tribute signature header.
 * @returns {boolean}
 */
export function verifyTributeSignature(rawBody, signatureHeader, apiKey, encoding = 'hex') {
  if (!apiKey) {
    throw new Error('Tribute API key is required for signature verification');
  }

  if (!signatureHeader) {
    return false;
  }

  const normalized = normalizeBody(rawBody);
  const digest = computeDigest(normalized, apiKey, encoding);

  try {
    const expected = Buffer.from(digest, encoding);
    const provided = Buffer.from(signatureHeader, encoding);
    if (expected.length !== provided.length) {
      return false;
    }
    return timingSafeEqual(expected, provided);
  } catch (error) {
    return false;
  }
}
