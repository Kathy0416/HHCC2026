param(
    [string[]]$Tasks = @('testDebugUnitTest', 'assembleDebug')
)

$ErrorActionPreference = 'Stop'

function Get-JavaMajorVersion([string]$javaHomePath) {
    $java = Join-Path $javaHomePath 'bin\java.exe'
    $jlink = Join-Path $javaHomePath 'bin\jlink.exe'
    if (-not (Test-Path -LiteralPath $java) -or -not (Test-Path -LiteralPath $jlink)) { return $null }
    $versionLine = (& $java --version | Select-Object -First 1) -join ''
    if ($versionLine -match '(?:version\s+)?"?(?:1\.)?(\d+)') { return [int]$Matches[1] }
    return $null
}

$jdkCandidates = @()
if ($env:JAVA_HOME) { $jdkCandidates += $env:JAVA_HOME }
$microsoftJdkRoot = Join-Path $env:ProgramFiles 'Microsoft'
if (Test-Path -LiteralPath $microsoftJdkRoot) {
    $jdkCandidates += Get-ChildItem -LiteralPath $microsoftJdkRoot -Directory -Filter 'jdk-21*' |
        Sort-Object Name -Descending |
        Select-Object -ExpandProperty FullName
}
$androidStudioJdk = Join-Path $env:ProgramFiles 'Android\Android Studio\jbr'
$jdkCandidates += $androidStudioJdk
$jdkHome = $jdkCandidates | Where-Object { (Get-JavaMajorVersion $_) -eq 21 } | Select-Object -First 1
if (-not $jdkHome) {
    throw 'A full JDK 21 installation (including jlink) is required. Set JAVA_HOME and try again.'
}
$env:JAVA_HOME = $jdkHome
$env:Path = "$jdkHome\bin;$env:Path"

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$androidRoot = Join-Path $projectRoot 'android'
$workingAndroid = $androidRoot
$junction = $null

if ($projectRoot -match '[^\x00-\x7F]') {
    $junction = Join-Path ([IO.Path]::GetTempPath()) ("migraine-capacitor-build-$PID")
    if (Test-Path -LiteralPath $junction) {
        throw "Temporary build path already exists: $junction"
    }
    New-Item -ItemType Junction -Path $junction -Target $projectRoot | Out-Null
    $workingAndroid = Join-Path $junction 'android'
}

try {
    Push-Location -LiteralPath $workingAndroid
    try {
        & '.\gradlew.bat' @Tasks
        if ($LASTEXITCODE -ne 0) {
            throw "Gradle failed with exit code $LASTEXITCODE"
        }
    } finally {
        Pop-Location
    }
} finally {
    if ($junction) {
        $item = Get-Item -LiteralPath $junction -Force
        if ($item.LinkType -ne 'Junction' -or $item.Target -notcontains $projectRoot) {
            throw "Refusing to remove an unexpected temporary path: $junction"
        }
        cmd.exe /d /c rmdir "$junction"
        if ($LASTEXITCODE -ne 0 -or (Test-Path -LiteralPath $junction)) {
            throw "Unable to remove temporary build junction: $junction"
        }
    }
}
