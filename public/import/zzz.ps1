<#
  GachaGremlin Signal Importer - Zenless Zone Zero

  What this script does, top to bottom:
    1. Reads Zenless Zone Zero's own log file (under your Windows user
       profile) to find where the game is installed.
    2. Reads a small cache file the game itself already wrote to disk, and
       pulls out the "Signal Search History" web link the game generated
       the last time you opened that screen in-game.
    3. Calls HoYoverse's own signal-history API with that link to download
       your full signal search history, page by page.
    4. Copies the result (plain JSON, no game credentials) to your
       clipboard so you can paste it into GachaGremlin's import box.

  It never sends anything to any server other than HoYoverse's own API
  (hoyoverse.com). Nothing is uploaded to GachaGremlin, gist.github.com, or
  anywhere else. Feel free to read every line before you run it.

  Usage:
    iwr -useb https://pulser132.github.io/gachagremlin-web/import/zzz.ps1 | iex

  If the script can't find your install folder automatically, run it with
  an explicit path instead:
    iex "& { $(irm https://pulser132.github.io/gachagremlin-web/import/zzz.ps1) } 'D:\Games\ZenlessZoneZero\ZenlessZoneZero_Data'"

  If you've opened the Signal Search History screen for more than one
  account on this PC, the game's cache can hold a still-valid link for each
  of them, and the script picks the one opened most recently by default. To
  target a specific account instead, pass its UID (leave the path blank to
  keep auto-detect):
    iex "& { $(irm https://pulser132.github.io/gachagremlin-web/import/zzz.ps1) } '' '100000001'"

  A third argument carries per-channel watermarks ("1:1700...,2:1699...") so
  only signals newer than what's already imported are downloaded. GachaGremlin's
  import dialog fills this in automatically; there's no reason to type it by
  hand. Omit it (or run the plain one-liner) for a full download.
#>
param(
    [Parameter(Position = 0)]
    [string]$GamePath,

    [Parameter(Position = 1)]
    [string]$Uid,

    # Watermarks for incremental import, from GachaGremlin's import dialog:
    # "1:1700...,2:1699..." - per channel type, the newest signal id already
    # stored. Paging stops at the watermark instead of re-downloading the whole
    # channel. Absent/empty means a full download, exactly as before.
    [Parameter(Position = 2)]
    [string]$Since
)

