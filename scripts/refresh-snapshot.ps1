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
if ($LASTEXITCODE -ne 0) {
    git -C $RepoRoot commit -m "data: manual snapshot refresh"
    git -C $RepoRoot push
    Write-Host "Pushed."
} else {
    Write-Host "No changes."
}
