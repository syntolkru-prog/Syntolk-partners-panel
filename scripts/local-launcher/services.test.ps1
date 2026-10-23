# Tests run the launcher's real service functions with fake processes and HTTP.
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'start-services.ps1'), [ref]$null, [ref]$null)
foreach ($definition in $ast.FindAll({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst]}, $true)) { . ([scriptblock]::Create($definition.Extent.Text)) }
$root = $projectRoot
$logs = Join-Path $projectRoot 'outputs\local-launcher\service-tests'
New-Item -ItemType Directory -Path $logs -Force | Out-Null
$NodePath = 'C:\Test Node\node.exe'
$script:calls = @()
$script:occupied = $false
$script:wrongOwner = $false
$script:healthy = $true
function Assert($Condition, [string]$Message) { if (!$Condition) { throw ('FAIL: ' + $Message) } }
function Phase([string]$Text) {}
function SocketReady([int]$Port) { return $script:occupied }
function NeedsBuild([string]$Package, [string]$Output) { return $true }
function Build([string]$Name) { $script:calls += @{kind='build';name=$Name} }
function Http([string]$Url) { if ($script:healthy) { return @{StatusCode=200} }; return $null }
function WaitFor([scriptblock]$Check, [int]$Seconds, [string]$Failure) { if (!(& $Check)) { throw $Failure } }
function Get-NetTCPConnection { param($LocalPort,$State,$ErrorAction) return [PSCustomObject]@{OwningProcess=123;LocalPort=$LocalPort} }
function Get-CimInstance { param($ClassName,$Filter) return [PSCustomObject]@{Name='node.exe';CommandLine=$(if($script:wrongOwner){'node unrelated-project.js'}else{'node apps/api/dist/server.js'})} }
function Start-Process { param($FilePath,$ArgumentList,$WorkingDirectory,$WindowStyle,$RedirectStandardOutput,$RedirectStandardError,[switch]$PassThru)
    $script:calls += @{kind='start';file=$FilePath;args=$ArgumentList;cwd=$WorkingDirectory;window=$WindowStyle;stdout=$RedirectStandardOutput;stderr=$RedirectStandardError;worker=$env:COACH_WORKER_ENABLED;scheduler=$env:OPENPARTNER_ENABLE_SCHEDULER}
    return [PSCustomObject]@{Id=123456}
}

EnsureService 'API' 4601 'http://127.0.0.1:4601/health' 'apps\api\dist\server.js' '.' 'apps\api'
$start = @($script:calls | Where-Object kind -eq 'start')
Assert ($start.Count -eq 1) 'stopped API starts once'
Assert ($start[0].window -eq 'Hidden') 'background API must be hidden'
Assert ($start[0].args[0] -eq ('"' + (Join-Path $root 'apps\api\dist\server.js') + '"')) 'API entry path is absolute and quoted'
Assert ($start[0].stdout -ne $start[0].stderr) 'separate stdout/stderr logs'
Assert ($start[0].worker -eq '0' -and $start[0].scheduler -eq '0') 'remote worker and scheduler disabled'
Assert (@($script:calls | Where-Object {$_.kind -eq 'build' -and $_.name -eq '@openpartner/api'}).Count -eq 1) 'stale API build uses correct package'

$script:calls = @()
EnsureService 'Портал' 5673 'http://127.0.0.1:5673/login' 'node_modules\vite\bin\vite.js' 'apps\portal' 'apps\portal'
$start = @($script:calls | Where-Object kind -eq 'start')
Assert ($start[0].args[0] -eq ('"' + (Join-Path $root 'apps\portal\node_modules\vite\bin\vite.js') + '"')) 'portal uses its own local Vite'
Assert (($start[0].args -join ' ') -match '--host 127.0.0.1 --port 5673 --strictPort') 'portal strict port and loopback bind'

$script:occupied = $true; $script:calls = @()
EnsureService 'API' 4601 'http://127.0.0.1:4601/health' 'apps\api\dist\server.js' '.' 'apps\api'
Assert ($script:calls.Count -eq 0) 'healthy existing service is reused without duplicate/build'

$script:wrongOwner = $true; $failed = $false
try { EnsureService 'API' 4601 'http://127.0.0.1:4601/health' 'apps\api\dist\server.js' '.' 'apps\api' } catch { $failed = $true }
Assert $failed 'unrelated process on expected port blocks startup'
Assert ($script:calls.Count -eq 0) 'unrelated process is left alone'

$script:wrongOwner = $false; $script:healthy = $false; $failed = $false
try { EnsureService 'API' 4601 'http://127.0.0.1:4601/health' 'apps\api\dist\server.js' '.' 'apps\api' } catch { $failed = $true }
Assert $failed 'occupied but unhealthy service is reported'
Assert ($script:calls.Count -eq 0) 'unhealthy occupied service does not cause duplicate process'
Write-Output 'PASS: cold start, stale build, local Vite, warm start, occupied ports, hidden processes, publication worker disabled.'
