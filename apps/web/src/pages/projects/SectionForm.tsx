import { Pencil } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import {
  useForm,
  type DefaultValues,
  type FieldPath,
  type FieldValues,
  type Resolver,
} from 'react-hook-form';
import { useOptions } from '../../lib/hooks.ts';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  cn,
  DateInput,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  FormField,
  Input,
  Select,
  textInput,
  type SelectOption,
} from '../../ui/index.ts';
import { useProjectSave } from './use-project-save.ts';

const NONE = '__none';

/** A workspace card: title, optional status badge, Edit button. */
export function SectionCard({
  title,
  badge,
  editable,
  onEdit,
  children,
}: {
  title: string;
  badge?: ReactNode;
  editable: boolean;
  onEdit: () => void;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader
        actions={
          editable && (
            <Button size="sm" variant="ghost" onClick={onEdit}>
              <Pencil />
              Edit
            </Button>
          )
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>{title}</CardTitle>
          {badge}
        </div>
      </CardHeader>
      <CardContent className="py-1">{children}</CardContent>
    </Card>
  );
}

export function FormFooter({ onCancel, saving }: { onCancel: () => void; saving: boolean }) {
  return (
    <DialogFooter>
      <Button variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" variant="primary" loading={saving}>
        Save
      </Button>
    </DialogFooter>
  );
}

/** A card whose Edit button opens `form` in a dialog. */
export function EditableSection({
  title,
  badge,
  editable,
  description,
  form,
  children,
}: {
  title: string;
  badge?: ReactNode;
  editable: boolean;
  description?: string;
  form: (close: () => void) => ReactNode;
  children: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <>
      <SectionCard
        title={title}
        badge={badge}
        editable={editable}
        onEdit={() => {
          setEditing(true);
        }}
      >
        {children}
      </SectionCard>
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent title={title} description={description} className="max-w-2xl">
          {editing &&
            form(() => {
              setEditing(false);
            })}
        </DialogContent>
      </Dialog>
    </>
  );
}

type Common<T extends FieldValues> = {
  name: FieldPath<T>;
  label: string;
  hint?: string;
  /** Takes the full width of the dialog. */
  wide?: boolean;
};

/** One field of a section form, or a sub-heading. */
export type FieldSpec<T extends FieldValues> =
  | { heading: string }
  | (Common<T> & { kind: 'text' | 'money' | 'count' | 'date'; placeholder?: string })
  | (Common<T> & { kind: 'checkbox'; text: string })
  /** A dropdown from an option list (Settings → option lists). */
  | (Common<T> & { kind: 'option'; list: string })
  /** A dropdown of records (people, installers). */
  | (Common<T> & { kind: 'choice'; choices: SelectOption[] });

/** Adds the record's current value when it is no longer offered (archived option, ex-staff). */
function withCurrent(choices: SelectOption[], current: unknown): SelectOption[] {
  if (typeof current !== 'string' || !current || choices.some((c) => c.value === current)) {
    return choices;
  }
  return [...choices, { value: current, label: `${current} (archived)` }];
}

/**
 * A section's edit form from a list of field specs. Validation is the shared zod schema (the
 * same one the API enforces), passed in as `resolver`.
 */
export function SectionForm<TInput extends FieldValues, TOutput>({
  resolver,
  defaultValues,
  fields,
  submit,
  success,
  onDone,
}: {
  resolver: Resolver<TInput, unknown, TOutput>;
  defaultValues: DefaultValues<TInput>;
  fields: FieldSpec<TInput>[];
  submit: (values: TOutput) => Promise<unknown>;
  success: string;
  onDone: () => void;
}) {
  const save = useProjectSave(success, onDone);
  const form = useForm<TInput, unknown, TOutput>({ resolver, defaultValues });
  const lists = [
    ...new Set(
      fields.flatMap((spec) => ('kind' in spec && spec.kind === 'option' ? [spec.list] : [])),
    ),
  ];
  const options = useOptions(lists);
  const onSubmit = form.handleSubmit((values) => save.run(() => submit(values)));

  const render = (spec: FieldSpec<TInput>) => {
    if ('heading' in spec) {
      return (
        <h3
          key={spec.heading}
          className="border-t border-line pt-4 text-sm font-semibold first:border-0 first:pt-0 sm:col-span-2"
        >
          {spec.heading}
        </h3>
      );
    }
    return (
      <FormField
        key={spec.name}
        control={form.control}
        name={spec.name}
        label={spec.label}
        hint={spec.hint}
        className={cn(spec.wide && 'sm:col-span-2')}
      >
        {(field, props) => {
          switch (spec.kind) {
            case 'text':
              return <Input {...props} {...textInput(field)} placeholder={spec.placeholder} />;
            case 'money':
              return <Input {...props} {...textInput(field)} inputMode="decimal" placeholder="$" />;
            case 'count':
              return (
                <Input
                  {...props}
                  name={field.name}
                  value={
                    typeof field.value === 'number' || typeof field.value === 'string'
                      ? String(field.value)
                      : ''
                  }
                  onChange={(event) => {
                    field.onChange(event.target.value);
                  }}
                  onBlur={field.onBlur}
                  inputMode="numeric"
                />
              );
            case 'date':
              return (
                <DateInput
                  {...props}
                  value={typeof field.value === 'string' ? field.value : ''}
                  onChange={field.onChange}
                />
              );
            case 'checkbox':
              return (
                <span className="flex h-9 items-center gap-2 text-sm">
                  <Checkbox
                    id={props.id}
                    aria-describedby={props['aria-describedby']}
                    checked={field.value === true}
                    onCheckedChange={(checked) => {
                      field.onChange(checked === true);
                    }}
                  />
                  {spec.text}
                </span>
              );
            case 'option':
            case 'choice': {
              const choices = spec.kind === 'option' ? options.options(spec.list) : spec.choices;
              return (
                <Select
                  {...props}
                  name={field.name}
                  value={typeof field.value === 'string' && field.value ? field.value : NONE}
                  onValueChange={(value) => {
                    field.onChange(value === NONE ? '' : value);
                  }}
                  options={[{ value: NONE, label: '—' }, ...withCurrent(choices, field.value)]}
                />
              );
            }
          }
        }}
      </FormField>
    );
  };

  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate className="contents">
      <DialogBody className="grid gap-4 sm:grid-cols-2">
        {save.error && (
          <Alert tone="danger" className="sm:col-span-2">
            {save.error}
          </Alert>
        )}
        {fields.map(render)}
      </DialogBody>
      <FormFooter onCancel={onDone} saving={form.formState.isSubmitting} />
    </form>
  );
}
