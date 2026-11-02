import { Check, ChevronDown } from 'lucide-react';
import { Select as SelectPrimitive } from 'radix-ui';
import { cn } from './cn.ts';

export type SelectOption = { value: string; label: string; disabled?: boolean };

/**
 * Pick one value from a short list (up to ~15 options). Works inside Field:
 *   <Field label="State">{(props) => <Select options={states} {...props} />}</Field>
 */
export function Select({
  options,
  value,
  defaultValue,
  onValueChange,
  placeholder = 'Select…',
  disabled,
  invalid,
  id,
  className,
  name,
  ...aria
}: {
  options: readonly SelectOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  name?: string;
  className?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
}) {
  return (
    <SelectPrimitive.Root
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
      disabled={disabled}
      name={name}
    >
      <SelectPrimitive.Trigger
        id={id}
        aria-invalid={invalid || undefined}
        {...aria}
        className={cn(
          'flex h-8 w-full min-w-0 cursor-pointer items-center justify-between gap-2 rounded-md border border-line-strong bg-surface px-2.5 text-sm text-fg shadow-xs',
          'transition-[border-color,box-shadow] duration-100 outline-none hover:border-fg-subtle/60',
          'focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-ring data-[state=open]:border-accent',
          'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-fg-muted',
          'aria-invalid:border-danger data-placeholder:text-fg-subtle',
          className,
        )}
      >
        <span className="truncate">
          <SelectPrimitive.Value placeholder={placeholder} />
        </span>
        <SelectPrimitive.Icon>
          <ChevronDown className="size-4 text-fg-subtle" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="z-50 max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) overflow-hidden rounded-lg border border-line bg-surface-raised text-sm text-fg shadow-md data-[state=open]:animate-pop-in"
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className="relative flex h-8 cursor-default items-center rounded-md pr-2 pl-8 outline-none select-none data-disabled:opacity-50 data-highlighted:bg-surface-2"
              >
                <span className="absolute left-2 flex size-4 items-center justify-center">
                  <SelectPrimitive.ItemIndicator>
                    <Check className="size-4" />
                  </SelectPrimitive.ItemIndicator>
                </span>
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
