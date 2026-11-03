import { PROJECT_FINAL_STAGE, PROJECT_STAGES, type ProjectStage } from '@mms/shared';
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { GripVertical, MoreHorizontal } from 'lucide-react';
import { useState, type DragEvent } from 'react';
import { errorMessage } from '../../lib/errors.ts';
import { formatDate } from '../../lib/format.ts';
import { useCan } from '../../lib/hooks.ts';
import { useTRPC, type RouterOutputs } from '../../lib/trpc.ts';
import {
  Avatar,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  IconButton,
  toast,
  Tooltip,
} from '../../ui/index.ts';
import { isProjectStage, systemSummary } from './project-stage.ts';

type Board = RouterOutputs['projects']['board'];
type Card = Board['rows'][number];

const DRAG_TYPE = 'application/x-mms-project';

function ProjectCard({
  card,
  canMove,
  onMove,
  onDragStart,
}: {
  card: Card;
  canMove: boolean;
  onMove: (stage: ProjectStage) => void;
  onDragStart: (event: DragEvent) => void;
}) {
  const system = systemSummary(card.systemSizeKw, card.batteryCount);
  return (
    <li
      draggable={canMove}
      onDragStart={onDragStart}
      className={cn(
        'group rounded-lg border border-line bg-surface p-3 text-sm shadow-xs transition-shadow hover:shadow-sm',
        canMove && 'cursor-grab active:cursor-grabbing',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-xs text-fg-subtle">{card.projectNumber}</p>
          <Link
            to="/projects/$projectId"
            params={{ projectId: card.id }}
            className="block truncate font-medium hover:text-accent-text hover:underline"
          >
            {card.customerName}
          </Link>
        </div>
        {canMove ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label={`Move ${card.projectNumber}`} size="sm" className="-mt-1 -mr-1">
                <MoreHorizontal />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-80">
              <DropdownMenuLabel>Move to</DropdownMenuLabel>
              {PROJECT_STAGES.filter((stage) => stage !== card.stage).map((stage) => (
                <DropdownMenuItem
                  key={stage}
                  onSelect={() => {
                    onMove(stage);
                  }}
                >
                  {stage}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      <p className="mt-1 truncate text-fg-muted">
        {[card.suburb, card.state].filter(Boolean).join(', ')}
        {system && ` · ${system}`}
      </p>
      <div className="mt-2.5 flex items-center justify-between gap-2 text-xs text-fg-muted">
        {card.salesName ? (
          <Tooltip content={card.salesName}>
            <span tabIndex={0}>
              <Avatar name={card.salesName} size="sm" />
            </span>
          </Tooltip>
        ) : (
          <span className="text-fg-subtle">Unassigned</span>
        )}
        {card.saleDate && <span>Sold {formatDate(card.saleDate)}</span>}
        {canMove && (
          <GripVertical
            aria-hidden
            className="size-3.5 text-fg-subtle opacity-0 group-hover:opacity-100"
          />
        )}
      </div>
    </li>
  );
}

/**
 * Kanban by project stage. Drag a card to another column (or use its menu) to move the job;
 * the board updates immediately and rolls back if the server refuses.
 */
export function ProjectBoard({ board, queryKey }: { board: Board; queryKey: QueryKey }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const can = useCan();
  const canMove = can('projects', 'edit');
  const setStage = useMutation(trpc.projects.setStage.mutationOptions());
  const [over, setOver] = useState<string | null>(null);

  const move = async (card: Card, stage: ProjectStage) => {
    if (card.stage === stage) return;
    await queryClient.cancelQueries({ queryKey });
    const previous = queryClient.getQueryData<Board>(queryKey);
    queryClient.setQueryData<Board>(
      queryKey,
      (old) =>
        old && {
          ...old,
          rows: old.rows.map((row) => (row.id === card.id ? { ...row, stage } : row)),
        },
    );
    try {
      await setStage.mutateAsync({ id: card.id, stage });
      toast({
        title:
          stage === PROJECT_FINAL_STAGE
            ? `${card.projectNumber} completed`
            : `${card.projectNumber} moved to ${stage}`,
        tone: 'success',
      });
    } catch (error) {
      queryClient.setQueryData(queryKey, previous);
      toast({ title: "Couldn't move the job", description: errorMessage(error), tone: 'danger' });
    } finally {
      await queryClient.invalidateQueries(trpc.projects.pathFilter());
    }
  };

  const columns = PROJECT_STAGES.map((stage) => ({
    stage,
    cards: board.rows.filter((row) => row.stage === stage),
  }));

  return (
    <div className="flex flex-col gap-2">
      {board.truncated && (
        <p className="text-sm text-warning-text">
          Showing the first 1,000 jobs. Narrow the filters to see the rest.
        </p>
      )}
      <div className="-mx-4 overflow-x-auto px-4 pb-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <ol aria-label="Project stages" className="flex min-w-max gap-3">
          {columns.map(({ stage, cards }) => (
            <li
              key={stage}
              aria-label={`${stage}: ${String(cards.length)} jobs`}
              onDragOver={(event) => {
                if (!canMove || !event.dataTransfer.types.includes(DRAG_TYPE)) return;
                event.preventDefault();
                setOver(stage);
              }}
              onDragLeave={() => {
                setOver((current) => (current === stage ? null : current));
              }}
              onDrop={(event) => {
                event.preventDefault();
                setOver(null);
                const id = event.dataTransfer.getData(DRAG_TYPE);
                const card = board.rows.find((row) => row.id === id);
                if (card && isProjectStage(stage)) void move(card, stage);
              }}
              className={cn(
                'flex max-h-[calc(100dvh-17rem)] w-72 shrink-0 flex-col rounded-xl border border-line bg-surface-2/60 transition-colors',
                over === stage && 'border-accent bg-accent-subtle',
              )}
            >
              <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
                <h2 className="truncate text-sm font-semibold" title={stage}>
                  {stage}
                </h2>
                <span className="rounded-full bg-surface px-2 text-xs font-medium tabular-nums text-fg-muted inset-ring inset-ring-line">
                  {cards.length}
                </span>
              </div>
              <ul className="flex min-h-24 flex-col gap-2 overflow-y-auto px-2 pb-2">
                {cards.map((card) => (
                  <ProjectCard
                    key={card.id}
                    card={card}
                    canMove={canMove}
                    onMove={(next) => void move(card, next)}
                    onDragStart={(event) => {
                      event.dataTransfer.setData(DRAG_TYPE, card.id);
                      event.dataTransfer.effectAllowed = 'move';
                    }}
                  />
                ))}
                {cards.length === 0 && (
                  <li className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-xs text-fg-subtle">
                    {stage === PROJECT_FINAL_STAGE ? 'Drop a job here to complete it' : 'No jobs'}
                  </li>
                )}
              </ul>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
