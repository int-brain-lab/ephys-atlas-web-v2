import type { DatasetId } from '../../domain/types.js';
import {
  SCHEMA_VERSION,
  type DatasetManifest,
  type DatasetManifestDocument,
  type DatasetProvenance,
  type FeatureDescriptor,
  type JsonValue,
  type ProvenanceSourceRole,
  type ReleaseMetadata,
} from '../contracts.js';
import { parseBinaryArray } from './binary.js';
import {
  array,
  boolean,
  COMMIT,
  DATASET_ID_PATTERN,
  dateTime,
  jsonValue,
  object,
  parcellation,
  plainString,
  relativePath,
  SHA256,
  string,
  unique,
} from './primitives.js';

function parseRelease(value: unknown): ReleaseMetadata {
  const release = object(value, 'manifest.release');
  if (!boolean(release.immutable, 'manifest.release.immutable')) {
    throw new Error('manifest.release.immutable must be true');
  }
  let publication: ReleaseMetadata['publication'];
  if (release.publication !== undefined) {
    const raw = object(release.publication, 'manifest.release.publication');
    publication = {
      ...(raw.doi !== undefined ? { doi: plainString(raw.doi, 'manifest.release.publication.doi') } : {}),
      ...(raw.label !== undefined ? { label: plainString(raw.label, 'manifest.release.publication.label') } : {}),
    };
  }
  return {
    releaseId: string(release.release_id, 'manifest.release.release_id'),
    immutable: true,
    createdAt: dateTime(release.created_at, 'manifest.release.created_at'),
    paperSnapshot: release.paper_snapshot === undefined
      ? false
      : boolean(release.paper_snapshot, 'manifest.release.paper_snapshot'),
    ...(publication ? { publication } : {}),
  };
}

function parseProvenance(value: unknown): DatasetProvenance {
  const provenance = object(value, 'manifest.provenance');
  const roles: readonly ProvenanceSourceRole[] = [
    'scientific-code', 'canonical-data', 'selection-freeze', 'publication-input', 'user-input',
  ];
  const sources = array(provenance.sources, 'manifest.provenance.sources').map((value, index) => {
    const context = `manifest.provenance.sources[${index}]`;
    const source = object(value, context);
    if (!roles.includes(source.role as ProvenanceSourceRole)) throw new Error(`${context}.role is unsupported`);
    if (source.commit !== undefined && (typeof source.commit !== 'string' || !COMMIT.test(source.commit))) {
      throw new Error(`${context}.commit must be 7 to 40 lowercase hexadecimal characters`);
    }
    if (source.sha256 !== undefined && (typeof source.sha256 !== 'string' || !SHA256.test(source.sha256))) {
      throw new Error(`${context}.sha256 must be 64 lowercase hexadecimal characters`);
    }
    return {
      role: source.role as ProvenanceSourceRole,
      description: string(source.description, `${context}.description`),
      ...(source.repository !== undefined ? { repository: plainString(source.repository, `${context}.repository`) } : {}),
      ...(source.commit !== undefined ? { commit: source.commit } : {}),
      ...(source.path !== undefined ? { path: plainString(source.path, `${context}.path`) } : {}),
      ...(source.release !== undefined ? { release: plainString(source.release, `${context}.release`) } : {}),
      ...(source.uri !== undefined ? { uri: plainString(source.uri, `${context}.uri`) } : {}),
      ...(source.sha256 !== undefined ? { sha256: source.sha256 } : {}),
    };
  });
  if (sources.length === 0) throw new Error('manifest.provenance.sources must not be empty');
  const rawBuilder = object(provenance.builder, 'manifest.provenance.builder');
  const rawRecipe = object(provenance.recipe, 'manifest.provenance.recipe');
  const recipe: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(rawRecipe)) recipe[key] = jsonValue(item, `manifest.provenance.recipe.${key}`);
  const recipeId = string(recipe.id, 'manifest.provenance.recipe.id');
  return {
    sources,
    builder: {
      name: plainString(rawBuilder.name, 'manifest.provenance.builder.name'),
      version: plainString(rawBuilder.version, 'manifest.provenance.builder.version'),
      command: plainString(rawBuilder.command, 'manifest.provenance.builder.command'),
      ...(rawBuilder.repository !== undefined ? { repository: plainString(rawBuilder.repository, 'manifest.provenance.builder.repository') } : {}),
      ...(rawBuilder.commit !== undefined ? { commit: plainString(rawBuilder.commit, 'manifest.provenance.builder.commit') } : {}),
    },
    recipe: { ...recipe, id: recipeId },
    notes: provenance.notes === undefined
      ? []
      : array(provenance.notes, 'manifest.provenance.notes').map((item, index) => plainString(item, `manifest.provenance.notes[${index}]`)),
  };
}

