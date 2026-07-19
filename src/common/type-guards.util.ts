export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isHex64(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

export function isHex128(value: string): boolean {
  return /^[a-f0-9]{128}$/i.test(value);
}
