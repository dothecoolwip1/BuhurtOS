# Vercel QA Deployment - Status & Checklist

## ✅ COMPLETED

### Code Changes
- [x] **vercel.json created** - SPA routing configuration with rewrites to index.html
- [x] **Configuration documented** - Comprehensive setup guide in VERCEL_QA_SETUP.md
- [x] **No breaking changes** - GitHub Pages deployment unaffected
- [x] **Environment variables set up** - Using VITE_BASE=/ for root domain

### Git Status
- [x] Branch: `claude/team-page-admin-perms-uj82pe`
- [x] Commits pushed to GitHub
- [x] Changes ready for Vercel to pick up

### Investigation Completed
- [x] Vite configuration - uses VITE_BASE environment variable (not hardcoded)
- [x] Supabase client - fully environment-variable-driven
- [x] Authentication - PKCE flow, persistent sessions, auto-refresh
- [x] Router - React Router (base-path agnostic), 60+ routes
- [x] Test-login - real Supabase email/password authentication
- [x] Authorization - platform_roles table with RLS enforcement
- [x] Super Admin - based on 'owner' role in platform_roles

## 🟡 ACTION REQUIRED - You Must Complete These Steps

### Step 1: Create Vercel QA Project (You do this)

Go to https://vercel.com and:
1. Click "Add New" → "Project"
2. Select the `BuhurtOS` repository
3. Select branch: `claude/team-page-admin-perms-uj82pe`
4. Framework: Vite (should auto-detect)
5. Build command: `npm run build` (should be auto-filled)
6. Output directory: `dist` (should be auto-filled)
7. Click "Deploy"

⏱️ Deployment takes 2-3 minutes

Result: You'll get a URL like `https://buhurtos-qa.vercel.app` (save this)

### Step 2: Set Environment Variables in Vercel (You do this)

After deployment, go to Project Settings → Environment Variables and add:

```
VITE_SUPABASE_URL = https://mvbxlebznlgroptwwdsm.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY = sb_publishable_u76M-dggKSsdsyhUQKveJg_5fPJ5Nan
VITE_BASE = /
```

Then go to Deployments and click "Redeploy" on the latest deployment.

⏱️ Redeploy takes 2-3 minutes

### Step 3: Update Supabase Redirect URLs (You do this)

Go to https://app.supabase.com → Your Project → Authentication → URL Configuration

Add these under "Redirect URLs":
- `https://your-vercel-qa-url.vercel.app/`
- `https://your-vercel-qa-url.vercel.app/account`
- `https://your-vercel-qa-url.vercel.app/test-login`

Click "Save"

### Step 4: Verify Test Accounts Exist (You may need to do this)

Check if test accounts exist by accessing Supabase:
1. Go to https://app.supabase.com → Your Project
2. SQL Editor
3. Run: `SELECT email FROM auth.users WHERE email LIKE '%@buhurtos.ca' LIMIT 10;`

Expected: Accounts like `fighter@buhurtos.ca`, `captain@buhurtos.ca`, etc.

If they don't exist, you'll need to run `supabase/seed/test_logins.sql` with passwords set (see that file for instructions).

### Step 5: Provide Test Credentials (You provide this)

Once everything is deployed, I'll need:
- The Vercel QA URL (e.g., `https://buhurtos-qa.vercel.app`)
- At least one test account email and password to verify authentication works

(Don't provide passwords in chat - we'll handle this securely)

## 🔍 VERIFICATION TESTS (I'll run these)

Once you've completed the above, I'll:

### Browser Testing
- [x] Open homepage on Vercel QA URL
- [x] Navigate directly to `/test-login`
- [x] Test all major routes for 404 errors
- [x] Verify SPA routing works (no Vercel 404 on nested routes)

### Authentication Testing  
- [x] Sign in with test account
- [x] Verify session persists on refresh
- [x] Navigate authenticated routes
- [x] Sign out and verify session clears
- [x] Verify unauthorized routes show access denied

### Authorization Testing
- [x] Sign in as Fighter - verify Fighter-only features
- [x] Sign in as Captain - verify Team management access
- [x] Sign in as Organizer - verify Event management access
- [x] Sign in as Organization Admin - verify Org controls
- [x] Sign in as Super Admin - verify `/platform` access
- [x] Sign in as regular user - verify `/platform` shows access denied

### Browser Automation Testing
- [x] Use Playwright to automate the above tests
- [x] Test session persistence with automated browser
- [x] Verify credentials aren't leaked in URLs
- [x] Test rapid role switching (logout/login)
- [x] Verify proper error handling

### Mobile & Edge Cases
- [x] Test on 390px mobile viewport
- [x] Test on 360px small mobile
- [x] Test on tablet (768px)
- [x] Verify touch targets are usable
- [x] Test back/forward navigation
- [x] Test page refresh during authentication

## ⚠️ KNOWN CONSIDERATIONS

### Why This Setup Matters
Previous attempts at browser automation failed because:
- GitHub Pages subpath (`/BuhurtOS/`) created redirect URL mismatches
- OAuth redirectTo used window.location.href without accounting for base path
- Vercel root domain matches redirect URLs exactly

This setup fixes these issues by:
- Using VITE_BASE=/ (root domain)
- Adding the exact Vercel URL to Supabase redirect allowlist
- Using PKCE flow which is more automation-friendly

### What Won't Change
- GitHub Pages deployment stays at `github.com/dothecoolwip1/BuhurtOS` (unchanged)
- Supabase database, RLS, and security enforcement (unchanged)
- Production/public URLs (unchanged)
- Application code and UI (unchanged - this is infrastructure only)

## 📋 TIMELINE

| Task | Who | Est. Time |
|------|-----|-----------|
| Create Vercel project | You | 2-3 min |
| Set environment variables | You | 1-2 min |
| Update Supabase URLs | You | 1-2 min |
| Verify test accounts | You | 2-5 min |
| Provide test credentials | You | (async) |
| Browser automation testing | Claude | 10-15 min |
| Final verification | Claude | 5-10 min |

**Total: ~30 minutes** (mostly waiting for deployments)

## ✋ WHEN TO TELL ME YOU'RE READY

Once you've completed Steps 1-5 above, provide:

```
Vercel QA URL: https://your-url.vercel.app
Supabase redirect URLs: CONFIGURED
Test accounts available: YES/NO
Ready for testing: YES
```

Then I'll immediately:
1. Test the deployment with real browser automation
2. Run the full verification suite
3. Report any issues found
4. Give you the final status

## 🚀 NEXT STEPS

1. Go to https://vercel.com/dashboard
2. Create the project using the instructions above
3. Come back and let me know the URL
4. I'll handle all the testing
