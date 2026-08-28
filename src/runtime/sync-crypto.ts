export type SyncCrypto = {
  randomUUID(): string;
  hmacSha256Hex(secret: string, data: string | Uint8Array): string;
  hmacSha512Hex(secret: string, data: string | Uint8Array): string;
  timingSafeEqualBytes(left: Uint8Array, right: Uint8Array): boolean;
  timingSafeEqualUtf8(left: string, right: string): boolean;
};

let installed: SyncCrypto | null = null;

export function installSyncCrypto(crypto: SyncCrypto): void {
  installed = crypto;
}

export function getSyncCrypto(): SyncCrypto | null {
  return installed;
}
