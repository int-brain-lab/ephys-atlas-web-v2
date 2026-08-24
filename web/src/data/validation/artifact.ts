import type { ArtifactDescriptor, ArtifactRole } from '../contracts.js';
import { parseEncodedResource } from './binary.js';
import { array, object, plainString, string, unique } from './primitives.js';

const ARTIFACT_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const ARTIFACT_ROLES: readonly ArtifactRole[] = [
  'current-feature',
  'selected-data',
  'source-snapshot',
  'auxiliary',
  'whole-release',
];

export function parseArtifactDescriptors(value: unknown, context: string): ArtifactDescriptor[] {
  const artifacts = array(value, context).map((raw, index) => {
    const itemContext = `${context}[${index}]`;
    const item = object(raw, itemContext);
    const id = string(item.id, `${itemContext}.id`);
    if (!ARTIFACT_ID.test(id)) throw new Error(`${itemContext}.id has an invalid format`);
    if (!ARTIFACT_ROLES.includes(item.role as ArtifactRole)) {
      throw new Error(`${itemContext}.role is unsupported`);
    }
    return {
      id,
      role: item.role as ArtifactRole,
      resource: parseEncodedResource(item.resource, `${itemContext}.resource`),
      ...(item.description !== undefined
        ? { description: plainString(item.description, `${itemContext}.description`) }
        : {}),
    };
  });
  unique(artifacts.map((artifact) => artifact.id), `${context} ids`);
  return artifacts;
}
