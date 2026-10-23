# Start services for the shared Codex browser, without opening another app.
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$saved = Join-Path $root '.local-demo\launcher\settings.json'
$settings = if (Test-Path -LiteralPath $saved) { Get-Content -LiteralPath $saved -Raw | ConvertFrom-Json } else { $null }
$node = if ($settings -and (Test-Path -LiteralPath $settings.node)) { $settings.node } else { (Get-Command node -ErrorAction Stop).Source }
$pnpm = if ($settings -and (Test-Path -LiteralPath $settings.pnpm)) { $settings.pnpm } else { (Get-Command pnpm -ErrorAction Stop).Source }
& (Join-Path $PSScriptRoot 'start-services.ps1') -NodePath $node -PnpmPath $pnpm

# A ticket is short-lived and usable once on its specific local origin.
# Give only the current Windows user access to the directory before issuing it.
$tickets = Join-Path $root '.local-demo\browser-login'
New-Item -ItemType Directory -Path $tickets -Force | Out-Null
$owner = [Security.Principal.WindowsIdentity]::GetCurrent().User
# icacls updates only the DACL and works without audit privileges in PS 5.1.
& (Join-Path $env:SystemRoot 'System32\icacls.exe') $tickets /inheritance:r /grant:r ('*' + $owner.Value + ':(OI)(CI)F') | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Не удалось ограничить доступ к папке локального входа.' }
& $node (Join-Path $PSScriptRoot 'browser-login.mjs') --issue
if ($LASTEXITCODE -ne 0) { throw 'Не удалось подготовить вход в браузере Codex.' }
[IO.File]::WriteAllText((Join-Path $root 'outputs\local-launcher\phase.txt'), 'Syntolk готов', [Text.Encoding]::UTF8)
Write-Output ''
Write-Output 'Syntolk готов. Откройте или обновите две вкладки Codex:'
Write-Output 'Администратор: http://localhost:5673/'
Write-Output 'Партнёр:       http://127.0.0.1:5673/'
