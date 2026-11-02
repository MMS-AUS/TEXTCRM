import type { ReactElement } from 'react';
import {
  useController,
  type Control,
  type ControllerRenderProps,
  type FieldPath,
  type FieldValues,
} from 'react-hook-form';
import { Field, type FieldControlProps } from './Field.tsx';

/**
 * A Field wired to react-hook-form: label, control and the zod error for `name`.
 *
 *   <FormField control={form.control} name="email" label="Email">
 *     {(field, props) => <Input {...props} {...textInput(field)} />}
 *   </FormField>
 */
export function FormField<
  TValues extends FieldValues,
  TName extends FieldPath<TValues>,
  TOutput = TValues,
>({
  control,
  name,
  label,
  hint,
  required,
  className,
  children,
}: {
  control: Control<TValues, unknown, TOutput>;
  name: TName;
  label: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: (
    field: ControllerRenderProps<TValues, TName>,
    props: FieldControlProps,
  ) => ReactElement;
}) {
  const { field, fieldState } = useController({ control, name });
  return (
    <Field
      label={label}
      hint={hint}
      error={fieldState.error?.message}
      required={required}
      className={className}
    >
      {(props) => children(field, props)}
    </Field>
  );
}
