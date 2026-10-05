# Cloudflare Workers AI for BuhurtOS

BuhurtOS keeps Supabase as its authoritative backend. Cloudflare is used only as a protected AI inference service for organizer assistance.

## Existing Cloudflare Worker

Worker name:

```text
buhurtos-eventai
```

Production URL:

```text
https://buhurtos-eventai.garrettrobson95.workers.dev
```

The Worker was initially created in Cloudflare with the default Workers AI example. The source in this repository is intended to replace that example with the protected BuhurtOS Event Assistant implementation.

## Claude Code + Cloudflare setup

Cloudflare's current Claude Code setup recommends its official Skills plugin plus Cloudflare MCP access.

From Claude Code, run:

```text
/plugin marketplace add cloudflare/skills
/plugin install cloudflare@cloudflare
```

Then verify:

```bash
claude mcp list
```

The first time Claude uses a Cloudflare MCP tool, complete Cloudflare's OAuth flow in the browser and approve the permissions you want Claude to have.

The Cloudflare plugin provides persistent Cloudflare Skills and registers Cloudflare MCP servers. Wrangler remains the preferred tool for Worker-local development and deployment.

## What the BuhurtOS Worker does

- exposes a health endpoint at `GET /health`
- exposes `POST /v1/event-assistant`
- validates the caller using the existing BuhurtOS Supabase access token
- supports `draft_event` and `polish_description`
- uses Cloudflare Workers AI through an AI binding
- returns structured JSON
- never writes event data to Supabase

The organizer must review and approve AI output before the normal BuhurtOS save path is used.

## Replace the current example Worker

From the repository root:

```bash
cd workers/ai-event-assistant
npm install
npx wrangler login
npm run deploy
```

Wrangler should deploy to the existing Worker name `buhurtos-eventai` because that name is set in `wrangler.jsonc`.

Do not paste Cloudflare API tokens or account secrets into source files. Interactive local deployment should use Wrangler login or the Cloudflare MCP OAuth flow.

## Frontend configuration

The BuhurtOS frontend should use:

```text
VITE_AI_WORKER_URL=https://buhurtos-eventai.garrettrobson95.workers.dev
```

This URL is public by design. The AI endpoint itself authenticates requests with the signed-in user's Supabase bearer token.

## Verify the deployed Worker

Open:

```text
https://buhurtos-eventai.garrettrobson95.workers.dev/health
```

Expected shape after the repository Worker replaces the starter example:

```json
{
  "ok": true,
  "service": "buhurtos-ai-event-assistant",
  "model": "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
}
```

The AI endpoint must reject anonymous calls with HTTP 401.

## Free-plan behaviour

Workers AI has a daily free allocation. Keep the Cloudflare account on the Workers Free plan if the goal is to prevent paid overage. When the free allocation is exhausted, AI calls should fail rather than silently becoming paid usage.

## Security notes

- No Cloudflare API token is shipped to the browser.
- The Workers AI binding runs server side.
- Supabase remains the system of record.
- AI output is advisory and must be reviewed before saving.
- Inputs are capped to limit accidental or abusive usage.
- CORS is intentionally broad because authorization is enforced with a Supabase bearer token rather than trusting browser origin.
