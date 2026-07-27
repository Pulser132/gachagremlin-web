<#
  Regression suite for the retry/AIMD pacing logic in public/import/*.ps1.

  Runs the REAL Invoke-GachaPage from each shipped script against a stubbed API:
  the function and its constants are lifted out of the script file via the
  PowerShell AST, so the suite always tests what ships, never a copy that can
  drift. Invoke-RestMethod and Start-Sleep are shadowed by local functions, so
  no request leaves the machine and no scenario waits real time.

  Manual runner — deliberately NOT part of `npm test` or CI (vitest only picks
  up tests/*.test.ts; a .ps1 here is inert to it). Run it whenever a script's
  retry/pacing code changes:

    powershell -File tests/ps/import-pacing.tests.ps1              # all three
    powershell -File tests/ps/import-pacing.tests.ps1 -Script zzz  # one script

  Exit code 0 = every scenario passed for every script run.

  Why this exists: the first cut of the two-budget retry logic shared one
  counter between throttle and network failures, so a long throttle wait
  consumed the network budget and the next blip threw instantly. Scenario 6
  caught it the day it was written. The AIMD scenarios (7-10) pin the pace's
  down-ramp, which a rewrite of the page loop is most likely to lose.
#>
param(
    [ValidateSet('zzz', 'hsr', 'genshin', 'all')]
    [string]$Script = 'all'
)

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

function Test-OneScript {
    param([string]$Name)

    $scriptPath = Join-Path $repoRoot "public\import\$Name.ps1"
    $src = Get-Content -LiteralPath $scriptPath -Raw
    Write-Host "=== $Name.ps1 ===" -ForegroundColor Cyan

    $errs = $null; $toks = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseInput($src, [ref]$toks, [ref]$errs)
    if ($errs.Count) { Write-Host "  PARSE ERRORS - aborting this script" -ForegroundColor Red; return 1 }
    foreach ($fname in @('Invoke-GachaPage', 'Compare-GachaId', 'Convert-SinceArg')) {
        $fn = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $fname }, $true)
        if (-not $fn) { Write-Host "  $fname not found - aborting this script" -ForegroundColor Red; return 1 }
        Invoke-Expression $fn.Extent.Text
    }

    # Mirror the script's constants by evaluating its own assignment lines.
    foreach ($cname in @('PageDelayMs', 'MinPageDelayMs', 'MaxPageDelayMs', 'PaceEaseAfterOk', 'PaceEaseFactor', 'MaxAttempts', 'RetryBackoffMs', 'ThrottleMaxAttempts', 'ThrottleBackoffMs')) {
        $m = [regex]::Match($src, "(?m)^\`$$cname = (.+)$")
        if (-not $m.Success) { Write-Host "  missing constant `$$cname - aborting this script" -ForegroundColor Red; return 1 }
        Set-Variable -Name $cname -Value (Invoke-Expression $m.Groups[1].Value)
    }

    # --- stubs: shadow the cmdlets inside this scope ---------------------------
    $script:slept = New-Object System.Collections.Generic.List[int]
    function Start-Sleep { param([int]$Milliseconds, [int]$Seconds) $script:slept.Add($Milliseconds) }

    $script:calls = 0
    $script:plan = @()
    # Each plan step is a retcode string, or 'throw' for a network failure. The
    # last step repeats forever.
    function Invoke-RestMethod {
        param($Uri, [switch]$UseBasicParsing, $ContentType)
        $step = $script:plan[[Math]::Min($script:calls, $script:plan.Count - 1)]
        $script:calls++
        if ($step -eq 'throw') { throw 'The remote name could not be resolved' }
        return [PSCustomObject]@{ retcode = [int]$step; data = $null }
    }

    function Reset-Stub { param([string[]]$Plan) $script:calls = 0; $script:plan = $Plan; $script:slept.Clear() }

    $failures = 0
    function Check { param([string]$Name, [bool]$Ok, [string]$Detail)
        if ($Ok) { Write-Host "  PASS  $Name" -ForegroundColor Green }
        else { Write-Host "  FAIL  $Name -- $Detail" -ForegroundColor Red; $script:failures++ }
    }
    $script:failures = 0

    # --- scenarios --------------------------------------------------------------
    Write-Host "`n1. Throttle then success: pace must rise and persist"
    Reset-Stub -Plan @('-110', '0')
    $pace = @{ DelayMs = $PageDelayMs; OkStreak = 0 }
    $r = Invoke-GachaPage -Url 'http://x' -Pace $pace 6>$null
    Check '  returns the successful response' ($r.retcode -eq 0) "retcode=$($r.retcode)"
    Check "  pace doubled $PageDelayMs -> $($PageDelayMs * 2) and persists in the caller" ($pace.DelayMs -eq ($PageDelayMs * 2)) "DelayMs=$($pace.DelayMs)"

    Write-Host "`n2. Sustained throttling: pace ramps but is capped at MaxPageDelayMs"
    Reset-Stub -Plan @('-110', '-110', '-110', '-110', '-110', '-110', '0')
    $pace = @{ DelayMs = $PageDelayMs; OkStreak = 0 }
    $r = Invoke-GachaPage -Url 'http://x' -Pace $pace 6>$null
    Check '  eventually succeeds' ($r.retcode -eq 0) "retcode=$($r.retcode)"
    Check "  pace capped at $MaxPageDelayMs" ($pace.DelayMs -eq $MaxPageDelayMs) "DelayMs=$($pace.DelayMs)"

    Write-Host "`n3. Endless throttling: throws, flagged as a rate limit (not a dead link)"
    Reset-Stub -Plan @('-110')
    $pace = @{ DelayMs = $PageDelayMs; OkStreak = 0 }
    $threw = $false; $msg = ''
    try { Invoke-GachaPage -Url 'http://x' -Pace $pace 6>$null } catch { $threw = $true; $msg = $_.Exception.Message }
    Check '  throws rather than returning nothing' $threw ''
    Check '  message names the rate limit' ($msg -match 'rate limit') $msg
    Check '  sets GaveUpThrottled so the probe loop can rethrow' ($pace.GaveUpThrottled -eq $true) "GaveUpThrottled=$($pace.GaveUpThrottled)"
    Check "  used the full throttle budget ($ThrottleMaxAttempts tries)" ($script:calls -eq $ThrottleMaxAttempts) "calls=$($script:calls)"
    $total = ($script:slept | Measure-Object -Sum).Sum
    Check '  waited a meaningful total (>30s) before giving up' ($total -gt 30000) "sleptTotal=${total}ms"

    Write-Host "`n4. Non-retryable retcode (-101 expired authkey): returned at once, no retry"
    Reset-Stub -Plan @('-101')
    $pace = @{ DelayMs = $PageDelayMs; OkStreak = 0 }
    $r = Invoke-GachaPage -Url 'http://x' -Pace $pace 6>$null
    Check '  returns -101 straight to the caller' ($r.retcode -eq -101) "retcode=$($r.retcode)"
    Check '  made exactly one request' ($script:calls -eq 1) "calls=$($script:calls)"
    Check '  did not touch the pace' ($pace.DelayMs -eq $PageDelayMs) "DelayMs=$($pace.DelayMs)"

    Write-Host "`n5. Network errors: own budget, gives up after MaxAttempts"
    Reset-Stub -Plan @('throw')
    $pace = @{ DelayMs = $PageDelayMs; OkStreak = 0 }
    $threw = $false
    try { Invoke-GachaPage -Url 'http://x' -Pace $pace 6>$null } catch { $threw = $true }
    Check '  throws' $threw ''
    Check "  after exactly $MaxAttempts attempts" ($script:calls -eq $MaxAttempts) "calls=$($script:calls)"
    Check '  not flagged as throttled' (-not $pace.GaveUpThrottled) "GaveUpThrottled=$($pace.GaveUpThrottled)"

    Write-Host "`n6. THE REGRESSION: throttles must not consume the network budget"
    # 5 throttles then a network blip. With one shared counter the blip would
    # throw immediately; with separate budgets it gets its own retries.
    Reset-Stub -Plan @('-110', '-110', '-110', '-110', '-110', 'throw', '0')
    $pace = @{ DelayMs = $PageDelayMs; OkStreak = 0 }
    $r = $null; $msg = ''
    try { $r = Invoke-GachaPage -Url 'http://x' -Pace $pace 6>$null } catch { $msg = $_.Exception.Message }
    Check '  recovers instead of throwing' ($null -ne $r -and $r.retcode -eq 0) "err=$msg"

    Write-Host "`n7. AIMD decrease: pace eases back down after sustained success"
    Reset-Stub -Plan @('-110', '0')
    $pace = @{ DelayMs = $PageDelayMs; OkStreak = 0 }
    $null = Invoke-GachaPage -Url 'http://x' -Pace $pace 6>$null
    $lifted = $pace.DelayMs
    Reset-Stub -Plan @('0')
    for ($i = 0; $i -lt $PaceEaseAfterOk; $i++) { $null = Invoke-GachaPage -Url 'http://x' -Pace $pace 6>$null }
    Check "  eased below the throttled pace ($lifted ms)" ($pace.DelayMs -lt $lifted) "DelayMs=$($pace.DelayMs)"
    Check '  eases only every Nth success, not every one' ($pace.DelayMs -ge $MinPageDelayMs) "DelayMs=$($pace.DelayMs)"

    Write-Host "`n8. Decrease is bounded by the floor and always makes progress"
    Reset-Stub -Plan @('0')
    $pace = @{ DelayMs = $MaxPageDelayMs; OkStreak = 0 }
    for ($i = 0; $i -lt ($PaceEaseAfterOk * 400); $i++) { $null = Invoke-GachaPage -Url 'http://x' -Pace $pace 6>$null }
    Check "  converges all the way to the floor ($MinPageDelayMs ms)" ($pace.DelayMs -eq $MinPageDelayMs) "DelayMs=$($pace.DelayMs)"
    Check '  never undershoots the floor' ($pace.DelayMs -ge $MinPageDelayMs) "DelayMs=$($pace.DelayMs)"

    Write-Host "`n9. Oscillation: recovers toward the floor between throttles"
    Reset-Stub -Plan @('-110', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0')
    $pace = @{ DelayMs = $PageDelayMs; OkStreak = 0 }
    $null = Invoke-GachaPage -Url 'http://x' -Pace $pace 6>$null
    $afterThrottle = $pace.DelayMs
    for ($i = 0; $i -lt 15; $i++) { $null = Invoke-GachaPage -Url 'http://x' -Pace $pace 6>$null }
    Check '  pace comes back down instead of ratcheting up' ($pace.DelayMs -lt $afterThrottle) "afterThrottle=$afterThrottle now=$($pace.DelayMs)"

    Write-Host "`n10. A throttle resets the success streak"
    Reset-Stub -Plan @('0', '0', '0', '0')
    $pace = @{ DelayMs = 1000; OkStreak = 0 }
    for ($i = 0; $i -lt ($PaceEaseAfterOk - 1); $i++) { $null = Invoke-GachaPage -Url 'http://x' -Pace $pace 6>$null }
    Reset-Stub -Plan @('-110', '0')
    $null = Invoke-GachaPage -Url 'http://x' -Pace $pace 6>$null
    Check '  streak cleared by the throttle (no ease on the next success)' ($pace.OkStreak -le 1) "OkStreak=$($pace.OkStreak)"

    Write-Host "`n11. Compare-GachaId matches compareIds (store.ts) semantics"
    Check '  longer id wins regardless of lexicographic value' ((Compare-GachaId '999999999' '1000000000000000000') -lt 0) ''
    Check '  equal lengths compare ordinally' ((Compare-GachaId '1675234280000000100' '1675234280000000099') -gt 0) ''
    Check '  equal ids compare equal' ((Compare-GachaId '170' '170') -eq 0) ''
    # The watermark stop uses <= 0: the watermark id itself must stop the page
    # walk (it is already stored), not get re-added.
    Check '  the watermark id itself reads as "already stored"' ((Compare-GachaId '170' '170') -le 0) ''

    Write-Host "`n12. Convert-SinceArg parses the dialog wire format, dropping malformed pairs"
    $map = Convert-SinceArg '1:1700000000000000001,2:1700000000000000002'
    Check '  parses both pairs' ($map.Count -eq 2 -and $map['1'] -eq '1700000000000000001' -and $map['2'] -eq '1700000000000000002') "count=$($map.Count)"
    $map = Convert-SinceArg ''
    Check '  empty arg yields an empty map (full download)' ($map.Count -eq 0) "count=$($map.Count)"
    # A mangled watermark must degrade to "download that channel in full",
    # never to a wrong stop.
    $map = Convert-SinceArg '1:abc,2:1700000000000000002,junk,3:'
    Check '  malformed pairs dropped, valid ones kept' ($map.Count -eq 1 -and $map['2'] -eq '1700000000000000002') "count=$($map.Count)"

    Write-Host ""
    if ($script:failures) { Write-Host "$($script:failures) CHECK(S) FAILED for $Name" -ForegroundColor Red; return 1 }
    Write-Host "ALL CHECKS PASSED for $Name" -ForegroundColor Green
    return 0
}

$targets = if ($Script -eq 'all') { @('zzz', 'hsr', 'genshin') } else { @($Script) }
$failed = 0
foreach ($t in $targets) { $failed += Test-OneScript -Name $t }
Write-Host ""
if ($failed) { Write-Host "$failed SCRIPT(S) FAILED" -ForegroundColor Red; exit 1 }
Write-Host "All $($targets.Count) script(s) passed all scenarios" -ForegroundColor Green
exit 0
