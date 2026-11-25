export interface DatasetPresentation {
  title: string;
  badge?: string;
}

const HISTORICAL_TITLES: Readonly<Record<string, DatasetPresentation>> = {
  'Ephys Atlas encoding volumes': { title: 'Encoding volumes' },
  'Ephys Atlas clusters': { title: 'Clusters' },
  'Ephys Atlas channels': { title: 'Channels' },
  'IBL Ephys Atlas channel features': { title: 'Channels' },
  'IBL Ephys Atlas — Channel Features': { title: 'Channels' },
  'IBL Ephys Atlas cluster features': { title: 'Clusters' },
  'IBL Ephys Atlas — Cluster Features': { title: 'Clusters' },
  'IBL Ephys Atlas encoding volumes': { title: 'Encoding volumes' },
  'IBL Encoding Volumes': { title: 'Encoding volumes' },
  'Allen Gene Expression Atlas': { title: 'AGEA' },
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

/** Present current product/category names without changing catalog identities. */
export function presentProjectTitle(projectId: string | undefined, title: string | undefined): string | undefined {
  if (projectId === 'ephys-atlas' && title === 'Ephys Atlas') return 'ElectRA';
  if (projectId === 'agea' && title === 'AGEA') return 'Anatomy';
  return title;
}

/** Exact reviewed titles only; arbitrary publisher labels are never stripped. */
export function presentDatasetInProject(title: string, _projectTitle?: string): string {
  const presented = presentDatasetTitle(title).title;
  return presented;
}
