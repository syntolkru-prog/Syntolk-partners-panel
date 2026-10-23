param([string]$NodePath, [string]$PnpmPath)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$logs = Join-Path $root 'outputs\local-launcher'
New-Item -ItemType Directory -Path $logs -Force | Out-Null
$env:PATH = (Split-Path -Parent $NodePath) + ';' + (Split-Path -Parent $PnpmPath) + ';' + $env:PATH
$startupLock = New-Object Threading.Mutex($false, 'Local\SyntolkServiceStartup')
$ownsLock = $false
try {
try { $ownsLock = $startupLock.WaitOne(300000) } catch [Threading.AbandonedMutexException] { $ownsLock = $true }
if (!$ownsLock) { throw 'Другой запуск Syntolk ещё выполняется.' }

function Phase([string]$Text) {
    [IO.File]::WriteAllText((Join-Path $logs 'phase.txt'), $Text, [Text.Encoding]::UTF8)
}
function Http([string]$Url) {
    try {
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 6
        if ($r.StatusCode -eq 200) { return $r }
    } catch {}
    return $null
}
function SocketReady([int]$Port) {
    $client = New-Object Net.Sockets.TcpClient
    try { $pending = $client.BeginConnect('127.0.0.1', $Port, $null, $null); if (!$pending.AsyncWaitHandle.WaitOne(1200)) { return $false }; $client.EndConnect($pending); return $true }
    catch { return $false }
    finally { $client.Close() }
}
function WaitFor([scriptblock]$Check, [int]$Seconds, [string]$Failure) {
    $end = [DateTime]::UtcNow.AddSeconds($Seconds)
    do { if (& $Check) { return }; Start-Sleep -Seconds 2 } while ([DateTime]::UtcNow -lt $end)
    throw $Failure
}
function NeedsBuild([string]$Package, [string]$Output) {
    $target = Join-Path $root $Output
    if (!(Test-Path -LiteralPath $target)) { return $true }
    $compiled = (Get-Item -LiteralPath $target).LastWriteTimeUtc
    $files = @(Get-ChildItem -LiteralPath (Join-Path $root ($Package + '\src')) -Recurse -File | Where-Object { $_.FullName -notmatch '[\\/]__tests__[\\/]|\.(test|spec)\.' })
    $files += @(Get-Item -LiteralPath (Join-Path $root ($Package + '\package.json')),(Join-Path $root ($Package + '\tsconfig.json')))
    if ($Package -eq 'apps\portal') { $files += @(Get-Item -LiteralPath (Join-Path $root 'apps\portal\vite.config.ts'),(Join-Path $root 'apps\portal\index.html')); $files += @(Get-ChildItem (Join-Path $root 'apps\portal\public') -Recurse -File) }
    return @($files | Where-Object { $_.LastWriteTimeUtc -gt $compiled }).Count -gt 0
}
function Build([string]$Name) {
    Phase ('Сборка ' + $Name + '…')
    Push-Location $root
    try {
        & $PnpmPath --filter $Name build *> (Join-Path $logs ('build-' + ($Name -replace '[^a-zA-Z0-9]', '-') + '.log'))
        if ($LASTEXITCODE -ne 0) { throw ('Не удалось собрать ' + $Name + '. Подробности в outputs\local-launcher.') }
    } finally { Pop-Location }
}
function EnsureService([string]$Name, [int]$Port, [string]$Url, [string]$Entry, [string]$Directory, [string]$Package) {
    Phase ('Проверка: ' + $Name + '…')
    if (SocketReady $Port) {
        $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
        if (!$listeners.Count) { throw ('Не удалось проверить владельца порта ' + $Port + '.') }
        foreach ($owner in @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)) {
            $process = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $owner)
            $command = ([string]$process.CommandLine).Replace('\', '/')
            $expected = $Entry.Replace('\', '/')
            if ($process.Name -notmatch '^node(\.exe)?$' -or !$command.Contains($expected)) { throw ('Порт ' + $Port + ' занят другим приложением. Процессы оставлены работающими.') }
        }
        WaitFor { Http $Url } 30 ('Сервис ' + $Name + ' занимает порт, но не проходит проверку. Перезапуск не выполнен.')
        return
    }
    if (!(Test-Path -LiteralPath (Join-Path $root 'packages\db\dist\index.js'))) { Build '@openpartner/db' }
    $artifact = if ($Name -eq 'Портал') { 'apps\portal\dist\index.html' } else { $Entry }
    if (NeedsBuild $Package $artifact) { Build ('@openpartner/' + ($Package -split '\\')[-1]) }
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $arguments = @('"' + (Join-Path $root ($Directory + '\' + $Entry)) + '"')
    if ($Name -ne 'Портал') { $arguments = @('"' + (Join-Path $root $Entry) + '"') }
    if ($Name -eq 'Портал') { $arguments += @('--host', '127.0.0.1', '--port', '5673', '--strictPort') }
    $savedWorker = $env:COACH_WORKER_ENABLED
    $savedScheduler = $env:OPENPARTNER_ENABLE_SCHEDULER
    try {
        $env:COACH_WORKER_ENABLED = '0'
        $env:OPENPARTNER_ENABLE_SCHEDULER = '0'
        $proc = Start-Process -FilePath $NodePath -ArgumentList $arguments -WorkingDirectory (Join-Path $root $Directory) -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs ($Port.ToString() + '-' + $stamp + '.stdout.log')) -RedirectStandardError (Join-Path $logs ($Port.ToString() + '-' + $stamp + '.stderr.log')) -PassThru
        [IO.File]::WriteAllText((Join-Path $logs ($Port.ToString() + '.pid')), [string]$proc.Id)
    } finally { $env:COACH_WORKER_ENABLED = $savedWorker; $env:OPENPARTNER_ENABLE_SCHEDULER = $savedScheduler }
    WaitFor { Http $Url } 60 ('Не запустился сервис ' + $Name + ' на порту ' + $Port + '. Подробности в outputs\local-launcher.')
}

Phase 'Проверка Docker…'
$docker = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
if (!(Test-Path -LiteralPath $docker)) { throw 'Docker Desktop не установлен.' }
function DockerReady { $ErrorActionPreference = 'Continue'; & $docker info --format '{{.ServerVersion}}' 2>$null | Out-Null; return $LASTEXITCODE -eq 0 }
if (!(DockerReady)) {
    Phase 'Запуск Docker Desktop…'
    Start-Process -FilePath 'C:\Program Files\Docker\Docker\Docker Desktop.exe' -WindowStyle Hidden
    WaitFor { DockerReady } 240 'Docker Engine не запустился за 4 минуты.'
}
Phase 'Проверка PostgreSQL…'
$container = & $docker inspect openpartner-postgres --format '{{.State.Status}}' 2>$null
if ($LASTEXITCODE -ne 0) { throw 'Существующий контейнер openpartner-postgres не найден. Новый контейнер не создавался.' }
if ($container -ne 'running') { & $docker start openpartner-postgres | Out-Null; if ($LASTEXITCODE -ne 0) { throw 'Не удалось запустить openpartner-postgres.' } }
WaitFor {
    $state = & $docker inspect openpartner-postgres --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' 2>$null
    $ready = $state -match '^running(?: healthy)?\s*$'
    if ($ready -and (SocketReady 5433)) { & $docker exec openpartner-postgres pg_isready -h 127.0.0.1 2>$null | Out-Null; return $LASTEXITCODE -eq 0 }
    return $false
} 120 'PostgreSQL не готов: требуется работающий openpartner-postgres на порту 5433.'

EnsureService 'API' 4601 'http://127.0.0.1:4601/health' 'apps\api\dist\server.js' '.' 'apps\api'
EnsureService 'Счётчик переходов' 4701 'http://127.0.0.1:4701/health' 'apps\router\dist\server.js' '.' 'apps\router'
EnsureService 'Портал' 5673 'http://127.0.0.1:5673/login' 'node_modules\vite\bin\vite.js' 'apps\portal' 'apps\portal'
Phase 'Проверка подключения к базе…'
WaitFor { Http 'http://127.0.0.1:4601/install/status' } 30 'API отвечает на health, но не может прочитать состояние установки из PostgreSQL.'
$install = Http 'http://127.0.0.1:4601/install/status'
$setup = $install.Content | ConvertFrom-Json
if ($setup.needsSetup -ne $false) { throw 'API сообщает needsSetup=true. Повторная установка не выполнялась.' }
WaitFor { Http 'http://127.0.0.1:4601/branding' } 30 'Ошибка чтения брендинга из PostgreSQL.'
Phase 'Выполняется вход в кабинеты…'
} finally { if ($ownsLock) { $startupLock.ReleaseMutex() }; $startupLock.Dispose() }
