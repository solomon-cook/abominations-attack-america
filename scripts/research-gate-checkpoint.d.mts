export function sha256(value: string | Uint8Array): string;
export function createCheckpoint(path: string, header: unknown): unknown;
export function appendCheckpointPair<T extends { pairIndex: number }>(path: string, pair: T): unknown;
export function readCheckpoint<T = unknown>(
  path: string,
  options?: { repairTrailingPartialLine?: boolean },
): { header: any; pairs: T[]; validByteLength: number; discardedByteLength: number };
export function repairCheckpointTail(path: string, validByteLength: number): void;
export function assertCheckpointCompatible(
  header: any,
  expected: { campaignIdentitySha256: string; config: any; preregistration: any },
): void;
export function summarizeResearchGatePairs<T>(pairs: T[]): any;
export function validateConfirmatoryRegistration(registration: any, options: { protocol: any; dirtyGameEnginePaths: string[] }): void;
export function acquireCheckpointLock(checkpointPath: string): { path: string; metadata: any; release(): void };
