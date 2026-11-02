import { Sun } from 'lucide-react';
import { useTheme } from '../lib/theme.ts';
import { cn } from '../ui/cn.ts';

/**
 * The product logo. Make My Solar theme: the real logos from /public (square when the sidebar
 * is collapsed, full when expanded). Graphite theme: the neutral sun mark.
 * The logos are navy on transparent, so dark themes put them on a white plate.
 */
export function BrandMark({
  variant = 'square',
  size = 'md',
  className,
}: {
  variant?: 'square' | 'full';
  size?: 'md' | 'lg';
  className?: string;
}) {
  const { style } = useTheme();
  const large = size === 'lg';

  if (style === 'mms') {
    return variant === 'square' ? (
      <img
        src="/mms-logo-square.png"
        alt="Make My Solar"
        className={cn(
          'shrink-0 rounded-full object-contain dark:bg-white dark:p-px',
          large ? 'size-14' : 'size-8',
          className,
        )}
      />
    ) : (
      <img
        src="/mms-logo-full.png"
        alt="Make My Solar"
        className={cn(
          'w-auto shrink-0 object-contain dark:rounded-md dark:bg-white dark:px-1.5 dark:py-0.5',
          large ? 'h-16' : 'h-11',
          className,
        )}
      />
    );
  }

  const tile = (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center bg-fg text-sun shadow-sm',
        large ? 'size-10 rounded-lg [&_svg]:size-5' : 'size-7 rounded-md [&_svg]:size-4',
        variant === 'square' && className,
      )}
    >
      <Sun strokeWidth={2.5} />
    </span>
  );
  if (variant === 'square') {
    return (
      <>
        {tile}
        <span className="sr-only">MMS CRM</span>
      </>
    );
  }
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      {tile}
      <span className={cn('font-semibold tracking-tight', large && 'text-lg')}>MMS CRM</span>
    </span>
  );
}
