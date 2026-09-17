export function seenHelpTourStorageState(origin: string) {
  return {
    cookies: [],
    origins: [{
      origin,
      localStorage: [{ name: 'ibl-ephys-atlas:help-tour-seen:v1', value: 'seen' }],
    }],
  };
}
