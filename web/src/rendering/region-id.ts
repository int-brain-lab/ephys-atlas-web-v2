import type { MappingName } from './types.js';

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
  return regionIdFromAtlasAttributes(mapping, (name) => path.getAttribute(name));
}
