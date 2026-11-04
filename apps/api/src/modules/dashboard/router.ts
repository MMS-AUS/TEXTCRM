import { and, count, eq, gte, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  BUSINESS_TIME_ZONE,
  businessToday,
  hasPermission,
  PROJECT_STAGES,
  TICKET_PRIORITIES,
} from '@mms/shared';
import type { Db } from '../../db/client.ts';
import {
  activities,
  leads,
  optionLists,
  options,
  projectInstallation,
  projects,
  projectStcClaims,
  tickets,
  users,
} from '../../db/schema/index.ts';
import { protectedProcedure, router } from '../../trpc/trpc.ts';

// The dashboard (Step 2.9): server-side aggregates only — every number is one GROUP BY or
// COUNT over indexed columns, never rows shipped to the browser. Each section is returned
// only when the role can view that feature, so a widget can't leak what its page hides.

export const DASHBOARD_PERIODS = ['today', '7d', '30d'] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];

/** YYYY-MM-DD `days` before the business day `from`. */
function daysBefore(from: string, days: number): string {
  const date = new Date(`${from}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

const periodStart = (today: string, period: DashboardPeriod) =>
  period === 'today' ? today : daysBefore(today, period === '7d' ? 6 : 29);

const int = (value: unknown) => Number(value ?? 0);

async function leadSection(db: Db, today: string, period: DashboardPeriod) {
  const live = isNull(leads.deletedAt);
  const since = (from: string) => and(live, gte(leads.leadDate, from), lte(leads.leadDate, today));
  const [totals] = await db
    .select({
      total: count(),
      today: sql<number>`count(*) filter (where ${leads.leadDate} = ${today})::int`,
      week: sql<number>`count(*) filter (where ${leads.leadDate} >= ${daysBefore(today, 6)})::int`,
      month: sql<number>`count(*) filter (where ${leads.leadDate} >= ${daysBefore(today, 29)})::int`,
    })
    .from(leads)
    .where(live);
  const byPlatform = await db
    .select({ platform: leads.platform, count: count() })
    .from(leads)
    .where(since(periodStart(today, period)))
    .groupBy(leads.platform)
    .orderBy(sql`count(*) desc`);
  // Funnel in pipeline order (the leadStatuses option list's order).
  const funnel = await db
    .select({
      status: leads.status,
      count: count(),
      order: sql<number>`min(coalesce(${options.sortOrder}, 1000))`,
    })
    .from(leads)
    .leftJoin(optionLists, eq(optionLists.key, 'leadStatuses'))
    .leftJoin(options, and(eq(options.listId, optionLists.id), eq(options.value, leads.status)))
    .where(live)
    .groupBy(leads.status)
    .orderBy(sql`3`, leads.status);
  // Conversions by salesperson over the last 90 days: leads they got vs leads converted.
  const from90 = daysBefore(today, 89);
  const conversions = await db
    .select({
      userId: leads.ownerUserId,
      name: users.name,
      leads: sql<number>`count(*) filter (where ${leads.leadDate} >= ${from90})::int`,
      converted: sql<number>`count(*) filter (where ${leads.convertedAt} >= (${from90}::date at time zone ${BUSINESS_TIME_ZONE}))::int`,
    })
    .from(leads)
    .leftJoin(users, eq(users.id, leads.ownerUserId))
    .where(
      and(
        live,
        sql`(${leads.leadDate} >= ${from90} or ${leads.convertedAt} >= (${from90}::date at time zone ${BUSINESS_TIME_ZONE}))`,
      ),
    )
    .groupBy(leads.ownerUserId, users.name)
    .orderBy(sql`4 desc`, sql`3 desc`);
  return {
    total: int(totals?.total),
    newToday: int(totals?.today),
    newWeek: int(totals?.week),
    newMonth: int(totals?.month),
    period,
    byPlatform: byPlatform.map((row) => ({
      label: row.platform ?? 'No platform',
      count: row.count,
    })),
    funnel: funnel.map((row) => ({ label: row.status, count: row.count })),
    conversions: conversions.map((row) => ({
      label: row.userId ? (row.name ?? 'Former staff') : 'Unassigned',
      leads: row.leads,
      converted: row.converted,
    })),
  };
}

async function projectSection(db: Db, today: string) {
  const live = isNull(projects.deletedAt);
  const byStageRows = await db
    .select({ stage: projects.stage, count: count() })
    .from(projects)
    .where(and(live, eq(projects.status, 'Active')))
    .groupBy(projects.stage);
  const byStage = PROJECT_STAGES.map((stage) => ({
    label: stage,
    count: byStageRows.find((row) => row.stage === stage)?.count ?? 0,
  }));
  const monthStart = `${today.slice(0, 7)}-01`;
  const nextMonth = new Date(`${monthStart}T00:00:00Z`);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const monthEnd = daysBefore(nextMonth.toISOString().slice(0, 10), 1);
  const [installs] = await db
    .select({
      completed: sql<number>`count(*) filter (where ${projectInstallation.completedDate} between ${monthStart} and ${monthEnd})::int`,
      scheduled: sql<number>`count(*) filter (where ${projectInstallation.completedDate} is null and ${projectInstallation.bookingDate} between ${monthStart} and ${monthEnd})::int`,
    })
    .from(projectInstallation)
    .innerJoin(projects, eq(projects.id, projectInstallation.projectId))
    .where(and(live, sql`${projects.status} <> 'Lost'`));
  // Revenue: contract value (else selling price) of jobs sold, by sale month, last 6 months.
  const sixMonthsAgo = new Date(`${monthStart}T00:00:00Z`);
  sixMonthsAgo.setUTCMonth(sixMonthsAgo.getUTCMonth() - 5);
  const from = sixMonthsAgo.toISOString().slice(0, 10);
  const revenueRows = await db.execute<{ month: string; jobs: number; revenue: string }>(sql`
    select to_char(m.month, 'YYYY-MM') as month,
           count(p.id)::int as jobs,
           coalesce(sum(coalesce(pp.contract_value_aud, pp.selling_price_aud)), 0)::numeric(14,2)::text as revenue
    from generate_series(${from}::date, ${monthStart}::date, interval '1 month') as m(month)
    left join projects p
      on p.deleted_at is null and p.status <> 'Lost'
     and p.sale_date >= m.month and p.sale_date < m.month + interval '1 month'
    left join project_pricing pp on pp.project_id = p.id
    group by m.month
    order by m.month`);
  // STC money across live jobs (same rules as the project's STC card: an amount with a
  // received date has been received; one without is still to come).
  const [stc] = await db
    .select({
      received: sql<string>`coalesce(sum(case when ${projectStcClaims.solarStcsReceivedDate} is not null then ${projectStcClaims.solarStcsAmountAud} else 0 end) + sum(case when ${projectStcClaims.batteryStcsReceivedDate} is not null then ${projectStcClaims.batteryStcsAmountAud} else 0 end), 0)::numeric(14,2)::text`,
      outstanding: sql<string>`coalesce(sum(case when ${projectStcClaims.solarStcsReceivedDate} is null then coalesce(${projectStcClaims.solarStcsAmountAud}, 0) else 0 end) + sum(case when ${projectStcClaims.batteryStcsReceivedDate} is null then coalesce(${projectStcClaims.batteryStcsAmountAud}, 0) else 0 end), 0)::numeric(14,2)::text`,
      certificates: sql<number>`coalesce(sum(coalesce(${projectStcClaims.solarStcs}, 0) + coalesce(${projectStcClaims.batteryStcs}, 0)), 0)::int`,
      jobs: sql<number>`count(*) filter (where ${projectStcClaims.solarStcsAmountAud} is not null or ${projectStcClaims.batteryStcsAmountAud} is not null)::int`,
    })
    .from(projectStcClaims)
    .innerJoin(projects, eq(projects.id, projectStcClaims.projectId))
    .where(and(live, sql`${projects.status} <> 'Lost'`));
  const [active] = await db
    .select({ count: count() })
    .from(projects)
    .where(and(live, eq(projects.status, 'Active')));
  return {
    active: int(active?.count),
    byStage,
    installsCompleted: int(installs?.completed),
    installsScheduled: int(installs?.scheduled),
    revenue: revenueRows.rows.map((row) => ({
      month: row.month,
      jobs: int(row.jobs),
      revenueAud: row.revenue,
    })),
    stc: {
      receivedAud: stc?.received ?? '0.00',
      outstandingAud: stc?.outstanding ?? '0.00',
      certificates: int(stc?.certificates),
      jobs: int(stc?.jobs),
    },
  };
}

async function ticketSection(db: Db) {
  const open = isNull(tickets.closedAt);
  const [totals] = await db
    .select({
      open: count(),
      week: sql<number>`count(*) filter (where ${tickets.createdAt} >= now() - interval '7 days')::int`,
      month: sql<number>`count(*) filter (where ${tickets.createdAt} < now() - interval '7 days' and ${tickets.createdAt} >= now() - interval '30 days')::int`,
      older: sql<number>`count(*) filter (where ${tickets.createdAt} < now() - interval '30 days')::int`,
    })
    .from(tickets)
    .where(open);
  const priorityRows = await db
    .select({ priority: tickets.priority, count: count() })
    .from(tickets)
    .where(open)
    .groupBy(tickets.priority);
  return {
    open: int(totals?.open),
    byPriority: [...TICKET_PRIORITIES].reverse().map((priority) => ({
      label: priority,
      count: priorityRows.find((row) => row.priority === priority)?.count ?? 0,
    })),
    byAge: [
      { label: 'Under 7 days', key: 'week' as const, count: int(totals?.week) },
      { label: '7–30 days', key: 'month' as const, count: int(totals?.month) },
      { label: 'Over 30 days', key: 'older' as const, count: int(totals?.older) },
    ],
  };
}

async function taskSection(db: Db, userId: string) {
  const [row] = await db
    .select({
      overdue: sql<number>`count(*) filter (where ${activities.dueAt} < date_trunc('day', now() at time zone ${BUSINESS_TIME_ZONE}) at time zone ${BUSINESS_TIME_ZONE})::int`,
      today: sql<number>`count(*) filter (where ${activities.dueAt} >= date_trunc('day', now() at time zone ${BUSINESS_TIME_ZONE}) at time zone ${BUSINESS_TIME_ZONE} and ${activities.dueAt} < (date_trunc('day', now() at time zone ${BUSINESS_TIME_ZONE}) + interval '1 day') at time zone ${BUSINESS_TIME_ZONE})::int`,
      open: count(),
    })
    .from(activities)
    .where(
      and(
        eq(activities.assignedUserId, userId),
        eq(activities.type, 'task'),
        isNull(activities.completedAt),
        isNull(activities.deletedAt),
        isNotNull(activities.dueAt),
      ),
    );
  return { overdue: int(row?.overdue), dueToday: int(row?.today), open: int(row?.open) };
}

export const dashboardRouter = router({
  overview: protectedProcedure
    .input(z.object({ period: z.enum(DASHBOARD_PERIODS).default('7d') }))
    .query(async ({ ctx, input }) => {
      const today = businessToday();
      const can = (feature: 'leads' | 'projects' | 'tickets') =>
        hasPermission(ctx.user.permissions, feature, 'view');
      const [leadStats, projectStats, ticketStats, tasks] = await Promise.all([
        can('leads') ? leadSection(ctx.db, today, input.period) : null,
        can('projects') ? projectSection(ctx.db, today) : null,
        can('tickets') ? ticketSection(ctx.db) : null,
        taskSection(ctx.db, ctx.user.id),
      ]);
      return { today, leads: leadStats, projects: projectStats, tickets: ticketStats, tasks };
    }),
});
