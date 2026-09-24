import { useEffect, useState } from 'react';

const STORAGE_PREFIX = 'blob-tracking:';

/**
 * Like useState, but the value is saved to localStorage under `key` and restored on the
 * next visit. Falls back to `defaultValue` when nothing is saved, the saved value can't be
 * read, or storage is unavailable (e.g. a private window).
 */
export function usePersistentState<T>(key: string, defaultValue: T) {
  const storageKey = STORAGE_PREFIX + key;

  const [value, setValue] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved === null ? defaultValue : (JSON.parse(saved) as T);
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // Storage full or blocked: the setting just won't survive a reload.
    }
  }, [storageKey, value]);

  return [value, setValue] as const;
}
