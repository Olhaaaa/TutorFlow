# Обгортка для PowerShell: запускає infra/deploy.sh через Git Bash.
#
#   .\infra\deploy.ps1 seed
#   .\infra\deploy.ps1 --split
#
# Просто `bash` тут не годиться: у PowerShell він резолвиться в
# C:\Windows\System32\bash.exe, тобто у WSL, де немає ні gcloud, ні helm з Windows.
$ErrorActionPreference = 'Stop'

$git = (Get-Command git -ErrorAction SilentlyContinue).Source
if (-not $git) { throw 'не знайдено git — потрібен Git for Windows (у ньому Git Bash)' }

# ...\Git\cmd\git.exe → ...\Git\bin\bash.exe
$bash = Join-Path (Split-Path (Split-Path $git)) 'bin\bash.exe'
if (-not (Test-Path $bash)) { throw "не знайдено Git Bash: $bash" }

& $bash (Join-Path $PSScriptRoot 'deploy.sh') @args
exit $LASTEXITCODE
