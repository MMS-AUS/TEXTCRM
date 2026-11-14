import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeAuth, fakeProfile, fullAccessProfile, renderPage } from '../test/render.tsx';
import { DashboardPage } from './DashboardPage.tsx';

const overview = {
  today: '2026-11-04',
  leads: {
    total: 120,
    newToday: 3,
    newWeek: 18,
    newMonth: 61,
    period: '7d',
    bySource: [
      { label: 'Meta', count: 12 },
      { label: 'Website', count: 6 },
    ],
    funnel: [
      { label: 'New', count: 40 },
      { label: 'Contacted', count: 30 },
    ],
    conversions: [{ label: 'Simon', leads: 20, converted: 5 }],
  },
  projects: {
    active: 9,
    byStage: [{ label: 'Install Scheduled', count: 4 }],
    installsCompleted: 2,
    installsScheduled: 3,
    revenue: [
      { month: '2026-10', jobs: 2, revenueAud: '18000.00' },
      { month: '2026-11', jobs: 1, revenueAud: '12000.00' },
    ],
    stc: { receivedAud: '1822.50', outstandingAud: '1200.00', certificates: 75, jobs: 2 },
  },
  tickets: {
    open: 4,
    byPriority: [{ label: 'Urgent', count: 1 }],
    byAge: [{ label: 'Over 30 days', key: 'older', count: 2 }],
  },
  tasks: { overdue: 1, dueToday: 2, open: 5 },
};

describe('DashboardPage', () => {
  afterEach(cleanup);

  it('shows the headline numbers and the charts for a full-access role', async () => {
    renderPage(<DashboardPage />, {
      path: '/dashboard',
      auth: fakeAuth({ status: 'signedIn', profile: fullAccessProfile() }),
      responses: { 'dashboard.overview': overview, 'activities.myTasks': [] },
    });
    expect(await screen.findByText('New leads · 7 days')).toBeDefined();
    expect(screen.getByText('18')).toBeDefined();
    expect(screen.getByText('3 today · 61 in 30 days')).toBeDefined();
    expect(screen.getByText('2 open over 30 days')).toBeDefined();
    expect(screen.getByText('1 overdue · 2 due today')).toBeDefined();
    expect(screen.getByRole('list', { name: /New leads by source/ })).toBeDefined();
    expect(screen.getByLabelText('Meta: 12 leads (67%)')).toBeDefined();
    expect(screen.getByRole('img', { name: 'Sales by month, last 6 months' })).toBeDefined();
    expect(
      screen
        .getByRole('meter', { name: 'STC money received so far' })
        .getAttribute('aria-valuenow'),
    ).toBe('60');
  });

  it('hides sections the role cannot see', async () => {
    renderPage(<DashboardPage />, {
      path: '/dashboard',
      auth: fakeAuth({ status: 'signedIn', profile: fakeProfile }),
      responses: {
        'dashboard.overview': { ...overview, projects: null, tickets: null },
        'activities.myTasks': [],
      },
    });
    expect(await screen.findByText('New leads · 7 days')).toBeDefined();
    expect(screen.queryByText('Active projects')).toBeNull();
    expect(screen.queryByText('Open tickets')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Welcome, Sam' })).toBeDefined();
  });
});
