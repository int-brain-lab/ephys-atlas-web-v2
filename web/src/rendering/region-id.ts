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

export function regionIdFromAtlasAttributes(
  mapping: MappingName,
  attribute: (name: string) => string | null,
): number | null {
  const value = attribute(`data-${mapping}-id`);
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

export function regionIdFromPath(mapping: MappingName, path: SVGPathElement): number | null {
  return regionIdFromAtlasAttributes(mapping, (name) => path.getAttribute(name))
    ?? regionIdFromClassNames(mapping, path.classList);
}
