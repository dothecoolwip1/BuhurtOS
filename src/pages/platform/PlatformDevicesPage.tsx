import { Link } from 'react-router-dom';
import { DeviceSessions } from '../../components/command/DeviceSessions';
import { PageHead } from '../../components/ui';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { PlatformGate } from './PlatformPages';

/**
 * Platform › Devices (Pack 25): every phone and tablet signed in on any event, for the platform owner. Move a counter, sign a phone out, look at
 * what it shows (read only). The owner never acts AS a device and never sees a code: codes are shown once, to the event's organizer.
 */
export function PlatformDevicesPage() {
  useDocumentTitle('Devices · Platform');
  return (
    <PlatformGate>
      <section className="plat" style={{ display: 'grid', gap: 16 }}>
        <PageHead eyebrow="Platform" title="Devices" lede="Every phone and tablet signed in on any event right now. Each event's organizer manages its own under Event Control › Counters and devices; this is the same list across the platform." />
        <p className="src"><Link to="/platform">← Platform</Link></p>
        <DeviceSessions />
      </section>
    </PlatformGate>
  );
}
