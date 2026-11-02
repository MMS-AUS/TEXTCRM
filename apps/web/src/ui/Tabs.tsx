import { Tabs as TabsPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn, focusRing } from './cn.ts';

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn('flex gap-4 overflow-x-auto border-b border-line', className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'relative -mb-px flex h-9 shrink-0 cursor-pointer items-center gap-1.5 border-b-2 border-transparent px-0.5 text-sm font-medium whitespace-nowrap text-fg-muted transition-colors',
        'hover:text-fg data-[state=active]:border-highlight data-[state=active]:text-fg',
        'disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4',
        focusRing,
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn('pt-4 outline-none', className)} {...props} />;
}
