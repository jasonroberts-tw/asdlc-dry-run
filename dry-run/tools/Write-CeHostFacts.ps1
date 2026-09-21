#Requires -Version 7.0
<#
.SYNOPSIS
Writes the run's environment facts, <run directory>/host-facts.json, and validates what it wrote.

.DESCRIPTION
The run's environment facts (workflow-policy.json `hostFacts`; schema host-facts.schema.json). The launcher
runs this right after Initialize-CeRunWorkspace.ps1, Phase 0 verifies the file with Test-CeHostFacts.ps1 and reruns this
tool when it is missing or invalid, every worker reads the file by path before acting, and the orchestrator passes the
PATH in each dispatch instead of restating the facts in prose. Re-runnable: it overwrites the file. It records, and
never a secret value:

  host              total memory (the GC's container-aware reading, the same one Initialize-CeValidation.ps1 records),
                    the processor count, and sequentialChainsRequired -- total memory below policy
                    validation.sequentialChainsBelowTotalMemoryGb, so build, test and browser chains run one at a time;
  playwright        PLAYWRIGHT_HOST_PLATFORM_OVERRIDE as this process carries it (the launcher applies it first) and
                    whether the Ubuntu release needs it (policy hostPrerequisites.playwrightBrowser);
  liveGate          the owned-mode start cap Invoke-CeLiveStackGate.ps1 -StartupTimeoutSeconds defaults to, the statement
                    that -ServerUrl is the validator's test seam and never a run procedure, and when seedPreflight
                    not-declared is accepted (policy hostFacts.liveGate, copied so a worker reads one file);
  kerberos          whether a ticket is present (klist -s), the ticket-granting ticket's expiry and its realm parsed from
                    klist's listing -- never the principal; Windows reports not applicable;
  testIds           the story-scoped Assert-CeTestIds.ps1 invocation (-TestProject the shared Playwright project,
                    -TestFiles the story's files under it) and why the project-wide run is not the gate;
  hostPrerequisites the preflight's status, report path and failed codes, from -HostPrerequisitesReportPath;
  environmentNames  the identity and tenant names as present or absent.

Output is one JSON object: { status written, path, validation { status, errors[] }, sequentialChainsRequired,
playwrightHostPlatformOverride, kerberosTicketPresent }. Throws HOST_FACTS_INVALID when the validator refuses what was
written (the file is left in place for inspection).

.PARAMETER Story
The User Story id.

.PARAMETER TargetRoot
The target repository checkout; the run directory defaults beneath it.

.PARAMETER RunDirectory
The transient run directory. Default: the CE_RUN_DIRECTORY environment variable when set, otherwise
<TargetRoot>/.dry-run/run/<Story>. Created when missing.

.PARAMETER PluginRoot
The dry-run/ directory. Default: derived from this tool's location.

.PARAMETER HostPrerequisitesReportPath
Test-CeHostPrerequisites.ps1's JSON report as the launcher wrote it into the run directory. Optional.

.PARAMETER HostPrerequisitesStatus
The status to record when no report is given: skipped (the launcher ran with -SkipHostPreflight) or not-run (default).

.PARAMETER KlistPath, OsReleasePath, PolicyPath, SchemaPath, ValidatorPath
Seams: the klist executable (name or path), the os-release file, and the policy, schema and validator to use.
Defaults: klist on PATH, /etc/os-release, and the contract skill's own files.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateRange(1, [int]::MaxValue)][int]$Story,
    [Parameter(Mandatory = $true)][string]$TargetRoot,
    [string]$RunDirectory,
    [string]$PluginRoot,
    [string]$HostPrerequisitesReportPath,
    [ValidateSet("skipped", "not-run")][string]$HostPrerequisitesStatus = "not-run",
    [string]$KlistPath = "klist",
    [string]$OsReleasePath = "/etc/os-release",
    [string]$PolicyPath,
    [string]$SchemaPath,
    [string]$ValidatorPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-PropertyValue($Object, [string]$Name) {
    if ($null -eq $Object) { return $null }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function Get-PolicyValue {
    param([AllowNull()]$Object, [Parameter(Mandatory = $true)][string[]]$PathSegments, [AllowNull()]$Default = $null)

    $current = $Object
    foreach ($segment in $PathSegments) {
        if ($null -eq $current -or -not ($current -is [System.Management.Automation.PSObject])) { return $Default }
        $property = $current.PSObject.Properties[$segment]
        if ($null -eq $property) { return $Default }
        $current = $property.Value
    }
    if ($null -eq $current) { return $Default }
    return $current
}

function Invoke-CapturedCommand {
    # Runs one native command with a timeout and returns exit code and stdout; stderr is discarded. Waits for exit, not
    # for the pipes to close, so a grandchild holding them cannot hang the writer.
    param([Parameter(Mandatory = $true)][string]$FilePath, [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$ArgumentList, [int]$TimeoutSeconds = 15)

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $FilePath
    foreach ($argument in $ArgumentList) { $startInfo.ArgumentList.Add($argument) }
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $process = [System.Diagnostics.Process]::Start($startInfo)
    $process.StandardInput.Close()
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
        try { $process.Kill($true) } catch { }
        return [pscustomobject]@{ ExitCode = $null; TimedOut = $true; Output = "" }
    }
    $null = [System.Threading.Tasks.Task]::WaitAll([System.Threading.Tasks.Task[]]@($stdoutTask, $stderrTask), 2000)
    $output = if ($stdoutTask.IsCompletedSuccessfully) { $stdoutTask.Result } else { "" }
    return [pscustomobject]@{ ExitCode = $process.ExitCode; TimedOut = $false; Output = $output }
}

function Resolve-Tool([string]$NameOrPath) {
    if ([string]::IsNullOrWhiteSpace($NameOrPath)) { return $null }
    if (Test-Path -LiteralPath $NameOrPath -PathType Leaf) { return (Resolve-Path -LiteralPath $NameOrPath).Path }
    $command = Get-Command $NameOrPath -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -ne $command) { return $command.Source }
    return $null
}

# --- roots, policy, schema -----------------------------------------------------------------------------------------------

$resolvedPluginRoot = if ([string]::IsNullOrWhiteSpace($PluginRoot)) { [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..")) } else { [IO.Path]::GetFullPath($PluginRoot) }
$contractRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$resolvedPolicyPath = if ([string]::IsNullOrWhiteSpace($PolicyPath)) { Join-Path $contractRoot "workflow-policy.json" } else { [IO.Path]::GetFullPath($PolicyPath) }
$resolvedSchemaPath = if ([string]::IsNullOrWhiteSpace($SchemaPath)) { Join-Path $contractRoot "host-facts.schema.json" } else { [IO.Path]::GetFullPath($SchemaPath) }
$resolvedValidatorPath = if ([string]::IsNullOrWhiteSpace($ValidatorPath)) { Join-Path $PSScriptRoot "Test-CeHostFacts.ps1" } else { [IO.Path]::GetFullPath($ValidatorPath) }
if (-not (Test-Path -LiteralPath $resolvedPolicyPath -PathType Leaf)) { throw "HOST_FACTS_POLICY_MISSING: workflow-policy.json was not found at '$resolvedPolicyPath'." }
if (-not (Test-Path -LiteralPath $resolvedValidatorPath -PathType Leaf)) { throw "HOST_FACTS_VALIDATOR_MISSING: Test-CeHostFacts.ps1 was not found at '$resolvedValidatorPath'." }
$policy = Get-Content -LiteralPath $resolvedPolicyPath -Raw | ConvertFrom-Json
$hostFactsPolicy = Get-PolicyValue -Object $policy -PathSegments @("hostFacts")

if (-not (Test-Path -LiteralPath $TargetRoot -PathType Container)) { throw "HOST_FACTS_TARGET_MISSING: the target root '$TargetRoot' is not a directory." }
$resolvedTargetRoot = (Resolve-Path -LiteralPath $TargetRoot).Path
$storyText = $Story.ToString([Globalization.CultureInfo]::InvariantCulture)
$runDirectoryVariable = [string](Get-PolicyValue -Object $hostFactsPolicy -PathSegments @("runDirectoryEnvironmentVariable") -Default "CE_RUN_DIRECTORY")
$resolvedRunDirectory = if (-not [string]::IsNullOrWhiteSpace($RunDirectory)) {
    [IO.Path]::GetFullPath($RunDirectory)
} elseif (-not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($runDirectoryVariable))) {
    [IO.Path]::GetFullPath([Environment]::GetEnvironmentVariable($runDirectoryVariable))
} else {
    [IO.Path]::GetFullPath((Join-Path $resolvedTargetRoot ".dry-run/run/$storyText"))
}
New-Item -ItemType Directory -Path $resolvedRunDirectory -Force | Out-Null
$factsFileName = [string](Get-PolicyValue -Object $hostFactsPolicy -PathSegments @("file") -Default "host-facts.json")
$factsPath = Join-Path $resolvedRunDirectory $factsFileName

# --- host prerequisites, as the launcher saw them ----------------------------------------------------------------------------

$prerequisitesStatus = $HostPrerequisitesStatus
$prerequisitesReportPath = $null
$prerequisitesFailed = @()
if (-not [string]::IsNullOrWhiteSpace($HostPrerequisitesReportPath)) {
    if (-not (Test-Path -LiteralPath $HostPrerequisitesReportPath -PathType Leaf)) {
        throw "HOST_FACTS_PREREQUISITES_REPORT_MISSING: '$HostPrerequisitesReportPath' does not exist."
    }
    $prerequisitesReportPath = (Resolve-Path -LiteralPath $HostPrerequisitesReportPath).Path
    $report = Get-Content -LiteralPath $prerequisitesReportPath -Raw | ConvertFrom-Json
    $reportStatus = [string](Get-PropertyValue $report "status")
    $prerequisitesStatus = if ($reportStatus -in @("ready", "incomplete", "skipped")) { $reportStatus } else { "not-run" }
    $prerequisitesFailed = @(Get-PropertyValue $report "failed" | Where-Object { $null -ne $_ } | ForEach-Object { [string]$_ })
}

# --- host sizing (the same reading Initialize-CeValidation.ps1 records) --------------------------------------------------------

$platform = if ($IsWindows) { "windows" } elseif ($IsMacOS) { "macos" } else { "linux" }
$threshold = [double](Get-PolicyValue -Object $policy -PathSegments @("validation", "sequentialChainsBelowTotalMemoryGb") -Default 32)
$memory = [System.GC]::GetGCMemoryInfo()
$totalMemoryGb = [math]::Round(([double]$memory.TotalAvailableMemoryBytes) / 1GB, 1)
$osRelease = $null
$osId = $null
$osVersion = $null
if ($platform -eq "linux" -and (Test-Path -LiteralPath $OsReleasePath -PathType Leaf)) {
    foreach ($line in Get-Content -LiteralPath $OsReleasePath) {
        if ($line -match '^ID=(.*)$') { $osId = $Matches[1].Trim().Trim('"') }
        elseif ($line -match '^VERSION_ID=(.*)$') { $osVersion = $Matches[1].Trim().Trim('"') }
    }
    if ($osId) { $osRelease = "$osId $osVersion".Trim() }
}

# --- Playwright platform override -------------------------------------------------------------------------------------------

$overrideVariable = [string](Get-PolicyValue -Object $policy -PathSegments @("hostPrerequisites", "playwrightBrowser", "overrideEnvironmentVariable") -Default "PLAYWRIGHT_HOST_PLATFORM_OVERRIDE")
$supportedUbuntu = @(Get-PolicyValue -Object $policy -PathSegments @("hostPrerequisites", "playwrightBrowser", "supportedUbuntuVersions") -Default @("20.04", "22.04", "24.04", "26.04") | ForEach-Object { [string]$_ })
$overrideValue = [Environment]::GetEnvironmentVariable($overrideVariable)
$overrideRequired = $null
if ($platform -eq "linux" -and $osId -eq "ubuntu" -and -not [string]::IsNullOrWhiteSpace($osVersion)) {
    $overrideRequired = -not ($supportedUbuntu -contains $osVersion)
} elseif ($platform -ne "linux") {
    $overrideRequired = $false
}

# --- Kerberos: presence, the ticket-granting ticket's expiry and realm; never the principal --------------------------------------

$kerberos = [ordered]@{
    applicable = ($platform -ne "windows")
    ticketPresent = $null
    ticketExpiresUtc = $null
    ticketExpiresRaw = $null
    realm = $null
    note = "Windows uses the logged-in user's token; klist is not consulted."
}
if ($platform -ne "windows") {
    $klist = Resolve-Tool -NameOrPath $KlistPath
    if ($null -eq $klist) {
        $kerberos.note = "klist was not found ('$KlistPath'); the local API server's tenant SQL connection needs a ticket (KERBEROS_TOOLS_MISSING in the preflight)."
    } else {
        $status = Invoke-CapturedCommand -FilePath $klist -ArgumentList @("-s")
        $kerberos.ticketPresent = (-not $status.TimedOut) -and ($status.ExitCode -eq 0)
        if ($kerberos.ticketPresent) {
            $listing = Invoke-CapturedCommand -FilePath $klist -ArgumentList @()
            $ticketLine = @($listing.Output -split "`r?`n" | Where-Object { $_ -match 'krbtgt/' } | Select-Object -First 1)
            if ($ticketLine.Count -eq 1 -and $ticketLine[0] -match 'krbtgt/(?<realm>[^@\s]+)@') {
                $kerberos.realm = $Matches.realm
                $before = $ticketLine[0].Substring(0, $ticketLine[0].IndexOf('krbtgt/')).Trim()
                $columns = @($before -split '\s{2,}' | Where-Object { $_.Trim().Length -gt 0 })
                if ($columns.Count -ge 2) {
                    $expiresText = $columns[$columns.Count - 1].Trim()
                    $kerberos.ticketExpiresRaw = $expiresText
                    $parsed = [DateTime]::MinValue
                    if ([DateTime]::TryParse($expiresText, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AssumeLocal, [ref]$parsed)) {
                        $kerberos.ticketExpiresUtc = $parsed.ToUniversalTime().ToString("O")
                    }
                }
            }
            $kerberos.note = "A valid ticket is present; a live gate or Invoke-CeTenantSql.ps1 run after the ticket-granting ticket expires fails 'Cannot generate SSPI context', which is a host gap for the operator (kinit in their own terminal), never something to fix inside the run."
        } else {
            $kerberos.note = "No valid ticket (klist -s); the local API server's tenant SQL connection (Integrated Security) needs one (KERBEROS_TICKET_MISSING in the preflight). The realm is the USER domain, not the resource domain."
        }
    }
}

# --- live gate and TestId facts, from policy so a worker reads one file ---------------------------------------------------------

$liveGatePolicy = Get-PolicyValue -Object $hostFactsPolicy -PathSegments @("liveGate")
$liveGate = [ordered]@{
    ownedModeStartupTimeoutSeconds = [int](Get-PolicyValue -Object $liveGatePolicy -PathSegments @("ownedModeStartupTimeoutSeconds") -Default 600)
    attachModeWhen = [string](Get-PolicyValue -Object $liveGatePolicy -PathSegments @("attachModeWhen") -Default "never during a supervised run; -ServerUrl is the validator's test seam")
    attachModeProcedure = [string](Get-PolicyValue -Object $liveGatePolicy -PathSegments @("attachModeProcedure") -Default "-ServerUrl is a test seam, not a run procedure; a result whose server.mode is attached carries LIVE_STACK_SERVER_ATTACHED in warnings[]")
    seedPreflightNotDeclaredAcceptedWhen = [string](Get-PolicyValue -Object $liveGatePolicy -PathSegments @("seedPreflightNotDeclaredAcceptedWhen") -Default "the plan declares no tenantPreflight read because the API server did not change")
}

$sharedTestProject = Join-Path $resolvedTargetRoot "tests/browser"
$testIdsPlanPath = Join-Path $resolvedTargetRoot ".dry-run/plans/<story-slug>-$storyText/plan.json"
$testIdsScopeParameter = [string](Get-PolicyValue -Object $hostFactsPolicy -PathSegments @("testIds", "scopeParameter") -Default "-TestFiles")
$testIdsTestFilesSource = [string](Get-PolicyValue -Object $hostFactsPolicy -PathSegments @("testIds", "testFilesSource") -Default "the builder's changedFiles under the shared Playwright project, repository-relative and comma-separated")
$testIds = [ordered]@{
    tool = "Assert-CeTestIds.ps1"
    scope = "story"
    planPath = $testIdsPlanPath
    sharedTestProject = if (Test-Path -LiteralPath $sharedTestProject -PathType Container) { $sharedTestProject } else { $null }
    invocation = "Assert-CeTestIds.ps1 -PlanPath $testIdsPlanPath -TargetRoot $resolvedTargetRoot -TestProject $sharedTestProject $testIdsScopeParameter <this story's Playwright files under that project: $testIdsTestFilesSource>"
    reason = [string](Get-PolicyValue -Object $hostFactsPolicy -PathSegments @("testIds", "reason") -Default "the shared Playwright project carries other stories' literals, so -TestProject names the shared project and -TestFiles names this story's files under it; the project-wide run is not the gate")
}

# --- environment names, present or absent ---------------------------------------------------------------------------------------

$identityNames = [ordered]@{}
$claimSources = Get-PolicyValue -Object $policy -PathSegments @("identity", "claimSources")
$identityList = if ($null -ne $claimSources) { @($claimSources.PSObject.Properties | ForEach-Object { [string]$_.Value }) } else { @("SERVICE_ACCOUNT_SUBJECT", "TENANT_ID") }
foreach ($name in $identityList) {
    $identityNames[$name] = if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) { "absent" } else { "present" }
}
$tenantNames = [ordered]@{}
foreach ($name in @(Get-PolicyValue -Object $policy -PathSegments @("validation", "devTenantEnvironmentVariables") -Default @("DEV_TENANT_SERVER", "DEV_TENANT_DATABASE") | ForEach-Object { [string]$_ })) {
    $tenantNames[$name] = if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) { "absent" } else { "present" }
}

# --- write, then validate what was written --------------------------------------------------------------------------------------

$facts = [ordered]@{
    schemaVersion = 1
    writtenUtc = [DateTimeOffset]::UtcNow.ToString("O")
    writer = "Write-CeHostFacts.ps1"
    story = $Story
    pluginRoot = $resolvedPluginRoot
    targetRoot = $resolvedTargetRoot
    runDirectory = $resolvedRunDirectory
    hostPrerequisites = [ordered]@{
        status = $prerequisitesStatus
        reportPath = $prerequisitesReportPath
        failed = @($prerequisitesFailed)
    }
    host = [ordered]@{
        platform = $platform
        osRelease = $osRelease
        totalMemoryGb = $totalMemoryGb
        processorCount = [Environment]::ProcessorCount
        sequentialChainsBelowTotalMemoryGb = $threshold
        sequentialChainsRequired = ($totalMemoryGb -lt $threshold)
    }
    playwright = [ordered]@{
        hostPlatformOverrideVariable = $overrideVariable
        hostPlatformOverride = if ([string]::IsNullOrWhiteSpace($overrideValue)) { $null } else { $overrideValue }
        overrideRequired = $overrideRequired
    }
    liveGate = $liveGate
    kerberos = $kerberos
    testIds = $testIds
    environmentNames = [ordered]@{
        identity = $identityNames
        tenant = $tenantNames
    }
    secretValuesReported = $false
}
[IO.File]::WriteAllText($factsPath, ($facts | ConvertTo-Json -Depth 8) + "`n", [Text.UTF8Encoding]::new($false))

# The validator is a script, so it sets no $LASTEXITCODE on a pass (it exits only on failure); its JSON status decides.
$validationOutput = @(& $resolvedValidatorPath -Path $factsPath -SchemaPath $resolvedSchemaPath -Story $Story -RunDirectory $resolvedRunDirectory -PolicyPath $resolvedPolicyPath 2>&1)
$validation = $null
try { $validation = (($validationOutput | ForEach-Object { [string]$_ }) -join [Environment]::NewLine) | ConvertFrom-Json } catch { $validation = $null }
if ($null -eq $validation -or $validation.status -ne "valid") {
    $reasons = if ($null -ne $validation) { @($validation.errors) -join "; " } else { ($validationOutput | ForEach-Object { [string]$_ }) -join " " }
    throw "HOST_FACTS_INVALID: Test-CeHostFacts.ps1 refused the written file '$factsPath': $reasons"
}

[ordered]@{
    status = "written"
    path = $factsPath
    validation = [ordered]@{ status = $validation.status; errors = @($validation.errors) }
    sequentialChainsRequired = $facts.host.sequentialChainsRequired
    playwrightHostPlatformOverride = $facts.playwright.hostPlatformOverride
    kerberosTicketPresent = $kerberos.ticketPresent
    hostPrerequisitesStatus = $prerequisitesStatus
    secretValuesReported = $false
} | ConvertTo-Json -Depth 4
