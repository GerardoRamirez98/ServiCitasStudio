const listeners = new Set<() => void>();

export function notifyOrganizationDataChanged() {
  listeners.forEach((listener) => listener());
}

export function subscribeToOrganizationDataChanges(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
