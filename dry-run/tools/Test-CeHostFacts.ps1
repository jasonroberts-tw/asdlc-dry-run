#Requires -Version 7.0
<#
.SYNOPSIS
Validates a run's host-facts.json against host-facts.schema.json and refuses one that carries a secret.

.DESCRIPTION
The read-side check of the run's environment facts (workflow-policy.json `hostFacts`). Write-CeHostFacts.ps1
runs it on what it just wrote, Phase 0 runs it before dispatching a worker, and a worker may run it on the path it was
handed. It checks:

  - the shape: Test-Json -SchemaFile against host-facts.schema.json (every required key present, no key outside the
    schema, schemaVersion 1, secretValuesReported false);
  - the placement: the file's own directory equals its `runDirectory`, so a copy lying elsewhere is not the run's file;
  - -Story, when given, equals `story`; -RunDirectory, when given, equals `runDirectory`;
  - no secret. The facts carry names and paths, never a value: a token-shaped string anywhere (a JWT, or a whole value of
    32+ token characters mixing lower case with upper case or digits -- an all-caps identifier is a name) is refused as
    HOST_FACTS_SECRET_SHAPE; a property named after one of the identity or tenant
    environment names (policy identity.claimSources, validation.devTenantEnvironmentVariables) carrying anything but
    `present`/`absent`/null/a boolean is refused as HOST_FACTS_SECRET_KEY; and the process value of each of those names,
    read here BY NAME and never printed, must not appear anywhere in the file text (HOST_FACTS_SECRET_VALUE names the
    variable). The message never carries the value.

Writes one JSON summary ({ status valid | invalid, path, schema, story, runDirectory, errors[] }) and exits 1 when
invalid.

.PARAMETER Path
The host-facts.json to validate.

.PARAMETER SchemaPath
host-facts.schema.json. Default: the contract skill's copy beside this tool's parent.

.PARAMETER Story
When given, must equal the file's `story`.

.PARAMETER RunDirectory
When given, must equal the file's `runDirectory` (paths compared normalized).

.PARAMETER PolicyPath
workflow-policy.json, for the environment names the secret scan reads. Default: the contract skill's copy.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Path,
    [string]$SchemaPath = (Join-Path $PSScriptRoot "../host-facts.schema.json"),
    [int]$Story,
    [string]$RunDirectory,
    [string]$PolicyPath = (Join-Path $PSScriptRoot "../workflow-policy.json")
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

