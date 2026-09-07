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

# Dead-window guard. Mirror .github/workflows/refresh.yml's active-hours gate:
# active window is ~8am-2am Central (CST); skip only the deep-overnight
# 10:00-13:00 UTC (~4-8am CST). Nobody's raiding or reading the site then, so we
# skip pulls/pushes entirely to save Vercel Active CPU.
#
# This MUST run before the fallback gate below: during the dead window the
# remote snapshot deliberately goes stale (the GH cron is intentionally quiet),
# which would otherwise trip the staleness check and make this task "take over"
# -- exactly what we're trying to avoid. The GH cron now runs every 2h, so the
# fallback threshold below is set above 2h to match.
$utcHourNow = [int][DateTime]::UtcNow.ToString('HH')
if ($utcHourNow -ge 10 -and $utcHourNow -le 13) {
    Write-Host ("Dead window ({0}:00 UTC ~ 4-8am CST) - skipping refresh." -f $utcHourNow)
    exit 0
}

# --- #only-moo daily cow post (independent of the snapshot refresh) ---
# Ping /api/moo on EVERY run — no hour check here. The route owns the windowing:
# it posts at most one cow per daily window (15:00 / 23:00 UTC) and CATCHES UP a
# window no runner hit on the hour. The old "hour -eq 15/23" gate silently lost
# the cow whenever this PC was asleep through the slot AND the GH cron's :17 run
# was delayed past the hour boundary. Pinging every run + server-side dedup fixes
# that. Non-fatal.
#
# CRITICAL: this MUST stay ABOVE the every-2h odd-hour gate below. The moo
# windows (15:00 / 23:00 UTC) are ODD hours, so if this only ran on even hours
# the cow would post ~1-2h late (or not at all when GH drops the even-hour run).
# The ping is a cheap POST the route dedupes — only the heavy SNAPSHOT build is
# throttled to every-2h, not the feed pings.
try {
    Invoke-RestMethod "$Base/moo" -Headers $Headers -TimeoutSec 30 | Out-Null
    Write-Host "Pinged /api/moo (route decides if a window is due)."
}
catch { Write-Host "Moo post failed (non-fatal): $_" }

# --- Sync the checkout with origin BEFORE announcing. -----------------------
# The announce ping below reads data/snapshot.json off DISK, but the checkout is
# only reconciled with origin/main much later (the fallback gate), and on odd
# hours we `exit 0` before ever getting there. So without this, an announce could
# diff a snapshot OLDER than one GH already built+pushed+announced — a poorer
# snapshot that used to un-know milestones and double-post. The server-side
# baseline is monotonic now (announce-detect), so this is belt-and-suspenders:
# it keeps the ping honest by fast-forwarding to the freshest COMMITTED snapshot
# first. ff-only never rewrites local work (refuses if we can't fast-forward, e.g.
# an un-pushed fallback build) — on any git hiccup we fall through and announce
# whatever is on disk, same as before. Non-fatal.
try {
    git -C $RepoRoot fetch origin main --quiet
    git -C $RepoRoot merge --ff-only origin/main --quiet 2>&1 | Out-Null
}
catch { Write-Host "Pre-announce sync skipped (non-fatal): $_" }

