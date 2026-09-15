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

/** Preserve the stable AGEA project identity while presenting its broader category. */
export function presentProjectTitle(projectId: string | undefined, title: string | undefined): string | undefined {
  if (projectId === 'agea' && title === 'AGEA') return 'Anatomy';
  return title;
}

/** Exact reviewed titles only; arbitrary publisher labels are never stripped. */
export function presentDatasetInProject(title: string, projectTitle?: string): string {
  const presented = presentDatasetTitle(title).title;
  if (projectTitle === 'Ephys Atlas') {
    const names: Readonly<Record<string, string>> = {
      'Ephys Atlas channels': 'Channels',
      'Ephys Atlas clusters': 'Clusters',
      'Ephys Atlas encoding volumes': 'Encoding volumes',
    };
    return names[presented] ?? presented;
  }
  if (projectTitle === 'Brain-Wide Map' && presented === 'Brain-Wide Map') return 'Preserved legacy results';
  return presented;
}
