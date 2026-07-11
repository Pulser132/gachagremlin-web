<#
  GachaGremlin Wish Importer - Genshin Impact

  What this script does, top to bottom:
    1. Reads Genshin Impact's own log file (under your Windows user profile)
       to find where the game is installed.
    2. Reads a small cache file the game itself already wrote to disk, and
       pulls out the "Wish History" web link the game generated the last
       time you opened that screen in-game.
    3. Calls HoYoverse's own wish-history API with that link to download
       your full wish history, page by page.
    4. Copies the result (plain JSON, no game credentials) to your
       clipboard so you can paste it into GachaGremlin's import box.

  It never sends anything to any server other than HoYoverse's own API
  (hoyoverse.com). Nothing is uploaded to GachaGremlin, gist.github.com, or
  anywhere else. Feel free to read every line before you run it.

  Usage:
    iwr -useb https://pulser132.github.io/gachagremlin-web/import/genshin.ps1 | iex

  If the script can't find your install folder automatically, run it with
  an explicit path instead:
    iex "& { $(irm https://pulser132.github.io/gachagremlin-web/import/genshin.ps1) } 'D:\Games\Genshin Impact\Genshin Impact game\GenshinImpact_Data'"
#>
param(
    [Parameter(Position = 0)]
    [string]$GamePath
)

