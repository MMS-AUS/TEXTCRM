import { X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { IconButton } from './Button.tsx';
import { cn } from './cn.ts';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

type ContentProps = Omit<ComponentProps<typeof DialogPrimitive.Content>, 'title'> & {
  /** Required: announced to screen readers when the dialog opens. */
  title: string;
  description?: ReactNode;
  /** Hide the title visually (still announced), e.g. for a search palette. */
  hideTitle?: boolean;
};

// Radix links the description automatically; without one it needs an explicit "none".
function noDescription(description: ReactNode) {
  return description ? {} : { 'aria-describedby': undefined };
}

function Overlay() {
  return (
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
  );
}

function Header({
  title,
  description,
  hideTitle,
}: {
  title: string;
  description?: ReactNode;
  hideTitle?: boolean;
}) {
  return (
    <div className={cn('flex flex-col gap-1 px-5 pt-5 pr-12', hideTitle && 'sr-only')}>
      <DialogPrimitive.Title className="text-lg font-semibold tracking-tight">
        {title}
      </DialogPrimitive.Title>
      {description ? (
        <DialogPrimitive.Description className="text-sm text-fg-muted">
          {description}
        </DialogPrimitive.Description>
      ) : null}
    </div>
  );
}

function CloseButton() {
  return (
    <DialogPrimitive.Close asChild>
      <IconButton label="Close" size="sm" className="absolute top-3.5 right-3.5">
        <X />
      </IconButton>
    </DialogPrimitive.Close>
  );
}

/** A centred modal. Put the body in DialogBody and the buttons in DialogFooter. */
export function DialogContent({
  title,
  description,
  hideTitle,
  className,
  children,
  ...props
}: ContentProps) {
  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content
        {...noDescription(description)}
        className={cn(
          'fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col',
          'rounded-xl border border-line bg-surface-raised text-fg shadow-lg outline-none data-[state=open]:animate-pop-in',
          className,
        )}
        {...props}
      >
        <Header title={title} description={description} hideTitle={hideTitle} />
        {!hideTitle && <CloseButton />}
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogBody({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('min-h-0 overflow-y-auto px-5 py-4', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex flex-col-reverse gap-2 border-t border-line px-5 py-3 sm:flex-row sm:justify-end',
        className,
      )}
      {...props}
    />
  );
}

/** A panel that slides in from the side: record previews, filters, mobile navigation. */
export function DrawerContent({
  title,
  description,
  hideTitle,
  side = 'right',
  className,
  children,
  ...props
}: ContentProps & { side?: 'left' | 'right' }) {
  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content
        {...noDescription(description)}
        className={cn(
          'fixed inset-y-0 z-50 flex w-[min(28rem,calc(100%-3rem))] flex-col bg-surface-raised text-fg shadow-lg outline-none',
          side === 'right'
            ? 'right-0 border-l border-line data-[state=open]:animate-slide-in-right'
            : 'left-0 border-r border-line data-[state=open]:animate-slide-in-left',
          className,
        )}
        {...props}
      >
        <Header title={title} description={description} hideTitle={hideTitle} />
        <CloseButton />
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export { Dialog as Drawer, DialogTrigger as DrawerTrigger, DialogClose as DrawerClose };