function Get-NormalizedDirectory([string]$Directory) {
    return [IO.Path]::GetFullPath($Directory).TrimEnd([char]'/', [char]'\')
}

$errors = [System.Collections.Generic.List[string]]::new()
$facts = $null
$raw = $null

if (-not (Test-Path -LiteralPath $SchemaPath -PathType Leaf)) { $errors.Add("schema: host-facts.schema.json not found at $SchemaPath") }
if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { $errors.Add("facts: file not found at $Path") }

$policy = if (Test-Path -LiteralPath $PolicyPath -PathType Leaf) { Get-Content -LiteralPath $PolicyPath -Raw | ConvertFrom-Json } else { $null }
$claimSources = Get-PolicyValue -Object $policy -PathSegments @("identity", "claimSources")
$secretNames = [System.Collections.Generic.List[string]]::new()
if ($null -ne $claimSources) {
    foreach ($property in $claimSources.PSObject.Properties) { $secretNames.Add([string]$property.Value) }
}
if ($secretNames.Count -eq 0) {
    foreach ($name in @("SERVICE_ACCOUNT_SUBJECT", "TENANT_ID")) { $secretNames.Add($name) }
}
foreach ($name in @(Get-PolicyValue -Object $policy -PathSegments @("validation", "devTenantEnvironmentVariables") -Default @("DEV_TENANT_SERVER", "DEV_TENANT_DATABASE"))) {
    if (-not $secretNames.Contains([string]$name)) { $secretNames.Add([string]$name) }
}

if ($errors.Count -eq 0) {
    $raw = Get-Content -LiteralPath $Path -Raw
    try { $facts = $raw | ConvertFrom-Json -Depth 16 } catch { $errors.Add("facts: not valid JSON: $($_.Exception.Message)") }
}

if ($null -ne $facts) {
    $schemaErrors = @()
    $schemaValid = Test-Json -Json $raw -SchemaFile $SchemaPath -ErrorAction SilentlyContinue -ErrorVariable schemaErrors
    if (-not $schemaValid) {
        foreach ($schemaError in @($schemaErrors)) { $errors.Add("schema: $($schemaError.Exception.Message)") }
        if (@($schemaErrors).Count -eq 0) { $errors.Add("schema: host-facts.json does not satisfy host-facts.schema.json") }
    }

    $factsDirectory = Get-NormalizedDirectory (Split-Path -Parent ([IO.Path]::GetFullPath($Path)))
    $declaredRunDirectory = [string](Get-PropertyValue $facts "runDirectory")
    if (-not [string]::IsNullOrWhiteSpace($declaredRunDirectory) -and (Get-NormalizedDirectory $declaredRunDirectory) -ne $factsDirectory) {
        $errors.Add("placement: the file sits in '$factsDirectory' but declares runDirectory '$declaredRunDirectory'; host-facts.json lives in the run directory it describes.")
    }
    if ($PSBoundParameters.ContainsKey("Story") -and [int](Get-PropertyValue $facts "story") -ne $Story) {
        $errors.Add("story: the file is for story $(Get-PropertyValue $facts 'story'), not $Story.")
    }
    if (-not [string]::IsNullOrWhiteSpace($RunDirectory) -and (Get-NormalizedDirectory $RunDirectory) -ne (Get-NormalizedDirectory $declaredRunDirectory)) {
        $errors.Add("runDirectory: the file declares '$declaredRunDirectory', not '$RunDirectory'.")
    }

    # Secret scan, three ways. Values are never echoed: a finding names the path in the document or the variable name.
    $jwtShape = [regex]'eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}'
    # A whole value of 32+ token characters mixing a lower-case letter with an upper-case letter or a digit: a hash, a
    # key, a base64 blob. An all-caps identifier (PLAYWRIGHT_HOST_PLATFORM_OVERRIDE) is a name, not a token.
    $opaqueShape = [regex]'^(?=.*[a-z])(?=.*[A-Z0-9])[A-Za-z0-9+=_-]{32,}$'
    $allowedForSecretKey = @("present", "absent")
    $walk = {
        param($Node, [string]$Where)
        if ($null -eq $Node) { return }
        if ($Node -is [string]) {
            if ($jwtShape.IsMatch($Node)) { $errors.Add("HOST_FACTS_SECRET_SHAPE: ${Where} carries a token-shaped value (JWT); the facts carry names and paths, never a value.") }
            elseif ($opaqueShape.IsMatch($Node)) { $errors.Add("HOST_FACTS_SECRET_SHAPE: ${Where} is an opaque value of 32 or more characters; the facts carry names and paths, never a value.") }
            return
        }
        if ($Node -is [System.Collections.IDictionary]) {
            foreach ($key in $Node.Keys) { & $walk $Node[$key] "${Where}.${key}" }
            return
        }
        if ($Node -is [System.Collections.IEnumerable] -and -not ($Node -is [string])) {
            $index = 0
            foreach ($item in $Node) { & $walk $item "${Where}[$index]"; $index++ }
            return
        }
        if ($Node -is [System.Management.Automation.PSObject]) {
            foreach ($property in $Node.PSObject.Properties) {
                $childWhere = "${Where}.$($property.Name)"
                if ($secretNames.Contains($property.Name)) {
                    $value = $property.Value
                    $allowed = ($null -eq $value) -or ($value -is [bool]) -or (($value -is [string]) -and ($allowedForSecretKey -contains $value))
                    if (-not $allowed) { $errors.Add("HOST_FACTS_SECRET_KEY: ${childWhere} is named after an environment variable and carries a value; only present or absent may stand there.") }
                    continue
                }
                & $walk $property.Value $childWhere
            }
        }
    }
    & $walk $facts "facts"

    foreach ($name in $secretNames) {
        $value = [Environment]::GetEnvironmentVariable($name)
        if ([string]::IsNullOrWhiteSpace($value) -or $value.Length -lt 4) { continue }
        if ($raw.Contains($value, [StringComparison]::Ordinal)) {
            $errors.Add("HOST_FACTS_SECRET_VALUE: the value of ${name} appears in the file; the facts report that name as present or absent and never its value.")
        }
    }

    if ((Get-PropertyValue $facts "secretValuesReported") -ne $false) {
        $errors.Add("secretValuesReported: must be false; the file declares that no secret value is reported.")
    }
}

[ordered]@{
    status = if ($errors.Count -eq 0) { "valid" } else { "invalid" }
    path = $Path
    schema = $SchemaPath
    story = if ($null -ne $facts) { Get-PropertyValue $facts "story" } else { $null }
    runDirectory = if ($null -ne $facts) { Get-PropertyValue $facts "runDirectory" } else { $null }
    errors = [object[]]@($errors)
} | ConvertTo-Json -Depth 4

if ($errors.Count -gt 0) { exit 1 }
