import { Sun } from 'lucide-react';
import { cn } from '../ui/cn.ts';

/** Placeholder logo mark until the real Make My Solar logo arrives (Task T-13). */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-7 place-items-center rounded-md bg-fg text-sun shadow-sm [&_svg]:size-4',
        className,
      )}
    >
      <Sun strokeWidth={2.5} />
    </span>
  );
}
