const listeners = new Set<() => void>();

export function subscribeToAuthChanges(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyAuthChanged() {
  listeners.forEach((listener) => listener());
}
