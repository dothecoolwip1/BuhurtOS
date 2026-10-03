# Vercel QA Deployment Setup

This document guides setting up a dedicated Vercel QA environment for BuhurtOS testing with real authentication.

## Prerequisites

- GitHub account with access to the BuhurtOS repository
- Vercel account connected to GitHub
- Access to the Supabase project dashboard
- The branch `claude/team-page-admin-perms-uj82pe` which includes `vercel.json`

## Step 1: Create Vercel Project

### Option A: Via Vercel Dashboard
1. Go to https://vercel.com/dashboard
2. Click "Add New..." → "Project"
3. Search for and select the `buhurtos` repository
4. Configure:
   - **Framework Preset**: Vite
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
   - **Install Command**: `npm ci --no-audit --no-fund`
   - Click "Deploy"

### Option B: Via Vercel CLI
```bash
vercel link  # Link to your Vercel account and project
vercel        # Deploy
```

### Result
You'll get a Vercel URL, typically: `https://buhurtos-qa.vercel.app` or similar.
Save this URL - you'll need it for Supabase configuration.

## Step 2: Configure Environment Variables in Vercel

In Vercel project settings → Environment Variables, add:

```
VITE_SUPABASE_URL = https://mvbxlebznlgroptwwdsm.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY = sb_publishable_u76M-dggKSsdsyhUQKveJg_5fPJ5Nan
VITE_BASE = /
```

(These values come from the current production Supabase project - keep them the same)

Redeploy after adding these variables:
1. Go to Deployments
2. Click the latest deployment
3. Click "Redeploy"

## Step 3: Update Supabase Authentication Settings

These redirect URLs allow the Vercel QA site to authenticate properly:

### Go to Supabase Dashboard
1. Navigate to https://app.supabase.com/
2. Select the BuhurtOS project
3. Go to **Authentication** → **URL Configuration**

### Add Redirect URLs
Under "Redirect URLs" (at the bottom), add:
- `https://your-vercel-qa-url.vercel.app/`
- `https://your-vercel-qa-url.vercel.app/account`
- `https://your-vercel-qa-url.vercel.app/test-login`

Replace `your-vercel-qa-url` with your actual Vercel domain.

### Save Configuration
Click "Save"

### If Using Google OAuth
Also add the Vercel URL to Google OAuth authorized redirect URIs:
1. Go to **Authentication** → **Providers** → **Google**
2. In your Google Cloud Console, add the redirect URIs:
   - `https://your-vercel-qa-url.vercel.app/auth/v1/callback`

## Step 4: Test the Deployment

### Basic Functionality
1. Open `https://your-vercel-qa-url.vercel.app/`
2. Confirm homepage loads
3. Try navigating to `/test-login`
4. Refresh the page - should stay at same URL

### Authentication Flow
1. Go to `/test-login`
2. Sign in with a test account:
   - Email: `fighter@buhurtos.ca` (or other test role)
   - Password: [enter the test account password]
3. Confirm redirect to `/account`
4. Refresh browser - should stay authenticated
5. Sign out
6. Confirm `/platform` shows "This area is for the platform owner" (access denied)
7. Go back to `/test-login`
8. Sign in as Super Admin (if available)
9. Navigate to `/platform` - should show platform dashboard
10. Verify `/platform/analytics` loads
11. Refresh - session should persist

### Direct Route Navigation
Test these directly in the address bar:
- `/test-login` - should show login form
- `/account` - should show account page or redirect to login
- `/welcome` - should show profile setup or account
- `/team-manager` - should require login
- `/platform` - should require Super Admin
- `/platform/analytics` - should require Super Admin
- `/events/red-deer-rumble-test/manage` - should show event management or access denied
- `/platform/bugs` - should require Super Admin

All routes should load without 404 errors.

## Step 5: Browser Automation Testing

Use Playwright or similar to verify session persistence:

```javascript
const browser = await playwright.chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

// Test 1: Direct access to signin
await page.goto('https://your-vercel-qa-url.vercel.app/test-login');
// ... enter credentials and sign in ...

// Test 2: Navigate authenticated routes
await page.goto('https://your-vercel-qa-url.vercel.app/account');
// Should show account page, not signin

// Test 3: Refresh persists session
await page.reload();
// Should still show account page

// Test 4: Sign out clears session
// ... click sign out button ...
await page.goto('https://your-vercel-qa-url.vercel.app/platform');
// Should show access denied, not platform dashboard

// Test 5: New signin doesn't inherit previous role
// ... sign in as Fighter ...
// ... sign out ...
// ... sign in as Super Admin ...
// Should have Super Admin access, not Fighter access
```

## Troubleshooting

### Issue: "Vercel 404" on direct route navigation

**Cause**: Vercel SPA routing not configured
**Solution**: Verify `vercel.json` is in root of repository with rewrite rules

### Issue: OAuth redirect fails or "Invalid redirect URL"

**Cause**: Vercel URL not added to Supabase allowed redirects
**Solution**: Check Supabase URL Configuration under Authentication settings

### Issue: "Failed to authenticate" on test-login

**Cause**: Test account doesn't exist or password is incorrect
**Solution**: Verify test accounts exist in Supabase `auth.users` table

### Issue: Session lost after refresh

**Cause**: Session storage issues or environment variable mismatch
**Solution**: 
- Verify VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are set in Vercel
- Clear browser cache and try again
- Check browser console for errors

### Issue: Automated browser login fails but manual browser login works

**Cause**: Could be cookie handling, PKCE flow issues, or timing
**Solution**:
- Check browser console for errors
- Verify localStorage is enabled
- Add delays between navigation and form submission
- Check that redirectTo URL matches allowed origins

## Environment Variables Reference

| Variable | Value | Purpose |
|----------|-------|---------|
| `VITE_BASE` | `/` | Root path for Vercel (different from GitHub Pages `/BuhurtOS/`) |
| `VITE_SUPABASE_URL` | Supabase project URL | Backend connection |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Publishable key | Client-side authentication (safe to expose) |
| `VITE_POSTHOG_KEY` | (optional) | Analytics (only if PostHog is configured) |

## Security Notes

- All environment variables are read-only by the application
- Supabase keys shown here are public/publishable only - they cannot delete data
- All sensitive operations are enforced by database-level RLS and security functions
- Test accounts should only exist in development/QA environment
- Never commit actual passwords to the repository

## Verification Checklist

- [ ] Vercel project created and deployed
- [ ] `vercel.json` in repository
- [ ] Environment variables set in Vercel
- [ ] Supabase redirect URLs configured
- [ ] Homepage loads (test SPA routing)
- [ ] `/test-login` loads (test route navigation)
- [ ] Can sign in with test account (test authentication)
- [ ] Session persists on refresh (test persistence)
- [ ] Can access role-specific pages when signed in (test authorization)
- [ ] Access denied for unauthorized routes (test enforcement)
- [ ] Sign out clears session (test cleanup)
- [ ] Playwright/browser automation works (test automation)

## Next Steps

1. Deploy to Vercel using these instructions
2. Verify all tests pass
3. Use the QA URL for browser-based testing and automation
4. Continue with GitHub Pages as primary production deployment
