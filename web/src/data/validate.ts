/**
 * Public validation facade.
 *
 * Keep callers on this module while the contract implementation stays split by
 * concern under data/validation/. This lets schemas evolve without turning a
 * single validator file into another application subsystem.
 */
export { decodeBinaryArray, parseBinaryArray } from './validation/binary.js';
export { parseDatasetCatalog } from './validation/catalog.js';
export { parseFeatureDescriptor } from './validation/feature.js';
export {
  localDatasetReleaseId,
  parseDatasetManifestDocument,
  resolveDatasetManifest,
} from './validation/manifest.js';
export {
  sha256Hex,
  validateLocalDatasetFiles,
  type ValidatedLocalDataset,
} from './validation/local-dataset.js';
export { parseFeaturePayload } from './validation/payload.js';
export { parseStatisticsDocument, type StatisticsDocument } from './validation/statistics.js';
