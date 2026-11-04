import { Badge } from '../../../ui/index.ts';

const TONES = { running: 'info', completed: 'success', failed: 'danger' } as const;
const LABELS = { running: 'Running', completed: 'Done', failed: 'Failed' } as const;

export function RunStatus({ status }: { status: keyof typeof TONES }) {
  return (
    <Badge tone={TONES[status]} dot>
      {LABELS[status]}
    </Badge>
  );
}
