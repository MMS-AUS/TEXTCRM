import { PROJECT_STAGES, type ProjectStage } from '@mms/shared';
import type { BadgeTone } from '../../ui/index.ts';

const STATUS_TONES: Record<string, BadgeTone> = {
  Active: 'accent',
  Completed: 'success',
  Closed: 'neutral',
  Lost: 'neutral',
};

export function projectStatusTone(status: string): BadgeTone {
  return STATUS_TONES[status] ?? 'neutral';
}

const DONE = /approved|paid|complete|delivered|verified|settled|reconciled|traded|installed/i;
const PROBLEM = /reject|declin|disput|flag|rectif|cancel|hold/i;

/** Badge colour for a section's status (grid, finance, stock, installation, STC). */
export function sectionStatusTone(status: string | null | undefined): BadgeTone {
  if (!status) return 'neutral';
  if (PROBLEM.test(status)) return 'danger';
  if (DONE.test(status)) return 'success';
  return 'info';
}

/** Position in the pipeline, 1-based ("Stage 4 of 9"); 0 if the stage isn't recognised. */
export function stageNumber(stage: string): number {
  return PROJECT_STAGES.findIndex((s) => s === stage) + 1;
}

export function isProjectStage(value: string): value is ProjectStage {
  return PROJECT_STAGES.some((stage) => stage === value);
}

/** "6.12 kW + battery" for cards and rows. */
export function systemSummary(systemSizeKw: string | null, batteryCount: number | null): string {
  const parts = [systemSizeKw ? `${String(Number(systemSizeKw))} kW` : null];
  if (batteryCount) parts.push(systemSizeKw ? '+ battery' : 'Battery');
  return parts.filter(Boolean).join(' ');
}
