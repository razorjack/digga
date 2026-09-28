import { parseInteger, type IntegerRange } from "../shared/integer.ts";

export function integerOption(
  input: string | undefined,
  name: string,
  range: IntegerRange = {},
): number | undefined {
  if (input === undefined) return undefined;
  const value = parseInteger(input, range);
  if (value !== null) return value;
  const min = range.min ?? 0;
  const max = range.max ?? Number.MAX_SAFE_INTEGER;
  throw new Error(`--${name} must be an integer from ${min} to ${max}`);
}
