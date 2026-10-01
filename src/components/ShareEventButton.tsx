import { useState } from 'react';
import { shareLink, type ShareOutcome } from '../lib/share';

const MESSAGE: Record<ShareOutcome, string> = {
  shared: '',
  cancelled: '',
  copied: 'Link copied. Paste it in a message.',
  failed: 'Could not share or copy the link. Copy it from the address bar.'
};

/** "Share this event": the phone share sheet where there is one, otherwise copies the page link. */
export function ShareEventButton({ title }: { title: string }) {
  const [note, setNote] = useState('');
  const onClick = async () => setNote(MESSAGE[await shareLink({ title, text: `${title} on BuhurtOS`, url: window.location.href })]);
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <button type="button" className="btn btn-line" onClick={() => { void onClick(); }}>Share this event</button>
      <span role="status" className="src">{note}</span>
    </div>
  );
}
