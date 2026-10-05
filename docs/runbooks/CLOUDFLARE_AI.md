# Cloudflare Workers AI for BuhurtOS

BuhurtOS keeps Supabase as its authoritative backend. Cloudflare is used only as a protected AI inference service for organizer assistance.

## What this worker does

- exposes a health endpoint at `GET /health`
- exposes `POST /v1/event-assistant`
- validates the caller using the existing BuhurtOS Supabase access token
- supports `draft_event` and `polish_description`
- uses Cloudflare Workers AI through an AI binding
- returns structured JSON
- never writes event data to Supabase

The organizer must review and approve AI output before the normal BuhurtOS save path is used.

## Deploy

1. Create or sign in to a Cloudflare account.
2. From this repository:

```bash
cd workers/ai-event-assistant
npm install
npx wrangler login
npm run deploy
```

3. Cloudflare will return a URL similar to:

```text
https://buhurtos-ai-event-assistant.<your-subdomain>.workers.dev
```

4. Add that URL to the BuhurtOS frontend deployment as:

```text
VITE_AI_WORKER_URL=https://buhurtos-ai-event-assistant.<your-subdomain>.workers.dev
```

5. Redeploy BuhurtOS.

## Verify the worker

Open:

```text
https://<worker-url>/health
```

Expected shape:

```json
{
  "ok": true,
  "service": "buhurtos-ai-event-assistant",
  "model": "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
}
```

The AI endpoint requires a valid BuhurtOS Supabase session token. It should reject anonymous calls with HTTP 401.

## Free-plan behaviour

Workers AI has a daily free allocation. Keep the Cloudflare account on the Workers Free plan if the goal is to prevent paid overage. When the free allocation is exhausted, AI calls should fail rather than silently becoming paid usage.

## Security notes

- No Cloudflare API token is shipped to the browser.
- The Workers AI binding runs server side.
- Supabase remains the system of record.
- AI output is advisory and must be reviewed before saving.
- Inputs are capped to limit accidental or abusive usage.
- CORS is intentionally broad because authorization is enforced with a Supabase bearer token rather than trusting browser origin.
