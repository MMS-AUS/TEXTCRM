import { INVERTER_TYPE_LABELS, INVERTER_TYPES, MAX_INVERTERS } from '@mms/shared';
import { Plus, Trash2 } from 'lucide-react';
import type { Control } from 'react-hook-form';
import { FormField, IconButton, Input, Select } from '../ui/index.ts';
import { HardwarePicker } from './HardwarePicker.tsx';
import type { InverterFields, SavedInverterLine, useInverterLines } from './inverter-lines.ts';

/**
 * Any number of inverter lines for a system: a catalog model, how many, and Grid or Hybrid.
 * The + button adds a line. Used by the lead and the project system forms.
 */
export function InverterLinesEditor({
  control,
  lines,
  saved,
}: {
  control: Control<InverterFields>;
  lines: ReturnType<typeof useInverterLines>;
  saved: readonly SavedInverterLine[];
}) {
  const { rows } = lines;
  return (
    <>
      <div className="flex items-center justify-between sm:col-span-4">
        <span className="text-sm font-medium">
          {rows.fields.length > 1 ? 'Inverters' : 'Inverter'}
        </span>
        <IconButton
          label="Add another inverter"
          size="sm"
          variant="secondary"
          disabled={rows.fields.length >= MAX_INVERTERS}
          onClick={() => {
            rows.append({ inverterId: '', count: '1', type: 'grid' });
          }}
        >
          <Plus />
        </IconButton>
      </div>
      {rows.fields.length === 0 && (
        <p className="text-sm text-fg-muted sm:col-span-4">No inverter yet. Use + to add one.</p>
      )}
      {rows.fields.map((row, index) => (
        <div key={row.id} className="grid gap-4 sm:col-span-4 sm:grid-cols-[1fr_5rem_9.5rem_auto]">
          <FormField
            control={control}
            name={`inverters.${String(index)}.inverterId` as 'inverters.0.inverterId'}
            label={`Inverter ${String(index + 1)} model`}
          >
            {(field, props) => (
              <HardwarePicker
                kind="inverter"
                props={props}
                value={field.value || null}
                initial={saved.find((line) => line.inverterId === field.value)?.inverter ?? null}
                onChange={(option) => {
                  field.onChange(option?.id ?? '');
                  if (option) lines.rememberKw(option.id, option.spec);
                }}
              />
            )}
          </FormField>
          <FormField
            control={control}
            name={`inverters.${String(index)}.count` as 'inverters.0.count'}
            label="How many"
          >
            {(field, props) => (
              <Input
                {...props}
                name={field.name}
                value={String(field.value)}
                onChange={(event) => {
                  field.onChange(event.target.value);
                }}
                onBlur={field.onBlur}
                inputMode="numeric"
              />
            )}
          </FormField>
          <FormField
            control={control}
            name={`inverters.${String(index)}.type` as 'inverters.0.type'}
            label="Type"
          >
            {(field, props) => (
              <Select
                {...props}
                name={field.name}
                value={field.value}
                onValueChange={field.onChange}
                options={INVERTER_TYPES.map((type) => ({
                  value: type,
                  label: INVERTER_TYPE_LABELS[type],
                }))}
              />
            )}
          </FormField>
          <IconButton
            label={`Remove inverter ${String(index + 1)}`}
            className="mt-6"
            onClick={() => {
              rows.remove(index);
            }}
          >
            <Trash2 />
          </IconButton>
        </div>
      ))}
    </>
  );
}
