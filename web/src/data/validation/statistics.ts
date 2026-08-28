import {
  parseRegionalStatisticsResource,
  type RegionalStatisticsResource,
} from '../regional-data.js';

export type StatisticsDocument = RegionalStatisticsResource;

/** Strict schema-v1 regional statistics parser shared by HTTP and local graph readers. */
export const parseStatisticsDocument = parseRegionalStatisticsResource;
