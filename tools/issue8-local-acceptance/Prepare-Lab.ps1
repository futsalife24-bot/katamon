param(
  [Parameter(Mandatory=$true)][string]$NpmCliPath,
  [Parameter(Mandatory=$true)][string]$PythonPath
)
$ErrorActionPreference = 'Stop'
$nodeExecutable = (Get-Command node -CommandType Application -ErrorAction Stop).Source
$npmCli = (Resolve-Path -LiteralPath $NpmCliPath).Path
$pythonExecutable = (Resolve-Path -LiteralPath $PythonPath).Path
$runtimeDir = Join-Path $PSScriptRoot '.runtime'
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
$firebasePackage = Join-Path $runtimeDir 'node_modules/firebase-tools/package.json'
$firebaseReady = (Test-Path -LiteralPath $firebasePackage) -and ((Get-Content -LiteralPath $firebasePackage -Raw | ConvertFrom-Json).version -eq '15.29.0')
if (-not $firebaseReady) {
  & $nodeExecutable $npmCli install --prefix $runtimeDir --ignore-scripts --no-audit --no-fund --save-exact firebase-tools@15.29.0
  if ($LASTEXITCODE -ne 0) { throw 'firebase-tools取得失敗' }
}
$javaExecutable = Join-Path $runtimeDir 'java/jdk-21.0.12.1+1/bin/java.exe'
if (-not (Test-Path -LiteralPath $javaExecutable)) {
  $archive = Join-Path $runtimeDir 'microsoft-jdk-21.0.12.1-windows-x64.zip'
  if (-not (Test-Path -LiteralPath $archive)) {
    Invoke-WebRequest -Uri 'https://aka.ms/download-jdk/microsoft-jdk-21.0.12.1-windows-x64.zip' -OutFile $archive
  }
  $actualHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
  $expectedHash = '192441A9D27DA813BADA974BB88B4CF64D37A9589ED37F204374D411CA5CE07F'
  if ($actualHash -ne $expectedHash) { throw '公式JDK SHA256不一致。実行・展開しません' }
  Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $runtimeDir 'java')
}
$cert = Join-Path $PSScriptRoot '.state/localhost-cert.pem'
$key = Join-Path $PSScriptRoot '.state/localhost-key.pem'
if (-not (Test-Path -LiteralPath $cert) -and -not (Test-Path -LiteralPath $key)) {
  $previousPythonUtf8 = $env:PYTHONUTF8
  try { $env:PYTHONUTF8 = '1'; & $pythonExecutable (Join-Path $PSScriptRoot 'make-local-cert.py'); if ($LASTEXITCODE -ne 0) { throw '証明書ファイル生成失敗（Python cryptographyが必要）' } }
  finally { $env:PYTHONUTF8 = $previousPythonUtf8 }
}
Write-Output '準備完了。OSインストール・信頼ストア登録・Firewall変更・LAN公開はありません。'
Write-Output 'Run-Lab.ps1 Preflightで不足とport競合を確認してください。'
exit 0
