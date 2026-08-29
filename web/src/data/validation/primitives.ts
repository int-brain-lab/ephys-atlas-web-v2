import type { ParcellationId, StatisticId } from '../../domain/types.js';
import type { BinaryDType, JsonValue } from '../contracts.js';

export const RELATIVE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+$/;
export const SHA256 = /^[0-9a-f]{64}$/;
export const DATASET_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
export const COMMIT = /^[0-9a-f]{7,40}$/;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

export function object(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function string(value: unknown, context: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${context} must be a non-empty string`);
  return value;
}

export function plainString(value: unknown, context: string): string {
  if (typeof value !== 'string') throw new Error(`${context} must be a string`);
  return value;
}

export function boolean(value: unknown, context: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${context} must be a boolean`);
  return value;
}

export function array(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${context} must be an array`);
  return value;
}

export function numberArray(value: unknown, length: number, context: string): number[] {
  const values = array(value, context);
  if (values.length !== length || values.some((item) => typeof item !== 'number' || !Number.isFinite(item))) {
    throw new Error(`${context} must contain ${length} finite numbers`);
  }
  return values as number[];
}

export function integerArray(value: unknown, length: number, context: string): number[] {
  const values = array(value, context);
  if (values.length !== length || values.some((item) => typeof item !== 'number' || !Number.isInteger(item) || item <= 0)) {
    throw new Error(`${context} must contain ${length} positive integers`);
  }
  return values as number[];
}

export function parcellation(value: unknown, context: string): ParcellationId {
  if (value !== 'allen' && value !== 'beryl' && value !== 'cosmos') {
    throw new Error(`${context} must be allen, beryl, or cosmos`);
  }
  return value;
}

export function statistic(value: unknown, context: string): StatisticId {
  if (!['mean', 'median', 'min', 'max', 'count'].includes(String(value))) {
    throw new Error(`${context} is not a supported display statistic`);
  }
  return value as StatisticId;
}

export function dtype(value: unknown, context: string): BinaryDType {
  const supported: readonly BinaryDType[] = ['uint8', 'int16', 'int32', 'uint16', 'uint32', 'float16', 'float32', 'float64'];
  if (!supported.includes(value as BinaryDType)) {
    throw new Error(`${context} has unsupported dtype ${String(value)}`);
  }
  return value as BinaryDType;
}

export function dateTime(value: unknown, context: string): string {
  const timestamp = plainString(value, context);
  const match = DATE_TIME.exec(timestamp);
  if (!match) throw new Error(`${context} must be an RFC 3339 date-time`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) throw new Error(`${context} must be an RFC 3339 date-time`);
  return timestamp;
}

export function jsonValue(value: unknown, context: string): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${context} must contain JSON values`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => jsonValue(item, `${context}[${index}]`));
  if (value && typeof value === 'object') {
    const result: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) result[key] = jsonValue(item, `${context}.${key}`);
    return result;
  }
  throw new Error(`${context} must contain JSON values`);
}

export function relativePath(value: unknown, context: string): string {
  const path = string(value, context);
  if (!RELATIVE_PATH.test(path)) throw new Error(`${context} must be a safe relative path`);
  return path;
}

export function resolveRelativePath(baseFile: string, child: string, context: string): string {
  relativePath(baseFile, `${context} base path`);
  relativePath(child, context);
  const directory = baseFile.includes('/') ? baseFile.slice(0, baseFile.lastIndexOf('/') + 1) : '';
  return `${directory}${child}`;
}

export function unique(values: readonly string[], context: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${context} must not contain duplicates`);
}

export function nullableRange(value: unknown, context: string): [number | null, number | null] {
  const values = array(value, context);
  if (values.length !== 2 || values.some((item) => item !== null && (typeof item !== 'number' || !Number.isFinite(item)))) {
    throw new Error(`${context} must contain two finite numbers or null values`);
  }
  return values as [number | null, number | null];
}

export function templatePath(
  template: string,
  replacements: Readonly<Record<string, number>>,
  context: string,
): string {
  let path = template;
  for (const [name, value] of Object.entries(replacements)) path = path.replaceAll(`{${name}}`, String(value));
  if (/\{[^}]+\}/.test(path)) throw new Error(`${context} contains an unsupported template field`);
  return relativePath(path, context);
}
