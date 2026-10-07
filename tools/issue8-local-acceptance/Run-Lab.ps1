param(
  [ValidateSet('Preflight','PreflightUsb','Start','StartUsb','Stop','Test','Smoke','BrowserProbe','UsbSmoke')][string]$Action = 'Preflight',
  [string]$Repository = '',
  [string]$JavaHome = ''
)
$ErrorActionPreference = 'Stop'
$previousJava = $env:KATAMON_JAVA_HOME
$previousRepo = $env:KATAMON_SOURCE_REPO
try {
  if ($Repository) { $env:KATAMON_SOURCE_REPO = (Resolve-Path -LiteralPath $Repository).Path }
  $localJava = Join-Path $PSScriptRoot '.runtime/java/jdk-21.0.12.1+1'
  if ($JavaHome) { $env:KATAMON_JAVA_HOME = (Resolve-Path -LiteralPath $JavaHome).Path }
  elseif (Test-Path -LiteralPath (Join-Path $localJava 'bin/java.exe')) { $env:KATAMON_JAVA_HOME = $localJava }
  $nodeExecutable = (Get-Command node -CommandType Application -ErrorAction Stop).Source
  switch ($Action) {
    'Test' { & $nodeExecutable --test (Join-Path $PSScriptRoot 'lab.test.cjs') }
    'Smoke' { & $nodeExecutable (Join-Path $PSScriptRoot 'smoke.cjs') }
    'BrowserProbe' { & $nodeExecutable (Join-Path $PSScriptRoot 'browser-probe.cjs') }
    'UsbSmoke' { & $nodeExecutable (Join-Path $PSScriptRoot 'usb-smoke.cjs') }
    default { & $nodeExecutable (Join-Path $PSScriptRoot 'lab.cjs') $Action.ToLowerInvariant() }
  }
  $resultCode = $LASTEXITCODE
} finally {
  $env:KATAMON_JAVA_HOME = $previousJava
  $env:KATAMON_SOURCE_REPO = $previousRepo
}
exit $resultCode