export function localDatasetReleaseId(datasetId: string, releaseId: string): string {
  if (!DATASET_ID_PATTERN.test(datasetId)) throw new Error('Local dataset id has an invalid format');
  if (!releaseId) throw new Error('Local release id must be non-empty');
  return `${datasetId}@${encodeURIComponent(releaseId)}`;
}

export function parseDatasetManifestDocument(value: unknown): DatasetManifestDocument {
  const root = object(value, 'manifest');
  if (root.schema_version !== SCHEMA_VERSION) throw new Error(`manifest.schema_version must be ${SCHEMA_VERSION}`);
  const release = parseRelease(root.release);
  const provenance = parseProvenance(root.provenance);
  array(root.artifacts, 'manifest.artifacts');
  const parcellations = array(root.parcellations, 'manifest.parcellations').map((value, index) => {
    const item = object(value, `manifest.parcellations[${index}]`);
    return {
      id: parcellation(item.id, `manifest.parcellations[${index}].id`),
      regionIndex: parseBinaryArray(item.region_index, `manifest.parcellations[${index}].region_index`),
      ...(item.metadata !== undefined ? { metadata: relativePath(item.metadata, `manifest.parcellations[${index}].metadata`) } : {}),
    };
  });
  const featureRefs = array(root.features, 'manifest.features').map((value, index) => {
    const item = object(value, `manifest.features[${index}]`);
    return {
      id: string(item.id, `manifest.features[${index}].id`),
      path: relativePath(item.path, `manifest.features[${index}].path`),
    };
  });
  unique(parcellations.map((item) => item.id), 'manifest.parcellations ids');
  unique(featureRefs.map((item) => item.id), 'manifest.features ids');
  unique(featureRefs.map((item) => item.path), 'manifest.features paths');
  if (featureRefs.length === 0) throw new Error('manifest.features must not be empty');
  const datasetId = string(root.dataset_id, 'manifest.dataset_id');
  if (!DATASET_ID_PATTERN.test(datasetId)) throw new Error('manifest.dataset_id has an invalid format');
  return {
    schemaVersion: SCHEMA_VERSION,
    datasetId,
    title: string(root.title, 'manifest.title'),
    description: plainString(root.description, 'manifest.description'),
    release,
    provenance,
    parcellations,
    featureRefs,
  };
}

export function resolveDatasetManifest(
  document: DatasetManifestDocument,
  features: readonly FeatureDescriptor[],
  datasetId: DatasetId = document.datasetId as DatasetId,
): DatasetManifest {
  if (features.length !== document.featureRefs.length) {
    throw new Error('Resolved feature count does not match manifest feature references');
  }
  const parcellationDescriptors: DatasetManifest['parcellationDescriptors'] = {};
  for (const item of document.parcellations) parcellationDescriptors[item.id] = item;
  return {
    schemaVersion: SCHEMA_VERSION,
    dataset: {
      id: datasetId,
      release: document.release.releaseId,
      title: document.title,
      description: document.description,
      ...(document.datasetId === 'golden_fixture' ? { fixture: true } : {}),
    },
    release: document.release,
    provenance: document.provenance,
    parcellations: document.parcellations.map((item) => item.id),
    parcellationDescriptors,
    features,
  };
}
