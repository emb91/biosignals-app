'use client';

import { useSyncExternalStore } from 'react';

export type SetupSection = 'company' | 'target' | 'buying';

type SetupNavigationState = {
  activeSection: SetupSection | null;
  pendingSection: SetupSection | null;
};

let state: SetupNavigationState = {
  activeSection: null,
  pendingSection: null,
};

const listeners = new Set<() => void>();

function emitChange() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): SetupNavigationState {
  return state;
}

export function useSetupNavigation(): SetupNavigationState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function requestSetupSection(section: SetupSection) {
  state = { ...state, pendingSection: section };
  emitChange();
}

export function consumePendingSetupSection(): SetupSection | null {
  const pending = state.pendingSection;
  if (pending !== null) {
    state = { ...state, pendingSection: null };
    emitChange();
  }
  return pending;
}

export function clearPendingSetupSection() {
  if (state.pendingSection === null) return;
  state = { ...state, pendingSection: null };
  emitChange();
}

export function setActiveSetupSection(section: SetupSection | null) {
  if (state.activeSection === section) return;
  state = { ...state, activeSection: section };
  emitChange();
}