[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Web

$RealGachaTypes = @('1', '2', '3', '5')
# This host IGNORES the size parameter: it answers with 5 entries whatever we
# ask for (measured across size=1,2,3,5,6,10,20,50 - all returned exactly 5).
# The value is sent anyway, since the game's own webview sends it, but nothing
# is gained by tuning it. Star Rail's host does honour large sizes and hsr.ps1
# uses 500; Genshin's caps at 20. All three differ - see Todos/Todo_import_speed/.
$PageSize = 20
# This host ignoring `size` is what makes throttling ZZZ's problem specifically: a
# ~1150-signal history is ~232 requests here, against 7 for Star Rail at size=500.
# Sustaining ~10 req/s over that many requests trips HoYoverse's limiter - reported
# from the field as an unbroken stream of -110.
#
# The pace is therefore AIMD (the congestion-control scheme TCP uses), not a fixed
# constant: back off hard on -110, ease back down while requests are landing. This
# is deliberate, because there is no constant here to find. Two runs of the SAME
# script at the SAME 100ms did this:
#
#   Phase 6 verification | ~232 requests | zero -110
#   field report         | throttled on the FIRST channel, before it could have
#                        | earned a throttle at any pace
#
# Which reads as a token bucket that persists ACROSS runs - the field run started
# with a bucket the previous attempts had already drained. So the sustainable rate
# depends on recent history, not just on this run, and no hardcoded delay can be
# right for both cases. AIMD converges on whatever the server will tolerate today
# instead of guessing. Guessed constants against this host have already produced
# two silent bugs in this todo (see Todos/Todo_import_speed/).
#
# Burst first: 100ms is fine for HSR's 7 requests and for the start of a long ZZZ
# run, and the ramp handles it from there.
$PageDelayMs = 100
$MinPageDelayMs = 100
$MaxPageDelayMs = 2000
# Multiplicative increase on throttle, gentle proportional decrease on success -
# the asymmetry is the point: overshooting into the limiter is cheap to undo, and
# being slow for a few requests is cheaper than being throttled for many. Easing
# every 5th success rather than every success keeps the probe from immediately
# re-tripping what it just backed off from.
$PaceEaseAfterOk = 5
$PaceEaseFactor = 0.85
$MaxAttempts = 4
$RetryBackoffMs = @(500, 1000, 2000, 4000)
# Throttling gets its own, longer budget. A -110 means the server is fine and only
# wants us to wait, so giving up on it after 4 quick tries strands an import that
# would have finished; a network error, by contrast, is unlikely to clear by try 8.
$ThrottleMaxAttempts = 8
$ThrottleBackoffMs = @(1000, 2000, 4000, 8000, 15000, 15000, 15000)

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

<#
  Compares gacha ids the way GachaGremlin's compareIds (store.ts) does: longer
  string wins, equal lengths compare ordinally. The ids are 19-digit numbers
  that overflow both [int] and [double] (Number in JS), so numeric casts are
  not an option and plain string comparison mis-orders mixed lengths.
#>
function Compare-GachaId {
    param([string]$A, [string]$B)
    if ($A.Length -ne $B.Length) { return $A.Length - $B.Length }
    return [string]::CompareOrdinal($A, $B)
}

<#
  Parses the $Since argument into a channel-type -> watermark-id hashtable.
  Malformed pairs are dropped rather than fatal: a mangled watermark must
  degrade to "download that channel in full", never to a wrong stop.
#>
function Convert-SinceArg {
    param([string]$Arg)
    $map = @{}
    if (-not $Arg) { return $map }
    foreach ($pair in $Arg.Split(',')) {
        $kv = $pair.Split(':')
        if ($kv.Count -eq 2 -and $kv[0] -and $kv[1] -match '^\d+$') { $map[$kv[0]] = $kv[1] }
    }
    return $map
}

<#
  Fetches one page of signal history, retrying failures that stand a chance of
  clearing: a thrown request (a network blip) and retcode -110, HoYoverse's
  "visit too frequently" throttle. Anything else comes straight back to the
  caller - an expired authkey will never succeed on a retry.

  Throws once the attempts are exhausted, rather than returning nothing. The
  script this replaced shrugged a failed page off with "moving on to the next
  channel", which silently dropped that channel's older signals and then copied
  a payload that looked complete. A loud failure is always better than a quietly
  incomplete history.

  $Pace carries the request pace across calls and is adjusted AIMD-style: a -110
  doubles the delay, and a run of clean responses eases it back down. Both halves
  are load-bearing.

  Backing off at all is what the original per-page retry got wrong: it waited out
  the current page, succeeded, then reset to the fixed 100ms and walked straight
  back into the limiter on the next request - an unbroken stream of "throttling -
  retrying..." that never converged, because retrying was the only thing that ever
  changed and the request rate never did. Throttling is a property of the pace, so
  the pace is what has to change.

  Easing back down is what keeps that from overcorrecting: without it the pace only
  ratchets upward, so one -110 in the first channel pins the whole run at
  $MaxPageDelayMs long after the limiter would have let go.

  Together they converge on whatever rate the server currently tolerates, which is
  the only sane target - the limit is not a constant to look up. Two runs of the
  same script at the same 100ms produced zero -110 and immediate -110 respectively,
  consistent with a token bucket carried across runs. See Todos/Todo_import_speed/.

  A hashtable (reference type) rather than $script:, which resolves to the global
  scope under the `iex "& { <text> } 'args'"` form the import dialog emits - see
  the note above Get-Banners in hsr.ps1.
#>
function Invoke-GachaPage {
    param(
        [string]$Url,
        [hashtable]$Pace
    )

    # Two independent budgets. A shared counter would let a long throttle wait
    # consume the network budget, so the first blip after it would throw at once.
    $errorHits = 0
    $throttleHits = 0
    while ($true) {
        $lastError = $null
        $throttled = $false
        try {
            $resp = Invoke-RestMethod -Uri $Url -UseBasicParsing -ContentType 'application/json'
            if ($resp.retcode -ne -110) {
                # The additive-decrease half of AIMD. Without it the pace only ever
                # ratchets up, so a single -110 in the first channel pins the whole
                # run at $MaxPageDelayMs - ~8 minutes for a large ZZZ history - long
                # after the bucket refilled. Easing back down is what turns "it got
                # throttled once" into a brief slowdown instead of a slow import.
                $Pace.OkStreak++
                if ($Pace.OkStreak -ge $PaceEaseAfterOk -and $Pace.DelayMs -gt $MinPageDelayMs) {
                    $eased = [int]($Pace.DelayMs * $PaceEaseFactor)
                    # Defensive, and currently unreachable: PowerShell's [int] ROUNDS
                    # rather than truncates ([int]0.85 -eq 1), so [int]($d * 0.85)
                    # lands back on $d for $d -le 3 and the ramp would freeze there.
                    # $MinPageDelayMs = 100 means that range can't be reached - this
                    # only matters if someone lowers the floor, which is exactly the
                    # kind of edit that would look safe.
                    if ($eased -ge $Pace.DelayMs) { $eased = $Pace.DelayMs - 1 }
                    $Pace.DelayMs = [Math]::Max($eased, $MinPageDelayMs)
                    $Pace.OkStreak = 0
                }
                return $resp
            }
            $throttled = $true
            $lastError = 'HoYoverse is throttling this import (retcode -110)'
        } catch {
            $lastError = $_.Exception.Message
        }

        if ($throttled) {
            $throttleHits++
            $Pace.OkStreak = 0
            if ($throttleHits -ge $ThrottleMaxAttempts) {
                # Marks the throw as "rate limit", not "bad candidate", so the probe
                # loop can rethrow it instead of swallowing it as another dead link.
                $Pace.GaveUpThrottled = $true
                throw "HoYoverse kept throttling this import after $throttleHits attempts. Wait a few minutes and run the script again - it is a rate limit, not a problem with your account or your history link."
            }
            if ($Pace.DelayMs -lt $MaxPageDelayMs) {
                $Pace.DelayMs = [Math]::Min([int]($Pace.DelayMs * 2), $MaxPageDelayMs)
                Write-Host "    HoYoverse is throttling this import - slowing down to $($Pace.DelayMs)ms between requests..." -ForegroundColor Yellow
            } else {
                Write-Host "    Still throttled - waiting it out..." -ForegroundColor Yellow
            }
            $waitMs = $ThrottleBackoffMs[[Math]::Min($throttleHits - 1, $ThrottleBackoffMs.Count - 1)]
        } else {
            $errorHits++
            if ($errorHits -ge $MaxAttempts) {
                throw "Gave up after $errorHits attempts. Last error: $lastError"
            }
            Write-Host "    $lastError - retrying..." -ForegroundColor Yellow
            $waitMs = $RetryBackoffMs[[Math]::Min($errorHits - 1, $RetryBackoffMs.Count - 1)]
        }
        Start-Sleep -Milliseconds $waitMs
    }
}

function Find-GamePathFromLog {
    param([string]$LogPath)
    if (-not (Test-Path -LiteralPath $LogPath)) { return $null }
    $logText = Get-Content -LiteralPath $LogPath -Raw
    if ([string]::IsNullOrEmpty($logText)) { return $null }
    $lineMatch = [regex]::Match($logText, '\[Subsystems\] Discovering subsystems at path (?<path>.+?)/UnitySubsystems')
    if (-not $lineMatch.Success) { return $null }
    return ($lineMatch.Groups['path'].Value -replace '/', '\')
}

try {
    Write-Host 'GachaGremlin Signal Importer - Zenless Zone Zero'
    Write-Host 'Looking for your Signal Search History link...'

    if (-not $GamePath) {
        $localLow = "$env:USERPROFILE\AppData\LocalLow\miHoYo\ZenlessZoneZero"
        $GamePath = Find-GamePathFromLog "$localLow\Player.log"
        if (-not $GamePath) { $GamePath = Find-GamePathFromLog "$localLow\Player-prev.log" }

        if (-not $GamePath) {
            Write-Host 'Could not figure out your Zenless Zone Zero install folder from the game logs.' -ForegroundColor Red
            Write-Host 'Make sure you have run the game at least once on this PC, then try again, or run the' -ForegroundColor Red
            Write-Host 'script again with your install path, e.g.:' -ForegroundColor Red
            Write-Host "  iex `"& { `$(irm <script-url>) } 'D:\Games\ZenlessZoneZero\ZenlessZoneZero_Data'`"" -ForegroundColor Red
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
        Write-Host 'Open the Signal Search History screen in-game (from any channel, tap History), then run this script again.' -ForegroundColor Red
        return
    }

    $versionFolders = Get-ChildItem -LiteralPath $cacheRoot -Directory | Where-Object { $_.Name -match '^\d+(\.\d+)*$' }
    if (-not $versionFolders) {
        Write-Host 'No cached web data found yet.' -ForegroundColor Red
        Write-Host 'Open the Signal Search History screen in-game, then run this script again.' -ForegroundColor Red
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
        Write-Host 'Open the Signal Search History screen in-game, then run this script again.' -ForegroundColor Red
        return
    }

    # The game keeps this file open, so read from a copy rather than the live file.
    $tempPath = [IO.Path]::GetTempFileName()
    Copy-Item -LiteralPath $cacheDataPath -Destination $tempPath -Force
    $cacheText = [System.IO.File]::ReadAllText($tempPath, [System.Text.Encoding]::UTF8)
    Remove-Item -LiteralPath $tempPath -Force

    $candidates = New-Object System.Collections.Generic.List[object]
    foreach ($segment in ($cacheText -split '1/0/')) {
        if ($segment.StartsWith('http') -and $segment.Contains('getGachaLog')) {
            $urlMatch = [regex]::Match($segment, 'https?://[^\x00-\x20\x7F-\xFF]+')
            if ($urlMatch.Success) {
                $url = ($urlMatch.Value -split '&end_id=')[0] + '&end_id=0'
                $timestamp = 0
                $tsMatch = [regex]::Match($url, 'timestamp=(\d+)')
                if ($tsMatch.Success) { $timestamp = [int64]$tsMatch.Groups[1].Value }
                $authKey = ''
                $akMatch = [regex]::Match($url, '[?&]authkey=([^&]+)')
                if ($akMatch.Success) { $authKey = $akMatch.Groups[1].Value }
                $candidates.Add([PSCustomObject]@{ Url = $url; Timestamp = $timestamp; AuthKey = $authKey })
            }
        }
    }

    if ($candidates.Count -eq 0) {
        Write-Host 'No Signal Search History link found in the cache.' -ForegroundColor Red
        Write-Host 'Open the Signal Search History screen in-game (from any channel, tap History), then run this script again.' -ForegroundColor Red
        return
    }

    # Every still-valid cached link is collected (not just the first one
    # that probes OK) because the cache can hold a valid link for more than
    # one account if you've opened Signal Search History for more than one
    # on this PC — picking "first valid" alone previously caused a wrong
    # account's history to be silently downloaded when that happened.
    # The cache stores one entry per page the webview loaded, so the same authkey
    # shows up many times over (Star Rail's cache held 48 candidates covering
    # only 30 authkeys). Probing a repeat costs ~0.27s to learn what the first
    # probe already told us, so probe each authkey once.
    $seenAuthKeys = New-Object 'System.Collections.Generic.HashSet[string]'
    $validCandidates = New-Object System.Collections.Generic.List[object]
    # One pace for the whole run: probing is where an already-active throttle shows
    # up, and the page loop below inherits the pace it settles on.
    $pace = @{ DelayMs = $PageDelayMs; OkStreak = 0 }
    foreach ($candidate in ($candidates | Sort-Object -Property Timestamp -Descending)) {
        # HashSet.Add is false when it was already there. A candidate whose
        # authkey couldn't be parsed still gets probed rather than skipped.
        if ($candidate.AuthKey -and -not $seenAuthKeys.Add($candidate.AuthKey)) { continue }
        # Probing goes through the retry helper so a -110 here is waited out rather
        # than read as a verdict on the link. A bare Invoke-RestMethod treated the
        # throttle's non-zero retcode as "this candidate is invalid" and dropped it,
        # so a run that started while already rate-limited could discard every valid
        # link in the cache and report "your link has expired" - which sends the
        # player back into the game to refresh a link that was never the problem.
        # This is also the first request the script makes, so it is exactly where an
        # existing throttle gets discovered, and $pace carries what it learns
        # into the page loop below.
        try {
            $probe = Invoke-GachaPage -Url $candidate.Url -Pace $pace
        } catch {
            # A rate limit says nothing about this link, so it must not be filed as
            # a dead candidate - report it and let the player retry in a minute.
            if ($pace.GaveUpThrottled) { throw }
            continue
        }
        Start-Sleep -Milliseconds $pace.DelayMs
        # Every candidate has to be probed; there is no shortcut. Two tempting
        # ones were measured and both are wrong:
        #
        #   * "stop at the first expired (-101) link, since candidates are
        #     sorted newest-first" - Genshin's cache was observed holding ten
        #     links that share ONE timestamp, of which the first three were
        #     expired and the fourth was valid. Stopping early reports "your
        #     link has expired" while a working link sits right behind it.
        #   * "skip links whose timestamp is older than the ~24h expiry window
        #     without probing" - that timestamp is the webview's load time baked
        #     into the cached URL, not the authkey's issue time. A *valid*
        #     Genshin link was observed carrying a 15-day-old timestamp, and
        #     valid Star Rail links routinely read as 26h old.
        #
        # Authkey validity simply does not correlate with either the ordering or
        # the timestamp, so probing is the only oracle. The dedupe above is the
        # one sound saving: identical authkeys must answer identically.
        if ($probe.retcode -ne 0) { continue }
        $probeUid = if ($probe.data -and $probe.data.list -and $probe.data.list.Count -gt 0) { "$($probe.data.list[0].uid)" } else { $null }
        $validCandidates.Add([PSCustomObject]@{ Url = $candidate.Url; Uid = $probeUid })
        if ($Uid -and $probeUid -eq $Uid) { break }
    }

    if ($validCandidates.Count -eq 0) {
        Write-Host 'Your Signal Search History link has expired.' -ForegroundColor Red
        Write-Host 'Reopen the Signal Search History screen in-game to refresh it, then run this script again.' -ForegroundColor Red
        return
    }

    $chosen = $null
    if ($Uid) {
        $chosen = $validCandidates | Where-Object { $_.Uid -eq $Uid } | Select-Object -First 1
        if (-not $chosen) {
            $foundUids = ($validCandidates | ForEach-Object { $_.Uid } | Where-Object { $_ } | Select-Object -Unique) -join ', '
            Write-Host "No cached Signal Search History link matches UID $Uid." -ForegroundColor Red
            if ($foundUids) { Write-Host "Found links for: $foundUids instead." -ForegroundColor Red }
            Write-Host 'Log into that account in-game, open the Signal Search History screen, then run this script again.' -ForegroundColor Red
            return
        }
    } else {
        $chosen = $validCandidates[0]
        $distinctUids = $validCandidates | ForEach-Object { $_.Uid } | Where-Object { $_ } | Select-Object -Unique
        if ($distinctUids.Count -gt 1) {
            Write-Host "Found valid Signal Search History links for multiple accounts in the game's cache: $($distinctUids -join ', ')." -ForegroundColor Yellow
            Write-Host "Using UID $($chosen.Uid) (its link was opened most recently)." -ForegroundColor Yellow
            Write-Host 'If that is the wrong account, press Ctrl+C now and run again with its UID, e.g.:' -ForegroundColor Yellow
            Write-Host "  iex `"& { `$(irm <script-url>) } '' 'UID_HERE'`"" -ForegroundColor Yellow
        }
    }
    $authUrl = $chosen.Url

    Write-Host 'Found a valid Signal Search History link. Downloading your signal history...'

    $baseUri = [System.Uri]$authUrl
    $apiBase = $baseUri.GetLeftPart([System.UriPartial]::Path)
    $origQuery = [System.Web.HttpUtility]::ParseQueryString($baseUri.Query)
    $baseParams = @{}
    foreach ($key in $origQuery.AllKeys) {
        if ($key) { $baseParams[$key] = $origQuery[$key] }
    }
    $region = if ($baseParams.ContainsKey('region')) { $baseParams['region'] } elseif ($baseParams.ContainsKey('game_biz')) { $baseParams['game_biz'] } else { '' }

    $items = New-Object System.Collections.Generic.List[object]
    $uid = $chosen.Uid
    $sinceMap = Convert-SinceArg $Since
    $incremental = $sinceMap.Count -gt 0

    foreach ($gachaType in $RealGachaTypes) {
        # The API answers newest-first, so once an entry is at or below the
        # watermark (the newest signal GachaGremlin already has for this
        # channel), everything after it is already stored - stop the channel.
        $watermark = if ($incremental -and $sinceMap.ContainsKey($gachaType)) { $sinceMap[$gachaType] } else { $null }
        if ($watermark) {
            Write-Host "  Fetching channel type $gachaType (new signals only)..."
        } else {
            Write-Host "  Fetching channel type $gachaType..."
        }
        $reachedKnown = $false
        $endId = '0'
        while (-not $reachedKnown) {
            $params = $baseParams.Clone()
            $params['real_gacha_type'] = $gachaType
            $params['size'] = "$PageSize"
            $params['end_id'] = $endId
            $url = Build-Url -BaseUrl $apiBase -Params $params

            $resp = Invoke-GachaPage -Url $url -Pace $pace

            # A channel with no signals answers retcode 0 with an empty list -
            # verified against the live API, which does the same even for a
            # gacha type that doesn't exist. So a non-zero retcode here is a
            # real error, and letting it escape beats copying a payload that
            # silently omits this channel.
            if ($resp.retcode -ne 0) {
                throw "The signal history API returned retcode $($resp.retcode) ($($resp.message)). Your history link may have expired - reopen the Signal Search History screen in-game and run this script again."
            }
            if (-not $resp.data -or -not $resp.data.list -or $resp.data.list.Count -eq 0) { break }

            foreach ($entry in $resp.data.list) {
                if ($watermark -and (Compare-GachaId "$($entry.id)" $watermark) -le 0) {
                    $reachedKnown = $true
                    break
                }
                if (-not $uid) { $uid = $entry.uid }
                $bannerType = if ($entry.real_gacha_type) { $entry.real_gacha_type } else { $entry.gacha_type }
                # ZZZ's API reports rarity as rank_type 2/3/4 (B/A/S rank) instead
                # of Genshin/HSR's 3/4/5-star scale. Remap onto the same 3/4/5
                # scale GachaGremlin uses everywhere else, so "5" always means
                # "top rarity" regardless of game.
                $rank = switch ("$($entry.rank_type)") {
                    '2' { '3' }
                    '3' { '4' }
                    '4' { '5' }
                    default { "$($entry.rank_type)" }
                }
                $items.Add([PSCustomObject]@{
                    id         = "$($entry.id)"
                    bannerType = "$bannerType"
                    name       = "$($entry.name)"
                    itemType   = "$($entry.item_type)"
                    rank       = $rank
                    time       = "$($entry.time)"
                })
            }

            # Page on until the API answers with an empty list. The obvious
            # "a short page means the last page" test is WRONG here, and this is
            # the script it actually broke: this host ignores $PageSize outright
            # and always returns 5 entries (measured - even size=1 returns 5).
            # The old test asked for 20, got 5, concluded "last page" and
            # stopped - importing 5 signals per channel, 20 in total, for an
            # account whose Exclusive channel alone held 30+. Silent, and live.
            #
            # Terminating on an empty list instead costs one extra request per
            # channel and cannot truncate, whatever page size the server decides
            # to use today or after the next patch.
            if ($reachedKnown) { break }
            $endId = $resp.data.list[$resp.data.list.Count - 1].id
            Start-Sleep -Milliseconds $pace.DelayMs
        }
    }

    if ($items.Count -eq 0 -and -not $incremental) {
        Write-Host 'No signals were found on any channel.' -ForegroundColor Red
        Write-Host 'Make sure you have made at least one signal search, then try again.' -ForegroundColor Red
        return
    }

    # @() matters: Sort-Object yields $null for zero items and a bare scalar
    # for one, either of which serializes as not-an-array and the import box
    # rejects it. One new pull is the NORMAL incremental outcome.
    $sortedItems = @($items | Sort-Object -Property @{ Expression = { $_.id.Length } }, @{ Expression = { $_.id } })

    $epoch = [DateTime]::new(1970, 1, 1, 0, 0, 0, [DateTimeKind]::Utc)
    $exportedAt = [int64](((Get-Date).ToUniversalTime()) - $epoch).TotalSeconds

    $payload = [PSCustomObject]@{
        game        = 'zzz'
        uid         = "$uid"
        region      = "$region"
        exportedAt  = $exportedAt
        # Tells the import box that empty items means "already up to date",
        # not a broken download.
        incremental = $incremental
        items       = $sortedItems
    }

    $json = $payload | ConvertTo-Json -Compress -Depth 6

    # Set-Content -Encoding UTF8 always writes a byte-order mark on Windows
    # PowerShell 5.1, which breaks JSON.parse in the browser - write via
    # .NET directly with a BOM-less UTF8Encoding instead. Kept as a backup
    # file in case clipboard paste doesn't work in your setup; the primary
    # flow below copies the JSON itself, verified reliable through
    # Set-Clipboard even for multi-megabyte histories.
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $outputFile = Join-Path $env:TEMP 'gachagremlin-zzz-signals.json'
    [System.IO.File]::WriteAllText($outputFile, $json, $utf8NoBom)
    Set-Clipboard -Value $json

    Write-Host ''
    if ($incremental -and $items.Count -eq 0) {
        Write-Host "Done! No new signals since your last import - UID $uid is already up to date." -ForegroundColor Green
    } elseif ($incremental) {
        Write-Host "Done! Downloaded $($items.Count) new signal$(if ($items.Count -ne 1) { 's' }) for UID $uid (everything older was already imported)." -ForegroundColor Green
    } else {
        Write-Host "Done! Imported $($items.Count) signals for UID $uid." -ForegroundColor Green
    }
    Write-Host 'Copied to your clipboard - paste it (Ctrl+V) into the GachaGremlin import box and click Import.' -ForegroundColor Yellow
    Write-Host "(A backup copy was also saved to $outputFile in case clipboard paste doesn't work - use the import box's `"Choose File`" button for that instead.)"
} catch {
    Write-Host ''
    Write-Host "Something went wrong: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'If this keeps happening, please open an issue on the GachaGremlin GitHub repo.' -ForegroundColor Red
}
