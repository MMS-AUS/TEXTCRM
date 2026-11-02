import { Check } from 'lucide-react';
import { DropdownMenu as Menu } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from './cn.ts';

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;
export const DropdownMenuGroup = Menu.Group;

export function DropdownMenuContent({
  className,
  sideOffset = 4,
  align = 'start',
  ...props
}: ComponentProps<typeof Menu.Content>) {
  return (
    <Menu.Portal>
      <Menu.Content
        sideOffset={sideOffset}
        align={align}
        className={cn(
          'z-50 max-h-(--radix-dropdown-menu-content-available-height) min-w-44 origin-(--radix-dropdown-menu-content-transform-origin) overflow-y-auto',
          'rounded-lg border border-line bg-surface-raised p-1 text-sm text-fg shadow-md data-[state=open]:animate-pop-in',
          className,
        )}
        {...props}
      />
    </Menu.Portal>
  );
}

const itemBase =
  'relative flex h-8 cursor-default items-center gap-2 rounded-md px-2 outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-surface-2 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-fg-muted';

export function DropdownMenuItem({
  className,
  destructive = false,
  ...props
}: ComponentProps<typeof Menu.Item> & { destructive?: boolean }) {
  return (
    <Menu.Item
      className={cn(
        itemBase,
        destructive &&
          'text-danger-text data-highlighted:bg-danger-subtle [&_svg]:text-danger-text',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: ComponentProps<typeof Menu.CheckboxItem>) {
  return (
    <Menu.CheckboxItem className={cn(itemBase, 'pl-8', className)} {...props}>
      <span className="absolute left-2 flex size-4 items-center justify-center">
        <Menu.ItemIndicator>
          <Check className="text-fg!" />
        </Menu.ItemIndicator>
      </span>
      {children}
    </Menu.CheckboxItem>
  );
}

export const DropdownMenuRadioGroup = Menu.RadioGroup;

export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: ComponentProps<typeof Menu.RadioItem>) {
  return (
    <Menu.RadioItem className={cn(itemBase, 'pl-8', className)} {...props}>
      <span className="absolute left-2 flex size-4 items-center justify-center">
        <Menu.ItemIndicator>
          <span className="block size-1.5 rounded-full bg-fg" />
        </Menu.ItemIndicator>
      </span>
      {children}
    </Menu.RadioItem>
  );
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof Menu.Label>) {
  return (
    <Menu.Label
      className={cn('px-2 pt-1.5 pb-1 text-xs font-medium text-fg-subtle', className)}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof Menu.Separator>) {
  return <Menu.Separator className={cn('-mx-1 my-1 h-px bg-line', className)} {...props} />;
}
