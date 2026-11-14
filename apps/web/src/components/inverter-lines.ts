import { inverterCapacityKw } from '@mms/shared';
import { useState } from 'react';
import { useFieldArray, useWatch, type Control } from 'react-hook-form';
import type { HardwareOption } from './HardwarePicker.tsx';

/** The part of a system form (lead or project) that holds the inverter lines. */
export type InverterFields = {
  inverters: { inverterId: string; count: string | number; type: 'grid' | 'hybrid' }[];
};

/** An inverter line as the server returns it, with the model's catalog label. */
export type SavedInverterLine = {
  inverterId: string;
  count: number;
  type: 'grid' | 'hybrid';
  inverter: HardwareOption | null;
};

/** Default form values for the saved lines. */
export const inverterDefaults = (saved: readonly SavedInverterLine[] | undefined) =>
  (saved ?? []).map((line) => ({
    inverterId: line.inverterId,
    count: line.count,
    type: line.type,
  }));

/**
 * State for an inverter editor: the lines (add / remove), each model's kW as the user picks them,
 * and the system size worked out from them (null with no lines). Pass the form's `control`.
 */
export function useInverterLines(
  control: Control<InverterFields>,
  saved: readonly SavedInverterLine[],
) {
  const rows = useFieldArray({ control, name: 'inverters' });
  const values = useWatch({ control, name: 'inverters' });
  const [kwById, setKwById] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      saved.flatMap((line) =>
        line.inverter ? [[line.inverterId, Number.parseFloat(line.inverter.spec)]] : [],
      ),
    ),
  );
  const calculatedKw =
    values.length > 0
      ? inverterCapacityKw(
          values.map((line) => ({
            sizeKw: kwById[line.inverterId] ?? 0,
            count: Number(line.count) || 0,
          })),
        )
      : null;
  return {
    rows,
    calculatedKw,
    rememberKw: (inverterId: string, spec: string) => {
      setKwById((known) => ({ ...known, [inverterId]: Number.parseFloat(spec) }));
    },
  };
}