# --- #guild-feed milestones: ping /api/announce on EVERY run too. -----------
# The route overlays FRESH RIO scores (incremental — ONLY members active in the
# last 48h, a handful) onto the last committed snapshot before it diffs, so a
# personal best surfaces within ~1h instead of waiting for the next 2h build
# (RIO re-crawls a character minutes-to-hours after a run, so the build-time
# score misses a key run shortly before/after the build — this is why Kujatas'
# +31 didn't post on time). Like the moo ping, this MUST stay ABOVE the odd-hour
# gate — hourly timeliness is the whole point. Cheap (only active pushers are
# re-fetched) and idempotent (the baseline dedups, so re-POSTing the same
# snapshot posts nothing new). Non-fatal; uses the freshest snapshot on disk.
try {
    $snapPath = Join-Path $RepoRoot 'data\snapshot.json'
    if (Test-Path $snapPath) {
        $annBody = [System.IO.File]::ReadAllBytes($snapPath)
        Invoke-RestMethod "$Base/announce" -Method Post -Headers $Headers `
            -ContentType 'application/json' -Body $annBody -TimeoutSec 90 | Out-Null
        Write-Host "Pinged /api/announce (fresh-score overlay)."
    }
}
catch { Write-Host "Announce ping failed (non-fatal): $_" }

# Every-2h cadence — match the GH cron's `*/2`. The Task Scheduler trigger fires
# HOURLY, but GitHub drops most of its scheduled runs so this task is often the
# de-facto primary refresher; without this gate it would push every active hour
# (hourly), defeating the every-2h CPU saving. Run only on EVEN UTC hours, so
# active slots are 14,16,18,20,22,00,02,04,06,08 UTC (8am-2am Central/CST, every 2h),
# the same slots the GH cron targets.
#
# The #only-moo COW ping above stays hourly (its 15:00/23:00 UTC windows are ODD
# hours and the route catches up a late ping). The moo-events poll below sits
# AFTER this gate, so it runs every 2h: it parses his full ~2.7MB achievement
# history each time, so hourly would be wasteful, and 2h is plenty for a
# post-on-detection feed (armory re-crawl latency is hours regardless).
if ($utcHourNow % 2 -ne 0) {
    Write-Host ("Odd hour ({0}:00 UTC) - snapshot build + moo-events off the 2h cadence, skipping." -f $utcHourNow)
    exit 0
}

# --- #only-moo events: deaths + achievements, every 2h (post-on-detection). ---
# /api/moo-events diffs against its Upstash baseline and posts only new events
# (uncapped — the full history, not the 10-entry recent window), so it catches a
# whole backlog without spamming repeats; the GH cron (also every 2h) pings it
# too and the baseline dedupes. Non-fatal.
try {
    Invoke-RestMethod "$Base/moo-events" -Headers $Headers -TimeoutSec 60 | Out-Null
    Write-Host "Checked moo-events."
}
catch { Write-Host "Moo-events failed (non-fatal): $_" }

# Fallback gate. This task and the GitHub Actions cron (.github/workflows/
# refresh.yml, every 2h at :17) do the identical job. While GH has Actions
# minutes it owns the refresh; this local task only needs to cover the part
# of the month after those minutes are exhausted. So if origin/main already has
# a snapshot commit newer than $FreshThresholdMin, GH is alive: fast-forward our
# checkout and bail. We only do the real work once the remote has gone stale
# (GH out of minutes / disabled).
#
# Threshold is ABOVE the GH cadence (2h): GH runs every 2 hours, so the remote
# is normally up to ~120 min old between runs. 150 min keeps this task asleep in
# those gaps and only lets it take over when GH has genuinely missed a cycle.
#
# This MUST track the workflow cadence. If the cron is ever slowed, raise this
# with it: otherwise the local task reads a normal gap as "GH is dead", takes
# over, and pushes its own commits - every one of which is another Vercel
# deploy. (Was 60 min when GH ran hourly.)
$FreshThresholdMin = 150
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

# Character-sheet detail refresh. Precompute each character's sheet detail into
# Redis so the character page reads it instead of live-fetching (the live cold
# fanout intermittently 500'd the ISR generation). Mirrors the GH cron's
# "Refresh character sheets" step; placed AFTER the fallback gate so it only
# runs when this task owns the refresh (GH down) -- when GH is alive it already
# pings this hourly, and the route is incremental so a second ping is cheap
# anyway. Non-fatal. Full backfill is done out-of-band via ?force=1.
try {
    Invoke-RestMethod "$Base/snapshot-details" -Headers $Headers -TimeoutSec 290 | Out-Null
    Write-Host "Refreshed character-sheet details (incremental)."
}
catch { Write-Host "Character-sheet detail refresh failed (non-fatal): $_" }

# NOTE: the old "/api/refresh warmup" call was removed here, mirroring
# .github/workflows/refresh.yml. That route ran the full ungated enrichments
# fanout + a 64-character BNet warmup to prime an in-memory cache the ISR
# pages never read -- pure CPU waste -- and the route itself no longer exists.
# The snapshot is built entirely by the gated snapshot-export/enrichments
# calls below.

function Fetch-Retry($Url, $Label, $TimeoutSec = 185) {
    # Windows PowerShell 5.1's Invoke-RestMethod falls back to ISO-8859-1 when
    # the response Content-Type lacks an explicit charset (which Next.js's
    # NextResponse.json() does not set). That misdecode turned UTF-8 names
    # like "Stríðr" into "Strí­ðr" mojibake; round-tripping through
    # ConvertTo-Json then writing UTF-8 to disk doubled the byte length on
    # every refresh, ballooning rioCharacterIds keys into megabytes apiece.
    # Read RawContentStream bytes and decode UTF-8 explicitly instead.
    #
    # TimeoutSec MUST exceed the route's Vercel maxDuration (snapshot-export=180,
    # enrichments=300) so a slow-but-healthy run isn't abandoned and re-fired as
    # a second billing invocation while the first still runs. See refresh.yml.
    for ($i = 1; $i -le 3; $i++) {
        try {
            $resp  = Invoke-WebRequest $Url -Headers $Headers -TimeoutSec $TimeoutSec -UseBasicParsing
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

$snap = Fetch-Retry "$Base/snapshot-export?merge=1&lite=1" "Snapshot"

# Enrichments -- the heavy BNet /achievements fanout (tier badges, season
# titles, recent-achievements feed) -- isn't run every hour. With the Upstash
# tier-cache gating the per-char parse it's now ~17s (only changed chars
# re-fetch), but it's still the priciest call here. Gate on STALENESS, not
# wall-clock: refresh whenever the committed enrichments are older than
# $EnrichMaxAgeHours, regardless of the hour. (The old "exact hour 03/15 UTC"
# window kept getting stepped over in the GH-cron/local-fallback handoff --
# neither reliably fired during those hours -- which froze the feed for days.)
# The fresh endpoint stamps exportedAt; we persist it as .enrichmentsExportedAt
# and carry it forward untouched on the cheap runs. The hourly Job-1 numbers,
# the Discord feed, and the Resilient celebration are unaffected -- they come
# from snapshot-export and the snapshot itself, not from enrichments.
$EnrichMaxAgeHours = 8
$snapPath = Join-Path $RepoRoot 'data\snapshot.json'
# Explicit UTF-8 read: PS 5.1's Get-Content can misdecode UTF-8 without a BOM as
# ANSI, which would mojibake roster names on the carry-forward round-trip (same
# class of bug this script guards against on the Invoke-RestMethod side).
$prev = $null
if (Test-Path $snapPath) {
    $prev = [System.IO.File]::ReadAllText(
        $snapPath, [System.Text.UTF8Encoding]::new($false)) | ConvertFrom-Json
}
$prevMarker = if ($prev) { $prev.enrichmentsExportedAt } else { $null }
$needEnrich = $true
if ($prevMarker) {
    try {
        $ageH = ([DateTimeOffset]::UtcNow - [DateTimeOffset]::Parse($prevMarker)).TotalHours
        if ($ageH -lt $EnrichMaxAgeHours) {
            $needEnrich = $false
            Write-Host ("Enrichments {0:N1}h old (< {1}h) - carrying forward." -f $ageH, $EnrichMaxAgeHours)
        } else {
            Write-Host ("Enrichments {0:N1}h old (>= {1}h) - refreshing live." -f $ageH, $EnrichMaxAgeHours)
        }
    }
    catch { Write-Host "Bad enrichments marker '$prevMarker' ($_); refreshing live." }
} else {
    Write-Host "No enrichments marker - refreshing live."
}

$enrich       = $null
$enrichMarker = $prevMarker
if ($needEnrich) {
    try {
        $enrich = Fetch-Retry "$Base/snapshot-enrichments" "Enrichments" 310
        $enrichMarker = $enrich.exportedAt
    }
    catch { Write-Host "Enrichments refresh failed; carrying forward previous: $_" }
}
if (-not $enrich) {
    if ($prev) {
        $enrich = [pscustomobject]@{
            enrichedRoster     = $prev.enrichedRoster
            recentAchievements = $prev.recentAchievements
        }
    } else {
        $enrich = [pscustomobject]@{ enrichedRoster = @(); recentAchievements = @() }
    }
}

$snap | Add-Member -Force -NotePropertyName enrichedRoster        -NotePropertyValue $enrich.enrichedRoster
$snap | Add-Member -Force -NotePropertyName recentAchievements    -NotePropertyValue $enrich.recentAchievements
$snap | Add-Member -Force -NotePropertyName enrichmentsExportedAt -NotePropertyValue $enrichMarker

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
