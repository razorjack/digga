export interface IntegerRange {
  min?: number;
  max?: number;
}

export function parseInteger(input: string, range: IntegerRange = {}): number | null {
  if (!/^-?\d+$/.test(input)) return null;
  const value = Number(input);
  if (!Number.isSafeInteger(value)) return null;
  if (value < (range.min ?? 0) || value > (range.max ?? Number.MAX_SAFE_INTEGER)) return null;
  return value;
}
