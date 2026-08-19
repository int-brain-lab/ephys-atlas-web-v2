import type { MappingName } from './types.js';

export function regionIdFromClassNames(mapping: MappingName, classNames: Iterable<string>): number | null {
  const prefix = `${mapping}_region_`;
  for (const className of classNames) {
    if (!className.startsWith(prefix)) continue;
    const value = Number.parseInt(className.slice(prefix.length), 10);
    if (Number.isInteger(value)) return value;
  }
  return null;
}
