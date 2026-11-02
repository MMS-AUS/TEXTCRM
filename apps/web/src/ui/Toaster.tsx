import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { Toast as ToastPrimitive } from 'radix-ui';
import { useSyncExternalStore } from 'react';
import { IconButton } from './Button.tsx';
import { cn } from './cn.ts';
import { dismissToast, getToasts, subscribeToasts, type ToastTone } from './toast-store.ts';

const ICONS: Record<ToastTone, typeof Info> = {
  neutral: Info,
  success: CircleCheck,
  danger: CircleAlert,
};

const ICON_COLOURS: Record<ToastTone, string> = {
  neutral: 'text-fg-muted',
  success: 'text-success',
  danger: 'text-danger',
};

/** Renders toasts raised with `toast()`. Mount once, at the root of the app. */
export function Toaster() {
  const items = useSyncExternalStore(subscribeToasts, getToasts);
  return (
    <ToastPrimitive.Provider duration={5000} swipeDirection="right" label="Notification">
      {items.map((item) => {
        const Icon = ICONS[item.tone];
        return (
          <ToastPrimitive.Root
            key={item.id}
            // Errors interrupt screen readers; everything else waits politely.
            type={item.tone === 'danger' ? 'foreground' : 'background'}
            duration={item.tone === 'danger' ? 8000 : undefined}
            onOpenChange={(open) => {
              if (!open) dismissToast(item.id);
            }}
            className={cn(
              'relative flex gap-3 rounded-lg border border-line bg-surface-raised p-3 pr-10 text-fg shadow-lg',
              'data-[state=open]:animate-slide-in-right data-[swipe=move]:translate-x-(--radix-toast-swipe-move-x)',
            )}
          >
            <Icon className={cn('mt-0.5 size-4 shrink-0', ICON_COLOURS[item.tone])} />
            <div className="flex min-w-0 flex-col gap-0.5">
              <ToastPrimitive.Title className="text-sm font-medium">
                {item.title}
              </ToastPrimitive.Title>
              {item.description && (
                <ToastPrimitive.Description className="text-sm text-fg-muted">
                  {item.description}
                </ToastPrimitive.Description>
              )}
            </div>
            <ToastPrimitive.Close asChild>
              <IconButton label="Dismiss" size="sm" className="absolute top-2 right-2">
                <X />
              </IconButton>
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        );
      })}
      <ToastPrimitive.Viewport className="fixed right-0 bottom-0 z-[100] flex w-full max-w-sm flex-col gap-2 p-4 outline-none" />
    </ToastPrimitive.Provider>
  );
}
