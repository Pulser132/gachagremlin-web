<#
  GachaGremlin Warp Importer - Honkai: Star Rail

  What this script does, top to bottom:
    1. Reads Star Rail's own log file (under your Windows user profile) to
       find where the game is installed.
    2. Reads a small cache file the game itself already wrote to disk, and
       pulls out the "Warp History" web link the game generated the last
       time you opened that screen in-game.
    3. Calls HoYoverse's own warp-history API with that link to download
       your full warp history, page by page (including collaboration
       banners, which use a sibling endpoint).
    4. Copies the result (plain JSON, no game credentials) to your
       clipboard so you can paste it into GachaGremlin's import box.

  It never sends anything to any server other than HoYoverse's own API
  (hoyoverse.com). Nothing is uploaded to GachaGremlin, gist.github.com, or
  anywhere else. Feel free to read every line before you run it.

  Usage:
    iwr -useb https://pulser132.github.io/gachagremlin-web/import/hsr.ps1 | iex

  If the script can't find your install folder automatically, run it with
  an explicit path instead:
    iex "& { $(irm https://pulser132.github.io/gachagremlin-web/import/hsr.ps1) } 'D:\Games\StarRail\Games\StarRail_Data'"

  If you've opened the Warp History screen for more than one account on this
  PC, the game's cache can hold a still-valid link for each of them, and the
  script picks the one opened most recently by default. To target a specific
  account instead, pass its UID (leave the path blank to keep auto-detect):
    iex "& { $(irm https://pulser132.github.io/gachagremlin-web/import/hsr.ps1) } '' '100000001'"
#>
param(
    [Parameter(Position = 0)]
    [string]$GamePath,

    [Parameter(Position = 1)]
    [string]$Uid
)

