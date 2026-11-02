import { hasPermission, type Feature, type PermissionAction } from '@mms/shared';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useProfile } from '../auth/auth-context.ts';
import { useTRPC } from './trpc.ts';

/** `value`, updated only after it has stopped changing for `delayMs` (e.g. search boxes). */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [value, delayMs]);
  return debounced;
}

/**
 * Merges patches made in the same tick into one call — e.g. a table changing sort and page
 * together becomes a single URL update instead of two racing ones.
 */
export function useBatchedPatch<T extends object>(apply: (patch: Partial<T>) => void) {
  const applyRef = useRef(apply);
  const pending = useRef<Partial<T> | null>(null);
  useEffect(() => {
    applyRef.current = apply;
  });
  return useCallback((patch: Partial<T>) => {
    const first = pending.current === null;
    pending.current = { ...pending.current, ...patch };
    if (!first) return;
    queueMicrotask(() => {
      const merged = pending.current;
      pending.current = null;
      if (merged) applyRef.current(merged);
    });
  }, []);
}

/** Whether the signed-in user's role allows `action` on `feature` (the API checks again). */
export function useCan() {
  const { permissions } = useProfile();
  return (feature: Feature, action: PermissionAction) =>
    hasPermission(permissions, feature, action);
}

/** Active options of option lists, as Select options; cached for five minutes. */
export function useOptions<const K extends string>(keys: readonly K[]) {
  const trpc = useTRPC();
  const query = useQuery({
    ...trpc.optionLists.options.queryOptions({ keys: [...keys] }),
    staleTime: 5 * 60_000,
  });
  return {
    ...query,
    options: (key: K) => query.data?.[key] ?? [],
  };
}
