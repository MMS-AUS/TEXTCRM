import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeAuth, fullAccessProfile, renderPage, type TrpcCall } from '../../test/render.tsx';
import { SystemDesignCard } from './ProjectSections.tsx';

type Props = Parameters<typeof SystemDesignCard>[0];

const signedIn = () => fakeAuth({ status: 'signedIn', profile: fullAccessProfile() });
const SUNGROW = '33333333-3333-4333-8333-333333333333';
const FRONIUS = '44444444-4444-4444-8444-444444444444';

const project = {
  id: '22222222-2222-4222-8222-222222222222',
  system: {
    systemSizeKw: '13.00',
    panelId: null,
    panelCount: null,
    batteryId: null,
    batteryCount: null,
    panel: null,
    battery: null,
    inverters: [
      {
        inverterId: SUNGROW,
        count: 2,
        type: 'hybrid',
        inverter: { id: SUNGROW, label: 'Sungrow SH5.0RT', spec: '5 kW' },
      },
      {
        inverterId: FRONIUS,
        count: 1,
        type: 'grid',
        inverter: { id: FRONIUS, label: 'Fronius Primo 3', spec: '3 kW' },
      },
    ],
  },
} as unknown as Props['project'];

const render = (calls: TrpcCall[] = []) =>
  renderPage(<SystemDesignCard project={project} editable />, {
    path: '/projects',
    auth: signedIn(),
    calls,
    responses: { 'hardware.search': [] },
  });

describe('Project system design with several inverters', () => {
  afterEach(cleanup);

  it('lists every inverter with its count and type', async () => {
    render();
    expect(await screen.findByText('Inverter 1')).toBeTruthy();
    expect(screen.getByText(/2 × Sungrow SH5.0RT \(5 kW\) · Hybrid Inverter/)).toBeTruthy();
    expect(screen.getByText('Inverter 2')).toBeTruthy();
    expect(screen.getByText(/1 × Fronius Primo 3 \(3 kW\) · Grid Inverter/)).toBeTruthy();
  });

  it('edits the lines: + adds one, the trash button removes one, and the size is calculated', async () => {
    render();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(await screen.findByText('Inverter 1 model')).toBeTruthy();
    expect(screen.getByText('Inverter 2 model')).toBeTruthy();
    // 2 × 5 kW + 1 × 3 kW
    const size = screen.getByLabelText<HTMLInputElement>('System size (kW)');
    expect(size.value).toBe('13.00');
    expect(size.readOnly).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Add another inverter' }));
    expect(await screen.findByText('Inverter 3 model')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Remove inverter 3' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove inverter 1' }));
    await waitFor(() => {
      expect(screen.queryByText('Inverter 2 model')).toBeNull();
    });
    expect(screen.getByLabelText<HTMLInputElement>('System size (kW)').value).toBe('3.00');
  });
});
