# Local replacement for .github/workflows/refresh.yml.
# Hits the snapshot/enrichment endpoints, merges them, writes data/snapshot.json,
# commits and pushes. Used while GitHub Actions minutes are exhausted.

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path $PSScriptRoot -Parent

# Resolve CRON_SECRET: prefer session env var, fall back to .env.local
$Secret = $env:CRON_SECRET
if (-not $Secret) {
    $envFile = Join-Path $RepoRoot '.env.local'
    if (Test-Path $envFile) {
        $line = Get-Content $envFile | Where-Object { $_ -match '^CRON_SECRET=' } | Select-Object -First 1
        if ($line) { $Secret = $line -replace '^CRON_SECRET=', '' -replace '^"', '' -replace '"$', '' }
    }
}
if (-not $Secret) {
    Write-Error "CRON_SECRET not found in `$env:CRON_SECRET or .env.local"
    exit 1
}
$Base     = 'https://lib-site.vercel.app/api'
$Headers  = @{ Authorization = "Bearer $Secret" }

# Fallback gate. This task and the GitHub Actions cron (.github/workflows/
# refresh.yml, hourly at :17) do the identical job. While GH has Actions
# minutes it owns the refresh; this local task only needs to cover the part
# of the month after those minutes are exhausted. Running both every hour
# doubles the commits/redeploys and -- worse -- produces competing snapshot
# commits that fight each other on push. So if origin/main already has a
# snapshot commit newer than $FreshThresholdMin, GH is alive: fast-forward
# our checkout and bail. We only do the real work once the remote has gone
# stale (GH out of minutes / disabled).
$FreshThresholdMin = 60
git -C $RepoRoot fetch origin main
$lastTs = (git -C $RepoRoot log -1 --format=%ct origin/main -- data/snapshot.json)
if ($lastTs) {
    $ageMin = ([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() - [int64]$lastTs) / 60
    if ($ageMin -lt $FreshThresholdMin) {
        Write-Host ("Remote snapshot is {0:N0} min old; GH cron is active. Skipping." -f $ageMin)
        # Keep our checkout in sync so it never drifts; harmless no-op if
        # already current, and a clean ff when GH pushed since we last ran.
        git -C $RepoRoot merge --ff-only origin/main
        exit 0
    }
    Write-Host ("Remote snapshot is {0:N0} min old (>= {1}); taking over as fallback." -f $ageMin, $FreshThresholdMin)
}

try { Invoke-RestMethod "$Base/refresh" -Headers $Headers -TimeoutSec 90 | Out-Null }
catch { Write-Host "Warmup failed (non-fatal): $_" }

function Fetch-Retry($Url, $Label) {
    # Windows PowerShell 5.1's Invoke-RestMethod falls back to ISO-8859-1 when
    # the response Content-Type lacks an explicit charset (which Next.js's
    # NextResponse.json() does not set). That misdecode turned UTF-8 names
    # like "Stríðr" into "Strí­ðr" mojibake; round-tripping through
    # ConvertTo-Json then writing UTF-8 to disk doubled the byte length on
    # every refresh, ballooning rioCharacterIds keys into megabytes apiece.
    # Read RawContentStream bytes and decode UTF-8 explicitly instead.
    for ($i = 1; $i -le 3; $i++) {
        try {
            $resp  = Invoke-WebRequest $Url -Headers $Headers -TimeoutSec 90 -UseBasicParsing
            $bytes = $resp.RawContentStream.ToArray()
            $text  = [System.Text.Encoding]::UTF8.GetString($bytes)
            return $text | ConvertFrom-Json
        }
        catch {
            Write-Host "$Label attempt $i/3 failed: $_"
            if ($i -lt 3) { Start-Sleep 30 }
        }
    }
    throw "${Label}: all 3 attempts failed"
}

$snap   = Fetch-Retry "$Base/snapshot-export?merge=2&lite=1" "Snapshot"
$enrich = Fetch-Retry "$Base/snapshot-enrichments"          "Enrichments"

$snap | Add-Member -Force -NotePropertyName enrichedRoster     -NotePropertyValue $enrich.enrichedRoster
$snap | Add-Member -Force -NotePropertyName recentAchievements -NotePropertyValue $enrich.recentAchievements

$rosterLen = $snap.snapshot.roster.Count
if ($rosterLen -lt 20) {
    Write-Error "Suspiciously small roster ($rosterLen); aborting without write."
    exit 1
}
Write-Host "Roster size: $rosterLen"

$json = $snap | ConvertTo-Json -Depth 100
$path = Join-Path $RepoRoot 'data\snapshot.json'
[System.IO.File]::WriteAllBytes($path, [System.Text.UTF8Encoding]::new($false).GetBytes($json))

git -C $RepoRoot add data/snapshot.json
git -C $RepoRoot diff --staged --quiet
if ($LASTEXITCODE -eq 0) {
    Write-Host "No changes."
    exit 0
}
git -C $RepoRoot commit -m "data: local snapshot refresh (GH cron fallback) [skip-deploy]"

# Push with a reconcile-and-retry loop. main is shared with the GH cron and
# the occasional hand push, so a push can be rejected as non-fast-forward.
# The previous version pushed once, ignored the rejection, and printed
# "Pushed." regardless -- the commit was left unpushed and local drifted
# further from origin every run (that is how the 70+ commit backlog grew).
# On rejection, merge origin underneath us (-X ours keeps our freshly
# generated snapshot.json, the only file that can truly conflict) and retry.
for ($attempt = 1; $attempt -le 3; $attempt++) {
    git -C $RepoRoot push
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Pushed."
        # Mirror the GH workflow's "Announce new milestones" step: POST the
        # freshly-built snapshot to /api/announce so it diffs against its
        # Upstash baseline and posts new kills/records/PBs/Resilient to
        # #guild-feed. Without this, milestones captured while this local
        # fallback is active (GH Actions down) don't reach Discord until the
        # next successful GH run -- which can be hours. The route stays silent
        # until the feed has been seeded once. Non-fatal: a hiccup here never
        # fails the refresh. Reuses CRON_SECRET (the route accepts it as a
        # fallback) and sends the raw file bytes to avoid any re-encoding.
        try {
            $announceBody = [System.IO.File]::ReadAllBytes($path)
            Invoke-RestMethod "$Base/announce" -Method Post -Headers $Headers `
                -ContentType 'application/json' -Body $announceBody -TimeoutSec 60 | Out-Null
            Write-Host "Announce posted."
        }
        catch { Write-Host "Announce failed (non-fatal): $_" }
        exit 0
    }
    Write-Host "Push attempt $attempt rejected; reconciling with origin..."
    git -C $RepoRoot fetch origin main
    git -C $RepoRoot merge -X ours --no-edit origin/main
    Start-Sleep 5
}
Write-Error "Push still failing after 3 attempts; local is ahead of origin/main."
exit 1
