import type { AppAction } from './actions.js';
import { reduceAppState } from './reducer.js';
import type { AppState } from './types.js';

export type StoreListener = (state: AppState, action: AppAction) => void;

export interface AppStore {
  getState(): AppState;
  dispatch(action: AppAction): void;
  subscribe(listener: StoreListener): () => void;
}

export function createAppStore(initialState: AppState): AppStore {
  let state = initialState;
  const listeners = new Set<StoreListener>();

  return {
    getState: () => state,
    dispatch(action) {
      const next = reduceAppState(state, action);
      if (next === state) return;
      state = next;
      for (const listener of listeners) listener(state, action);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
