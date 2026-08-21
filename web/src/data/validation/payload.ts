import { SCHEMA_VERSION, type FeaturePayload, type RegionalFeaturePayload } from '../contracts.js';
import { array, object, parcellation, statistic, string } from './primitives.js';

export function parseFeaturePayload(value: unknown): FeaturePayload {
  const root = object(value, 'feature');
  if (root.schemaVersion !== SCHEMA_VERSION) throw new Error(`feature.schemaVersion must be ${SCHEMA_VERSION}`);
  const featureId = string(root.featureId, 'feature.featureId');
  if (root.representation === 'regional') {
    const regionIds = array(root.regionIds, 'feature.regionIds').map((v, i) => string(v, `feature.regionIds[${i}]`));
    const statisticsObject = object(root.statistics, 'feature.statistics');
    const statistics: RegionalFeaturePayload['statistics'] = {};
    for (const [key, raw] of Object.entries(statisticsObject)) {
      const stat = statistic(key, `feature.statistics.${key}`);
      const values = array(raw, `feature.statistics.${key}`).map((v, i) => {
        if (typeof v !== 'number') throw new Error(`feature.statistics.${key}[${i}] must be numeric`);
        return v;
      });
      if (values.length !== regionIds.length) {
        throw new Error(`feature.statistics.${key} length must match regionIds`);
      }
      statistics[stat] = values;
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      featureId,
      representation: 'regional',
      parcellation: parcellation(root.parcellation, 'feature.parcellation'),
      regionIds,
      statistics,
    };
  }
  throw new Error('parseFeaturePayload currently validates decoded regional payloads only');
}