[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Web

$GachaTypes = @('100', '200', '301', '302', '500')
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

try {
    Write-Host 'GachaGremlin Wish Importer - Genshin Impact'
    Write-Host 'Looking for your Wish History link...'

    if (-not $GamePath) {
        $logPath = "$env:USERPROFILE\AppData\LocalLow\miHoYo\Genshin Impact\output_log.txt"
        if (-not (Test-Path -LiteralPath $logPath)) {
            Write-Host "Could not find Genshin Impact's log file at:" -ForegroundColor Red
            Write-Host "  $logPath" -ForegroundColor Red
            Write-Host 'Make sure you have run the game at least once on this PC, then try again.' -ForegroundColor Red
            return
        }

        $logText = Get-Content -LiteralPath $logPath -Raw
        $pathMatch = [regex]::Match($logText, '(?<path>[A-Za-z]:\\.*?(GenshinImpact_Data|YuanShen_Data))\\')
        if (-not $pathMatch.Success) {
            Write-Host 'Could not figure out your Genshin Impact install folder from the log file.' -ForegroundColor Red
            Write-Host 'Try running the script again with your install path, e.g.:' -ForegroundColor Red
            Write-Host "  iex `"& { `$(irm <script-url>) } 'D:\Games\Genshin Impact\Genshin Impact game\GenshinImpact_Data'`"" -ForegroundColor Red
            return
        }
        $GamePath = $pathMatch.Groups['path'].Value
    }

    if (-not (Test-Path -LiteralPath $GamePath)) {
        Write-Host "The game folder '$GamePath' does not exist." -ForegroundColor Red
        return
    }

    $cacheRoot = Join-Path $GamePath 'webCaches'
    if (-not (Test-Path -LiteralPath $cacheRoot)) {
        Write-Host 'No web cache folder found yet.' -ForegroundColor Red
        Write-Host 'Open the Wish History screen in-game (from any banner, tap History), then run this script again.' -ForegroundColor Red
        return
    }

    $versionFolders = Get-ChildItem -LiteralPath $cacheRoot -Directory | Where-Object { $_.Name -match '^\d+(\.\d+)*$' }
    if (-not $versionFolders) {
        Write-Host 'No cached web data found yet.' -ForegroundColor Red
        Write-Host 'Open the Wish History screen in-game, then run this script again.' -ForegroundColor Red
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
        Write-Host 'Open the Wish History screen in-game, then run this script again.' -ForegroundColor Red
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
                $candidates.Add([PSCustomObject]@{ Url = $url; Timestamp = $timestamp })
            }
        }
    }

    if ($candidates.Count -eq 0) {
        Write-Host 'No Wish History link found in the cache.' -ForegroundColor Red
        Write-Host 'Open the Wish History screen in-game (from any banner, tap History), then run this script again.' -ForegroundColor Red
        return
    }

    $authUrl = $null
    foreach ($candidate in ($candidates | Sort-Object -Property Timestamp -Descending)) {
        try {
            $probe = Invoke-RestMethod -Uri $candidate.Url -UseBasicParsing -ContentType 'application/json'
            if ($probe.retcode -eq 0) {
                $authUrl = $candidate.Url
                break
            }
        } catch {
            continue
        }
    }

    if (-not $authUrl) {
        Write-Host 'Your Wish History link has expired.' -ForegroundColor Red
        Write-Host 'Reopen the Wish History screen in-game to refresh it, then run this script again.' -ForegroundColor Red
        return
    }

    Write-Host 'Found a valid Wish History link. Downloading your wish history...'

    $baseUri = [System.Uri]$authUrl
    $apiBase = $baseUri.GetLeftPart([System.UriPartial]::Path)
    $origQuery = [System.Web.HttpUtility]::ParseQueryString($baseUri.Query)
    $baseParams = @{}
    foreach ($key in $origQuery.AllKeys) {
        if ($key) { $baseParams[$key] = $origQuery[$key] }
    }
    $region = if ($baseParams.ContainsKey('region')) { $baseParams['region'] } elseif ($baseParams.ContainsKey('game_biz')) { $baseParams['game_biz'] } else { '' }

    $items = New-Object System.Collections.Generic.List[object]
    $uid = $null

    foreach ($gachaType in $GachaTypes) {
        Write-Host "  Fetching banner type $gachaType..."
        $endId = '0'
        while ($true) {
            $params = $baseParams.Clone()
            $params['gacha_type'] = $gachaType
            $params['size'] = "$PageSize"
            $params['end_id'] = $endId
            $url = Build-Url -BaseUrl $apiBase -Params $params

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
                if (-not $uid) { $uid = $entry.uid }
                $items.Add([PSCustomObject]@{
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

    if ($items.Count -eq 0) {
        Write-Host 'No wishes were found on any banner.' -ForegroundColor Red
        Write-Host 'Make sure you have made at least one wish, then try again.' -ForegroundColor Red
        return
    }

    $sortedItems = $items | Sort-Object -Property @{ Expression = { $_.id.Length } }, @{ Expression = { $_.id } }

    $epoch = [DateTime]::new(1970, 1, 1, 0, 0, 0, [DateTimeKind]::Utc)
    $exportedAt = [int64](((Get-Date).ToUniversalTime()) - $epoch).TotalSeconds

    $payload = [PSCustomObject]@{
        game       = 'genshin'
        uid        = "$uid"
        region     = "$region"
        exportedAt = $exportedAt
        items      = $sortedItems
    }

    $json = $payload | ConvertTo-Json -Compress -Depth 6

    # A large history can be hundreds of KB of JSON - too much to reliably
    # paste through the clipboard. Save it to a file instead and copy that
    # file's path, which the GachaGremlin import box's "Choose File" picker
    # can jump straight to.
    $outputFile = Join-Path $env:TEMP 'gachagremlin-genshin-wishes.json'
    # Set-Content -Encoding UTF8 always writes a byte-order mark on Windows
    # PowerShell 5.1, which breaks JSON.parse in the browser - write via
    # .NET directly with a BOM-less UTF8Encoding instead.
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($outputFile, $json, $utf8NoBom)
    Set-Clipboard -Value $outputFile

    Write-Host ''
    Write-Host "Done! Imported $($items.Count) wishes for UID $uid." -ForegroundColor Green
    Write-Host "Saved to: $outputFile" -ForegroundColor Yellow
    Write-Host 'That file path has been copied to your clipboard.'
    Write-Host 'On the GachaGremlin import box, click "Choose File", paste the path into the'
    Write-Host 'filename field, press Enter, then click Import.'
    Write-Host '(That file has your wish history in plain text - feel free to delete it once imported.)'
} catch {
    Write-Host ''
    Write-Host "Something went wrong: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'If this keeps happening, please open an issue on the GachaGremlin GitHub repo.' -ForegroundColor Red
}
