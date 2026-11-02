export type ToastTone = 'neutral' | 'success' | 'danger';

export type ToastItem = {
  id: number;
  title: string;
  description?: string;
  tone: ToastTone;
};

let toasts: readonly ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeToasts(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getToasts(): readonly ToastItem[] {
  return toasts;
}

/**
 * Show a brief message, e.g. `toast({ title: 'Lead saved', tone: 'success' })`.
 * Errors that need action belong on the page, not only in a toast.
 */
export function toast({
  title,
  description,
  tone = 'neutral',
}: {
  title: string;
  description?: string;
  tone?: ToastTone;
}): number {
  const id = nextId++;
  toasts = [...toasts, { id, title, description, tone }].slice(-4);
  emit();
  return id;
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((item) => item.id !== id);
  emit();
}
