# One-time setup on the owner's Windows PC for the buhurtos-full-test skill. Run from the repository root in PowerShell:
#   powershell -ExecutionPolicy Bypass -File .agents\skills\buhurtos-full-test\scripts\setup-edge-sessions.ps1 -SignIn
# It registers seven Playwright MCP servers for Claude Code in LOCAL scope (this repository on this PC only, nothing committed), each driving its
# own Microsoft Edge with its own profile folder, so the seven people never share a session. With -SignIn it then opens the three profiles that
# need an account so you can sign in by hand once. Claude never sees or types passwords. Re-running is safe: it replaces the same seven entries.
param([switch]$SignIn)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path '.agents\skills\buhurtos-full-test')) { throw 'Run this from the BuhurtOS repository root.' }
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) { throw 'Claude Code is not installed (claude not found on PATH).' }
if (-not (Get-Command npx -ErrorAction SilentlyContinue)) { throw 'Node.js is not installed (npx not found on PATH).' }
$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { throw 'Microsoft Edge was not found.' }

$root = Join-Path $env:LOCALAPPDATA 'BuhurtOS-rehearsal'
# Matches .agents/skills/buhurtos-rehearsal/references/profiles.md: A organizer, B secretary, C-F counters, G guest (spectator and every other role, one at a time).
$sessions = @(
  @{ name = 'edge-organizer'; size = '1440x900'; signIn = $true  },
  @{ name = 'edge-secretary'; size = '1440x900'; signIn = $true  },
  @{ name = 'edge-counter-1'; size = '390x844';  signIn = $false },
  @{ name = 'edge-counter-2'; size = '390x844';  signIn = $false },
  @{ name = 'edge-counter-3'; size = '390x844';  signIn = $false },
  @{ name = 'edge-counter-4'; size = '390x844';  signIn = $false },
  @{ name = 'edge-guest';     size = '390x844';  signIn = $true  }
)
foreach ($s in $sessions) {
  $profile = Join-Path $root "profiles\$($s.name)"
  $output = Join-Path $root "output\$($s.name)"
  New-Item -ItemType Directory -Force -Path $profile, $output | Out-Null
  & claude mcp remove $s.name -s local 2>$null | Out-Null
  & claude mcp add $s.name -s local -- cmd /c npx -y '@playwright/mcp@0.0.83' --browser msedge --user-data-dir $profile --viewport-size $s.size --output-dir $output --console-level warning --caps devtools
  if ($LASTEXITCODE -ne 0) { throw "Could not register $($s.name)." }
  Write-Host "Registered $($s.name) ($($s.size)) with profile folder $profile"
}
if ($SignIn) {
  foreach ($s in $sessions | Where-Object { $_.signIn }) {
    Start-Process $edge -ArgumentList "--user-data-dir=`"$(Join-Path $root "profiles\$($s.name)")`"", '--no-first-run', 'https://buhurt-os.app/account'
  }
  Write-Host 'Sign in: edge-organizer as the organizer test account, edge-secretary as the scorekeeper test account.'
  Write-Host 'Leave edge-guest signed out (it signs in as other roles during a run, one at a time). Close all three windows when done.'
}
Write-Host 'Done. Start Claude Code in this folder and run: claude mcp list'
