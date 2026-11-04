import { formatAud } from '@mms/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useProfile } from '../auth/auth-context.ts';
import { MyTasks } from '../components/MyTasks.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { errorMessage } from '../lib/errors.ts';
import { useTRPC, type RouterOutputs } from '../lib/trpc.ts';
import { useState } from 'react';
import {
  Alert,
  BarList,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ColumnChart,
  formatCount,
  Meter,
  Select,
  Skeleton,
  StatTile,
} from '../ui/index.ts';

type Overview = RouterOutputs['dashboard']['overview'];
type Period = 'today' | '7d' | '30d';

const PERIOD_LABELS: Record<Period, string> = {
  today: 'Today',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
};

const MONTH = new Intl.DateTimeFormat('en-AU', { month: 'short', timeZone: 'UTC' });
const MONTH_YEAR = new Intl.DateTimeFormat('en-AU', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const shortAud = (value: number) =>
  value >= 10_000 ? `$${formatCount(value)}` : formatAud(value.toFixed(2)).replace(/\.00$/, '');

function Widget({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Tiles({ data }: { data: Overview }) {
  const tiles: { key: string; to: string; node: ReactNode }[] = [];
  if (data.leads) {
    tiles.push({
      key: 'new',
      to: '/leads',
      node: (
        <StatTile
          label="New leads · 7 days"
          value={formatCount(data.leads.newWeek)}
          detail={`${formatCount(data.leads.newToday)} today · ${formatCount(data.leads.newMonth)} in 30 days`}
        />
      ),
    });
    tiles.push({
      key: 'total',
      to: '/leads',
      node: (
        <StatTile
          label="Total leads"
          value={formatCount(data.leads.total)}
          detail="Live leads in the CRM"
        />
      ),
    });
  }
  if (data.projects) {
    tiles.push({
      key: 'projects',
      to: '/projects',
      node: (
        <StatTile
          label="Active projects"
          value={formatCount(data.projects.active)}
          detail={`${formatCount(data.projects.installsCompleted)} installed this month · ${formatCount(data.projects.installsScheduled)} scheduled`}
        />
      ),
    });
  }
  if (data.tickets) {
    const older = data.tickets.byAge.find((age) => age.key === 'older')?.count ?? 0;
    tiles.push({
      key: 'tickets',
      to: '/tickets',
      node: (
        <StatTile
          label="Open tickets"
          value={formatCount(data.tickets.open)}
          detail={older ? `${formatCount(older)} open over 30 days` : 'None open over 30 days'}
        />
      ),
    });
  }
  tiles.push({
    key: 'tasks',
    to: '#my-tasks',
    node: (
      <StatTile
        label="My tasks"
        value={formatCount(data.tasks.overdue + data.tasks.dueToday)}
        detail={`${formatCount(data.tasks.overdue)} overdue · ${formatCount(data.tasks.dueToday)} due today`}
      />
    ),
  });
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {tiles.map((tile) =>
        tile.to.startsWith('#') ? (
          <a
            key={tile.key}
            href={tile.to}
            className="rounded-lg border border-line bg-surface p-4 shadow-xs transition-shadow hover:shadow-sm"
          >
            {tile.node}
          </a>
        ) : (
          <Link
            key={tile.key}
            to={tile.to}
            className="rounded-lg border border-line bg-surface p-4 shadow-xs transition-shadow hover:shadow-sm"
          >
            {tile.node}
          </Link>
        ),
      )}
    </div>
  );
}

function ProjectWidgets({ projects }: { projects: NonNullable<Overview['projects']> }) {
  const revenue = projects.revenue.map((month) => {
    const date = new Date(`${month.month}-01T00:00:00Z`);
    return {
      key: month.month,
      label: MONTH.format(date),
      name: MONTH_YEAR.format(date),
      value: Number(month.revenueAud),
      detail: `${String(month.jobs)} job${month.jobs === 1 ? '' : 's'} sold`,
    };
  });
  const total = revenue.reduce((sum, month) => sum + month.value, 0);
  const received = Number(projects.stc.receivedAud);
  const outstanding = Number(projects.stc.outstandingAud);
  return (
    <>
      <Widget
        title="Sales by month"
        description={`Contract value (or selling price) of jobs sold · ${formatAud(total.toFixed(2))} in 6 months`}
        className="lg:col-span-2"
      >
        <ColumnChart
          data={revenue}
          label="Sales by month, last 6 months"
          formatValue={shortAud}
          formatTick={(value) => (value === 0 ? '0' : `$${formatCount(value)}`)}
          tableHeaders={['Month', 'Sales']}
        />
      </Widget>
      <Widget
        title="STC payments"
        description={`${formatCount(projects.stc.certificates)} certificates across ${formatCount(projects.stc.jobs)} jobs`}
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <StatTile label="Received" value={formatAud(projects.stc.receivedAud)} />
            <StatTile label="Still to come" value={formatAud(projects.stc.outstandingAud)} />
          </div>
          <Meter value={received} max={received + outstanding} label="STC money received so far" />
          <p className="text-xs text-fg-muted">
            {received + outstanding > 0
              ? `${String(Math.round((received / (received + outstanding)) * 100))}% of expected STC money received.`
              : 'No STC amounts entered on projects yet.'}
          </p>
        </div>
      </Widget>
      <Widget title="Active projects by stage" className="lg:col-span-2">
        <BarList
          data={projects.byStage.map((stage) => ({ label: stage.label, value: stage.count }))}
          label="Active projects by stage"
          unit="jobs"
          empty="No active projects."
        />
      </Widget>
    </>
  );
}

/** The home page (Step 2.9): what needs attention, from server aggregates, by role. */
export function DashboardPage() {
  const profile = useProfile();
  const trpc = useTRPC();
  const [period, setPeriod] = useState<Period>('7d');
  const query = useQuery({
    ...trpc.dashboard.overview.queryOptions({ period }),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const data = query.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Welcome, ${profile.name}`}
        description="Today at a glance."
        actions={
          data?.leads && (
            <Select
              aria-label="Lead period"
              className="w-40"
              value={period}
              onValueChange={(value) => {
                if (value === 'today' || value === '7d' || value === '30d') setPeriod(value);
              }}
              options={(Object.keys(PERIOD_LABELS) as Period[]).map((p) => ({
                value: p,
                label: PERIOD_LABELS[p],
              }))}
            />
          )
        }
      />
      {query.isError && <Alert tone="danger">{errorMessage(query.error)}</Alert>}
      {!data ? (
        query.isPending && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
        )
      ) : (
        <>
          <Tiles data={data} />
          <div className="grid items-start gap-6 lg:grid-cols-3">
            {data.leads && (
              <>
                <Widget
                  title="New leads by platform"
                  description={PERIOD_LABELS[data.leads.period]}
                >
                  <BarList
                    data={data.leads.byPlatform.map((p) => ({ label: p.label, value: p.count }))}
                    label={`New leads by platform, ${PERIOD_LABELS[data.leads.period].toLowerCase()}`}
                    unit="leads"
                    empty="No new leads in this period."
                  />
                </Widget>
                <Widget title="Lead pipeline" description="Live leads by status">
                  <BarList
                    data={data.leads.funnel.map((f) => ({ label: f.label, value: f.count }))}
                    label="Lead pipeline by status"
                    unit="leads"
                    empty="No leads yet."
                  />
                </Widget>
                <Widget
                  title="Conversions by salesperson"
                  description="Last 90 days: leads received → converted"
                >
                  <BarList
                    data={data.leads.conversions.map((c) => ({
                      label: c.label,
                      value: c.converted,
                      detail: `${String(c.leads)} leads${c.leads ? `, ${String(Math.round((c.converted / c.leads) * 100))}% converted` : ''}`,
                    }))}
                    label="Conversions by salesperson, last 90 days"
                    unit="converted"
                    empty="No conversions in the last 90 days."
                  />
                </Widget>
              </>
            )}
            {data.projects && <ProjectWidgets projects={data.projects} />}
            {data.tickets && (
              <Widget title="Open tickets" description="By priority and how long they've been open">
                <div className="flex flex-col gap-5">
                  <BarList
                    data={data.tickets.byPriority.map((p) => ({ label: p.label, value: p.count }))}
                    label="Open tickets by priority"
                    unit="tickets"
                    empty="No open tickets."
                  />
                  {data.tickets.open > 0 && (
                    <BarList
                      data={data.tickets.byAge.map((a) => ({ label: a.label, value: a.count }))}
                      label="Open tickets by age"
                      unit="tickets"
                    />
                  )}
                </div>
              </Widget>
            )}
          </div>
        </>
      )}
      <div id="my-tasks" className="max-w-2xl scroll-mt-20">
        <MyTasks />
      </div>
    </div>
  );
}
