export interface DatasetPresentation {
  title: string;
  badge?: string;
}

const HISTORICAL_TITLES: Readonly<Record<string, DatasetPresentation>> = {
  'IBL Ephys Atlas channel features': { title: 'Ephys Atlas channels' },
  'IBL Ephys Atlas — Channel Features': { title: 'Ephys Atlas channels' },
  'IBL Ephys Atlas cluster features': { title: 'Ephys Atlas clusters' },
  'IBL Ephys Atlas — Cluster Features': { title: 'Ephys Atlas clusters' },
  'IBL Ephys Atlas encoding volumes': { title: 'Ephys Atlas encoding volumes' },
  'IBL Encoding Volumes': { title: 'Ephys Atlas encoding volumes' },
  'IBL Brain-Wide Map legacy website snapshot': {
    title: 'Brain-Wide Map',
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
