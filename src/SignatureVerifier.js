import crypto from 'crypto';

/**
 * Verify Tribute webhook signature.
 *
 * @param {Buffer} rawBody - Raw request body buffer.
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

  if (!Buffer.isBuffer(rawBody)) {
    throw new TypeError('Expected rawBody to be a Buffer produced by express.raw or equivalent');
  }

  const hmac = crypto.createHmac('sha256', apiKey);
  hmac.update(rawBody);
  const digest = hmac.digest(encoding);

  try {
    return crypto.timingSafeEqual(Buffer.from(digest, encoding), Buffer.from(signatureHeader, encoding));
  } catch (error) {
    return false;
  }
}
