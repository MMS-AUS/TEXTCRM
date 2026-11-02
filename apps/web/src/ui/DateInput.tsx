import type { ComponentProps } from 'react';
import { Input } from './Input.tsx';

/**
 * A date field (YYYY-MM-DD) using the browser's own date picker — keyboard-accessible and
 * localised (dd/mm/yyyy in Australia) with no extra library.
 */
export function DateInput({
  value,
  onChange,
  ...props
}: Omit<ComponentProps<typeof Input>, 'type' | 'value' | 'onChange'> & {
  value: string | null | undefined;
  onChange: (value: string) => void;
}) {
  return (
    <Input
      type="date"
      value={value ?? ''}
      onChange={(event) => {
        onChange(event.target.value);
      }}
      {...props}
    />
  );
}
