/** Semantic validator used by the shared cross-language schema-v1 corpus. */

import { parseDatasetCatalog } from './catalog.js';
import { parseMetadataBundle, parseMetadataBundleResource } from './metadata-bundle.js';
import {
  fail,
  object,
  array,
  required,
  exactKeys,
  expect,
  unique,
  resourceSemantics,
} from './schema-v1-common.js';
import { summarySemantics, statisticsSemantics, featureDisplaySemantics } from './schema-v1-distributions.js';
import { volumeSemantics, indexSemantics } from './schema-v1-volume.js';
import {
  registeredSemantics,
  registeredResourceIndexSemantics,
  staticSemantics,
  packSemantics,
} from './schema-v1-projections.js';
import { meshPackSemantics } from './schema-v1-mesh.js';
import { regionNavigationSemantics } from './schema-v1-navigation.js';

export function validateSchemaV1Document(value: unknown, schemaName: string): void {
  const document = object(value, schemaName);
  resourceSemantics(document);
  switch (schemaName) {
    case 'alias.schema.json':
      exactKeys(document, ['schema_version', 'dataset_id', 'alias', 'release_id'], 'alias');
      expect(document.schema_version, '1.0', 'schema version');
      break;
    case 'artifact.schema.json':
      required(document, ['id', 'role', 'resource'], 'artifact');
      break;
    case 'catalog.schema.json': {
      parseDatasetCatalog(document);
      break;
    }
    case 'provenance.schema.json':
      required(document, ['sources', 'builder', 'recipe'], 'provenance');
      break;
    case 'regional.schema.json': {
      expect(document.format, 'ephys-atlas-regional-v1', 'regional format');
      const parcellations = array(document.parcellations, 'regional parcellations').map((item) => object(item, 'parcellation'));
      unique(parcellations.map((item) => item.parcellation_id), 'regional parcellation id');
      break;
    }
    case 'statistics.schema.json':
      statisticsSemantics(document);
      break;
    case 'volume-summary.schema.json':
      summarySemantics(document);
      break;
    case 'volume-resource-index.schema.json':
      indexSemantics(document);
      break;
    case 'volume.schema.json':
      volumeSemantics(document);
      break;
    case 'feature.schema.json': {
      const representations = object(document.representations, 'feature representations');
      if (representations.regional !== undefined) validateSchemaV1Document(representations.regional, 'regional.schema.json');
      if (representations.volume !== undefined) validateSchemaV1Document(representations.volume, 'volume.schema.json');
      featureDisplaySemantics(document);
      break;
    }
    case 'dataset.schema.json': {
      if (document.metadata_bundle !== undefined) parseMetadataBundleResource(document.metadata_bundle);
      const features = array(document.features, 'dataset features').map((item) => object(item, 'feature'));
      unique(features.map((item) => item.id), 'feature id');
      unique(features.map((item) => object(object(item.descriptor, 'descriptor').resource, 'resource').path), 'feature path');
      break;
    }
    case 'metadata-bundle.schema.json':
      parseMetadataBundle(document);
      break;
    case 'registered-projection.schema.json':
      registeredSemantics(document);
      break;
    case 'registered-svg-resource-index.schema.json':
      registeredResourceIndexSemantics(document);
      break;
    case 'static-projection.schema.json':
      staticSemantics(document);
      break;
    case 'projection-pack.schema.json':
      packSemantics(document);
      break;
    case 'mesh-pack.schema.json':
      meshPackSemantics(document);
      break;
    case 'region-navigation.schema.json':
      regionNavigationSemantics(document);
      break;
    default:
      fail(`unknown schema ${schemaName}`);
  }
}
