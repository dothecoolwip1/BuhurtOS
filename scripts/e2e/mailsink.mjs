// A tiny SMTP sink for the local real-auth stack: the real Supabase Auth server sends its emails (sign-up confirmation, password reset,
// reauthentication code) here instead of to the world. Each message is kept in memory and served as JSON on GET /messages, so a browser test can
// open the link exactly as a person would from their inbox. LOCAL EVIDENCE TOOLING ONLY.
//   SMTP on MAILSINK_SMTP_PORT (default 2500), HTTP on MAILSINK_HTTP_PORT (default 2580).
import net from 'node:net';
import http from 'node:http';

const SMTP_PORT = Number(process.env.MAILSINK_SMTP_PORT ?? 2500), HTTP_PORT = Number(process.env.MAILSINK_HTTP_PORT ?? 2580);
const messages = [];

// quoted-printable (what Auth uses for HTML mail) -> text, so links can be read back
const unQP = (s) => s.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
const unB64Parts = (raw) => raw.replace(/Content-Transfer-Encoding: base64\r?\n(?:[^\r\n]+\r?\n)*?\r?\n([A-Za-z0-9+/=\r\n]+?)(?=\r?\n--|\r?\n\r?\n|$)/g, (_, b) => Buffer.from(b.replace(/\s/g, ''), 'base64').toString('utf8'));

net.createServer((sock) => {
  let buf = '', inData = false, mail = { from: '', to: [], raw: '' };
  const say = (l) => sock.write(l + '\r\n');
  say('220 mailsink ESMTP');
  sock.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let i;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      if (inData) {
        if (line === '.') {
          inData = false;
          const raw = mail.raw, text = unB64Parts(unQP(raw));
          const subject = /^Subject: (.*)$/mi.exec(raw)?.[1] ?? '';
          const links = [...new Set([...text.matchAll(/https?:\/\/[^\s"'<>]+/g)].map(m => m[0].replace(/&amp;/g, '&')))];
          messages.push({ at: new Date().toISOString(), from: mail.from, to: mail.to, subject, text, links });
          mail = { from: '', to: [], raw: '' };
          say('250 OK queued');
        } else mail.raw += (line.startsWith('..') ? line.slice(1) : line) + '\r\n';
        continue;
      }
      const cmd = line.slice(0, 4).toUpperCase();
      if (cmd === 'EHLO') { say('250-mailsink'); say('250 8BITMIME'); }
      else if (cmd === 'HELO') say('250 mailsink');
      else if (cmd === 'MAIL') { mail.from = /<([^>]*)>/.exec(line)?.[1] ?? ''; say('250 OK'); }
      else if (cmd === 'RCPT') { mail.to.push(/<([^>]*)>/.exec(line)?.[1] ?? ''); say('250 OK'); }
      else if (cmd === 'DATA') { inData = true; say('354 go ahead'); }
      else if (cmd === 'RSET') { mail = { from: '', to: [], raw: '' }; say('250 OK'); }
      else if (cmd === 'QUIT') { say('221 bye'); sock.end(); }
      else if (cmd === 'NOOP') say('250 OK');
      else say('250 OK');
    }
  });
  sock.on('error', () => undefined);
}).listen(SMTP_PORT, '127.0.0.1');

http.createServer((req, res) => {
  if (req.method === 'DELETE') { messages.length = 0; res.writeHead(204); return res.end(); }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(messages));
}).listen(HTTP_PORT, '127.0.0.1', () => console.log(`mailsink smtp :${SMTP_PORT} http :${HTTP_PORT}`));
