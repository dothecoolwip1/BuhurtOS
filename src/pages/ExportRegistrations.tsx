import { useState } from 'react';
import type { ManagedRegistration } from '../data/manage';
import { exportFileName, registrationsCsv } from '../lib/exportCsv';

/** Organizer-only download of the registration list. Medical notes are never included; emergency contacts only when the box is ticked. */
export function ExportRegistrations({ slug, registrations }: { slug: string; registrations: ManagedRegistration[] }) {
  const [withEmergency, setWithEmergency] = useState(false);
  const download = () => {
    // The byte order mark makes Excel read accented names as UTF-8.
    const blob = new Blob(['﻿', registrationsCsv(registrations, { includeEmergency: withEmergency })], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = exportFileName(slug, new Date(), withEmergency);
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <details className="panel info">
      <summary>Export registrations (CSV)</summary>
      <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
        <p className="src">Includes every registration with name, team, categories, email, insurance, fee and check-in. Never includes medical notes or free-text notes.</p>
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <input type="checkbox" checked={withEmergency} onChange={e => setWithEmergency(e.target.checked)} style={{ marginTop: 4 }} />
          <span>Include emergency contacts (organizers only, handle with care)</span>
        </label>
        <div><button type="button" className="btn btn-line" disabled={registrations.length === 0} onClick={download}>Download CSV ({registrations.length})</button></div>
      </div>
    </details>
  );
}
