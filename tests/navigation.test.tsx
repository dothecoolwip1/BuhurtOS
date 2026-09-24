import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { expect, test, vi } from 'vitest';
import { Layout } from '../src/components/Layout';

vi.mock('../src/features/AppState', () => ({
  useAppState: () => ({ event: { id: 'selected-event', organizationId: 'org', name: 'Test event' },
    online: true, pendingCount: 0, dataMode: 'demo', user: { platformRoles: [], organizationRoles: [], eventRoles: [] } })
}));

test('operations navigation retains the requested event', () => {
  const html = renderToStaticMarkup(<MemoryRouter initialEntries={['/ops?event=selected-event']}><Layout /></MemoryRouter>);
  for (const route of ['/ops/roster', '/ops/bracket', '/ops/standings', '/live', '/ops/sync']) {
    expect(html).toContain(`href="${route}?event=selected-event"`);
  }
});
