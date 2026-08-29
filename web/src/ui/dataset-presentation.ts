export interface DatasetPresentation {
  title: string;
  badge?: string;
}

const HISTORICAL_TITLES: Readonly<Record<string, DatasetPresentation>> = {
  'IBL Ephys Atlas channel features': { title: 'IBL Ephys Atlas — Channel Features' },
  'IBL Ephys Atlas cluster features': { title: 'IBL Ephys Atlas — Cluster Features' },
  'IBL Ephys Atlas encoding volumes': { title: 'IBL Encoding Volumes' },
  'IBL Brain-Wide Map legacy website snapshot': {
    title: 'IBL Brain-Wide Map',
    badge: 'Legacy snapshot',
  },
};

/**
 * Keeps already-built immutable releases readable while new builders emit the
 * concise catalog titles directly. Publisher-defined titles pass through.
 */
export function presentDatasetTitle(title: string): DatasetPresentation {
  return HISTORICAL_TITLES[title] ?? { title };
}