[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Web

$StandardGachaTypes = @('1', '2', '11', '12')
$CollabGachaTypes = @('21', '22')
$PageSize = 20
$PageDelayMs = 350

function Get-VersionCompare {
    param([string]$A, [string]$B)
    $partsA = $A.Split('.') | ForEach-Object { [int]$_ }
    $partsB = $B.Split('.') | ForEach-Object { [int]$_ }
    for ($i = 0; $i -lt [Math]::Max($partsA.Count, $partsB.Count); $i++) {
        $va = if ($i -lt $partsA.Count) { $partsA[$i] } else { 0 }
        $vb = if ($i -lt $partsB.Count) { $partsB[$i] } else { 0 }
        if ($va -ne $vb) { return $va - $vb }
    }
    return 0
}

function Build-Url {
    param([string]$BaseUrl, [hashtable]$Params)
    $qs = [System.Web.HttpUtility]::ParseQueryString('')
    foreach ($key in $Params.Keys) { $qs[$key] = $Params[$key] }
    $builder = New-Object System.UriBuilder($BaseUrl)
    $builder.Query = $qs.ToString()
    return $builder.Uri.AbsoluteUri
}

function Find-GamePathFromLog {
    param([string]$LogPath)
    if (-not (Test-Path -LiteralPath $LogPath)) { return $null }
    $logText = Get-Content -LiteralPath $LogPath -Raw
    if ([string]::IsNullOrEmpty($logText)) { return $null }
    $pathMatch = [regex]::Match($logText, '(?<path>[A-Za-z]:[\\/].*?StarRail_Data)[\\/]')
    if (-not $pathMatch.Success) { return $null }
    return ($pathMatch.Groups['path'].Value -replace '/', '\')
}

try {
    Write-Host 'GachaGremlin Warp Importer - Honkai: Star Rail'
    Write-Host 'Looking for your Warp History link...'

    if (-not $GamePath) {
        $localLow = "$env:USERPROFILE\AppData\LocalLow\Cognosphere\Star Rail"
        $GamePath = Find-GamePathFromLog "$localLow\Player.log"
        if (-not $GamePath) { $GamePath = Find-GamePathFromLog "$localLow\Player-prev.log" }

        if (-not $GamePath) {
            Write-Host 'Could not figure out your Star Rail install folder from the game logs.' -ForegroundColor Red
            Write-Host 'Make sure you have run the game at least once on this PC, then try again, or run the' -ForegroundColor Red
            Write-Host 'script again with your install path, e.g.:' -ForegroundColor Red
            Write-Host "  iex `"& { `$(irm <script-url>) } 'D:\Games\StarRail\Games\StarRail_Data'`"" -ForegroundColor Red
            return
        }
    }

    if (-not (Test-Path -LiteralPath $GamePath)) {
        Write-Host "The game folder '$GamePath' does not exist." -ForegroundColor Red
        return
    }

    $cacheRoot = Join-Path $GamePath 'webCaches'
    if (-not (Test-Path -LiteralPath $cacheRoot)) {
        Write-Host 'No web cache folder found yet.' -ForegroundColor Red
        Write-Host 'Open the Warp History screen in-game (from any banner, tap History), then run this script again.' -ForegroundColor Red
        return
    }

    $versionFolders = Get-ChildItem -LiteralPath $cacheRoot -Directory | Where-Object { $_.Name -match '^\d+(\.\d+)*$' }
    if (-not $versionFolders) {
        Write-Host 'No cached web data found yet.' -ForegroundColor Red
        Write-Host 'Open the Warp History screen in-game, then run this script again.' -ForegroundColor Red
        return
    }

    $latestVersion = $null
    foreach ($folder in $versionFolders) {
        if (-not $latestVersion -or (Get-VersionCompare $folder.Name $latestVersion) -gt 0) {
            $latestVersion = $folder.Name
        }
    }

    $cacheDataPath = Join-Path $cacheRoot "$latestVersion\Cache\Cache_Data\data_2"
    if (-not (Test-Path -LiteralPath $cacheDataPath)) {
        Write-Host 'Could not find the cached web data file.' -ForegroundColor Red
        Write-Host 'Open the Warp History screen in-game, then run this script again.' -ForegroundColor Red
        return
    }

    # The game keeps this file open, so read from a copy rather than the live file.
    $tempPath = [IO.Path]::GetTempFileName()
    Copy-Item -LiteralPath $cacheDataPath -Destination $tempPath -Force
    $cacheText = [System.IO.File]::ReadAllText($tempPath, [System.Text.Encoding]::UTF8)
    Remove-Item -LiteralPath $tempPath -Force

    $candidates = New-Object System.Collections.Generic.List[object]
    foreach ($segment in ($cacheText -split '1/0/')) {
        if ($segment.StartsWith('http') -and ($segment.Contains('getGachaLog') -or $segment.Contains('getLdGachaLog'))) {
            $urlMatch = [regex]::Match($segment, 'https?://[^\x00-\x20\x7F-\xFF]+')
            if ($urlMatch.Success) {
                $url = ($urlMatch.Value -split '&end_id=')[0] + '&end_id=0'
                $timestamp = 0
                $tsMatch = [regex]::Match($url, 'timestamp=(\d+)')
                if ($tsMatch.Success) { $timestamp = [int64]$tsMatch.Groups[1].Value }
                $candidates.Add([PSCustomObject]@{ Url = $url; Timestamp = $timestamp })
            }
        }
    }

    if ($candidates.Count -eq 0) {
        Write-Host 'No Warp History link found in the cache.' -ForegroundColor Red
        Write-Host 'Open the Warp History screen in-game (from any banner, tap History), then run this script again.' -ForegroundColor Red
        return
    }

    # Every still-valid cached link is collected (not just the first one
    # that probes OK) because the cache can hold a valid link for more than
    # one account if you've opened Warp History for more than one on this
    # PC — picking "first valid" alone previously caused a wrong account's
    # history to be silently downloaded when that happened.
    $validCandidates = New-Object System.Collections.Generic.List[object]
    foreach ($candidate in ($candidates | Sort-Object -Property Timestamp -Descending)) {
        # Always verify against the standard endpoint, even if the cached
        # candidate happened to be a getLdGachaLog (collab) URL — same
        # authkey works on both, and getGachaLog is guaranteed to exist.
        $probeUrl = $candidate.Url -replace 'getLdGachaLog', 'getGachaLog'
        try {
            $probe = Invoke-RestMethod -Uri $probeUrl -UseBasicParsing -ContentType 'application/json'
        } catch {
            continue
        }
        if ($probe.retcode -ne 0) { continue }
        $probeUid = if ($probe.data -and $probe.data.list -and $probe.data.list.Count -gt 0) { "$($probe.data.list[0].uid)" } else { $null }
        $validCandidates.Add([PSCustomObject]@{ Url = $probeUrl; Uid = $probeUid })
        if ($Uid -and $probeUid -eq $Uid) { break }
    }

    if ($validCandidates.Count -eq 0) {
        Write-Host 'Your Warp History link has expired.' -ForegroundColor Red
        Write-Host 'Reopen the Warp History screen in-game to refresh it, then run this script again.' -ForegroundColor Red
        return
    }

    $chosen = $null
    if ($Uid) {
        $chosen = $validCandidates | Where-Object { $_.Uid -eq $Uid } | Select-Object -First 1
        if (-not $chosen) {
            $foundUids = ($validCandidates | ForEach-Object { $_.Uid } | Where-Object { $_ } | Select-Object -Unique) -join ', '
            Write-Host "No cached Warp History link matches UID $Uid." -ForegroundColor Red
            if ($foundUids) { Write-Host "Found links for: $foundUids instead." -ForegroundColor Red }
            Write-Host 'Log into that account in-game, open the Warp History screen, then run this script again.' -ForegroundColor Red
            return
        }
    } else {
        $chosen = $validCandidates[0]
        $distinctUids = $validCandidates | ForEach-Object { $_.Uid } | Where-Object { $_ } | Select-Object -Unique
        if ($distinctUids.Count -gt 1) {
            Write-Host "Found valid Warp History links for multiple accounts in the game's cache: $($distinctUids -join ', ')." -ForegroundColor Yellow
            Write-Host "Using UID $($chosen.Uid) (its link was opened most recently)." -ForegroundColor Yellow
            Write-Host 'If that is the wrong account, press Ctrl+C now and run again with its UID, e.g.:' -ForegroundColor Yellow
            Write-Host "  iex `"& { `$(irm <script-url>) } '' 'UID_HERE'`"" -ForegroundColor Yellow
        }
    }
    $authUrl = $chosen.Url

    Write-Host 'Found a valid Warp History link. Downloading your warp history...'

    $baseUri = [System.Uri]$authUrl
    $stdApiBase = $baseUri.GetLeftPart([System.UriPartial]::Path)
    $ldApiBase = $stdApiBase -replace 'getGachaLog$', 'getLdGachaLog'
    $origQuery = [System.Web.HttpUtility]::ParseQueryString($baseUri.Query)
    $baseParams = @{}
    foreach ($key in $origQuery.AllKeys) {
        if ($key) { $baseParams[$key] = $origQuery[$key] }
    }
    $region = if ($baseParams.ContainsKey('region')) { $baseParams['region'] } elseif ($baseParams.ContainsKey('game_biz')) { $baseParams['game_biz'] } else { '' }

    $items = New-Object System.Collections.Generic.List[object]
    $uid = $chosen.Uid

    # The list and params are passed in, and the uid comes back as a return
    # value, rather than either crossing scopes through $script:. When this
    # script is run as `iex "& { <text> } '' '<uid>'"` — the form that targets a
    # specific account, and the one the import dialog now emits — the body runs
    # inside a child scope, so $script: resolves to the *global* scope, where
    # $items and $uid do not exist. $script:items.Add() then failed with "You
    # cannot call a method on a null-valued expression". The plain
    # `iwr ... | iex` form only worked by luck: it executes in the current
    # scope, so $script:items happened to be the same variable.
    #
    # Unqualified reads ($PageSize, Build-Url) are fine either way — they walk
    # up the scope chain. It is only $script: that is anchored elsewhere.
    function Get-Banners {
        param(
            [string]$ApiBase,
            [string[]]$GachaTypes,
            [hashtable]$BaseParams,
            [System.Collections.Generic.List[object]]$Items
        )
        $seenUid = $null
        foreach ($gachaType in $GachaTypes) {
            Write-Host "  Fetching banner type $gachaType..."
            $endId = '0'
            while ($true) {
                $params = $BaseParams.Clone()
                $params['gacha_type'] = $gachaType
                $params['size'] = "$PageSize"
                $params['end_id'] = $endId
                $url = Build-Url -BaseUrl $ApiBase -Params $params

                try {
                    $resp = Invoke-RestMethod -Uri $url -UseBasicParsing -ContentType 'application/json'
                } catch {
                    Write-Host '    Request failed, moving on to the next banner.' -ForegroundColor Yellow
                    break
                }
                if ($resp.retcode -ne 0 -or -not $resp.data -or -not $resp.data.list -or $resp.data.list.Count -eq 0) {
                    break
                }

                foreach ($entry in $resp.data.list) {
                    if (-not $seenUid) { $seenUid = "$($entry.uid)" }
                    $Items.Add([PSCustomObject]@{
                        id         = "$($entry.id)"
                        bannerType = "$($entry.gacha_type)"
                        name       = "$($entry.name)"
                        itemType   = "$($entry.item_type)"
                        rank       = "$($entry.rank_type)"
                        time       = "$($entry.time)"
                    })
                }

                if ($resp.data.list.Count -lt $PageSize) { break }
                $endId = $resp.data.list[$resp.data.list.Count - 1].id
                Start-Sleep -Milliseconds $PageDelayMs
            }
        }
        return $seenUid
    }

    # $uid is normally already known from the probe; these only fill it in when
    # the probe came back with an empty list (an account whose first banner has
    # no warps), which is what the old $script:uid fallback was for.
    $stdUid = Get-Banners -ApiBase $stdApiBase -GachaTypes $StandardGachaTypes -BaseParams $baseParams -Items $items
    $ldUid = Get-Banners -ApiBase $ldApiBase -GachaTypes $CollabGachaTypes -BaseParams $baseParams -Items $items
    if (-not $uid) { $uid = if ($stdUid) { $stdUid } else { $ldUid } }

    if ($items.Count -eq 0) {
        Write-Host 'No warps were found on any banner.' -ForegroundColor Red
        Write-Host 'Make sure you have made at least one warp, then try again.' -ForegroundColor Red
        return
    }

    $sortedItems = $items | Sort-Object -Property @{ Expression = { $_.id.Length } }, @{ Expression = { $_.id } }

    $epoch = [DateTime]::new(1970, 1, 1, 0, 0, 0, [DateTimeKind]::Utc)
    $exportedAt = [int64](((Get-Date).ToUniversalTime()) - $epoch).TotalSeconds

    $payload = [PSCustomObject]@{
        game       = 'hsr'
        uid        = "$uid"
        region     = "$region"
        exportedAt = $exportedAt
        items      = $sortedItems
    }

    $json = $payload | ConvertTo-Json -Compress -Depth 6

    # Set-Content -Encoding UTF8 always writes a byte-order mark on Windows
    # PowerShell 5.1, which breaks JSON.parse in the browser - write via
    # .NET directly with a BOM-less UTF8Encoding instead. Kept as a backup
    # file in case clipboard paste doesn't work in your setup; the primary
    # flow below copies the JSON itself, verified reliable through
    # Set-Clipboard even for multi-megabyte histories.
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $outputFile = Join-Path $env:TEMP 'gachagremlin-hsr-warps.json'
    [System.IO.File]::WriteAllText($outputFile, $json, $utf8NoBom)
    Set-Clipboard -Value $json

    Write-Host ''
    Write-Host "Done! Imported $($items.Count) warps for UID $uid." -ForegroundColor Green
    Write-Host 'Copied to your clipboard - paste it (Ctrl+V) into the GachaGremlin import box and click Import.' -ForegroundColor Yellow
    Write-Host "(A backup copy was also saved to $outputFile in case clipboard paste doesn't work - use the import box's `"Choose File`" button for that instead.)"
} catch {
    Write-Host ''
    Write-Host "Something went wrong: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'If this keeps happening, please open an issue on the GachaGremlin GitHub repo.' -ForegroundColor Red
}
