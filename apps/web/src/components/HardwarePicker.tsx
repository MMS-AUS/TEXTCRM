import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useDebouncedValue } from '../lib/hooks.ts';
import { useTRPC } from '../lib/trpc.ts';
import { Combobox, type FieldControlProps } from '../ui/index.ts';

export type HardwareKind = 'panel' | 'inverter' | 'battery';
export type HardwareOption = { id: string; label: string; spec: string };

/** Searchable picker over one hardware catalog. */
export function HardwarePicker({
  kind,
  value,
  initial,
  onChange,
  props,
}: {
  kind: HardwareKind;
  value: string | null;
  initial: HardwareOption | null;
  onChange: (option: HardwareOption | null) => void;
  props: FieldControlProps;
}) {
  const trpc = useTRPC();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(initial);
  const debounced = useDebouncedValue(search, 200);
  const results = useQuery(trpc.hardware.search.queryOptions({ kind, search: debounced }));
  const options = results.data ?? [];
  return (
    <Combobox
      {...props}
      value={value}
      selectedLabel={selected ? `${selected.label} · ${selected.spec}` : null}
      options={options.map((option) => ({
        value: option.id,
        label: option.label,
        description: option.spec,
      }))}
      loading={results.isFetching}
      onSearchChange={setSearch}
      onSelect={(id) => {
        const option = options.find((o) => o.id === id) ?? null;
        setSelected(option);
        onChange(option);
      }}
      placeholder={`Choose ${kind === 'inverter' ? 'an' : 'a'} ${kind}`}
      searchPlaceholder="Search manufacturer or model"
      emptyText="Nothing in the catalog matches."
      clearLabel={`No ${kind}`}
    />
  );
}
