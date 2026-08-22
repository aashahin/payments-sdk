import { createHmac, timingSafeEqual } from "node:crypto";

import type { SyncCrypto } from "./sync-crypto";

function hmacHex(
  algorithm: "sha256" | "sha512",
  secret: string,
  data: string | Uint8Array,
): string {
  return createHmac(algorithm, secret).update(data).digest("hex");
}

export const nodeSyncCrypto: SyncCrypto = {
  hmacSha256Hex: (secret, data) => hmacHex("sha256", secret, data),
  hmacSha512Hex: (secret, data) => hmacHex("sha512", secret, data),
  timingSafeEqualBytes(left, right) {
    return timingSafeEqual(Buffer.from(left), Buffer.from(right));
  },
  timingSafeEqualUtf8(left, right) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    if (leftBuffer.length !== rightBuffer.length) {
      const length = Math.max(leftBuffer.length, rightBuffer.length);
      const paddedLeft = Buffer.alloc(length);
      const paddedRight = Buffer.alloc(length);
      leftBuffer.copy(paddedLeft);
      rightBuffer.copy(paddedRight);
      timingSafeEqual(paddedLeft, paddedRight);
      return false;
    }
    return timingSafeEqual(leftBuffer, rightBuffer);
  },
};
