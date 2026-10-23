$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$destination = Join-Path $root '.local-demo\launcher'
$sdk = Join-Path $root 'outputs\local-launcher\webview2-1.0.4258.31'
if (!(Test-Path -LiteralPath (Join-Path $sdk 'lib\net462\Microsoft.Web.WebView2.Core.dll'))) { throw 'SDK Microsoft.Web.WebView2 1.0.4258.31 отсутствует в outputs/local-launcher.' }
New-Item -ItemType Directory -Path $destination -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $sdk 'lib\net462\Microsoft.Web.WebView2.Core.dll'),(Join-Path $sdk 'lib\net462\Microsoft.Web.WebView2.WinForms.dll'),(Join-Path $sdk 'runtimes\win-x64\native\WebView2Loader.dll') -Destination $destination -Force
$node = (Get-Command node -ErrorAction Stop).Source
$pnpm = (Get-Command pnpm -ErrorAction Stop).Source
$settings = @{node=$node;pnpm=$pnpm;sdk='1.0.4258.31'} | ConvertTo-Json
[IO.File]::WriteAllText((Join-Path $destination 'settings.json'), $settings, (New-Object Text.UTF8Encoding $false))
$automation = 'C:\Windows\Microsoft.NET\assembly\GAC_MSIL\System.Management.Automation\v4.0_3.0.0.0__31bf3856ad364e35\System.Management.Automation.dll'
$compiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$exe = Join-Path $destination 'Syntolk.exe'
& $compiler /nologo /target:winexe /platform:x64 /optimize+ /utf8output ('/out:' + $exe) ('/win32icon:' + (Join-Path $root 'apps\portal\public\favicon.ico')) /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll ('/reference:' + $automation) ('/reference:' + (Join-Path $destination 'Microsoft.Web.WebView2.Core.dll')) ('/reference:' + (Join-Path $destination 'Microsoft.Web.WebView2.WinForms.dll')) (Join-Path $PSScriptRoot 'Launcher.cs')
if ($LASTEXITCODE -ne 0) { throw 'Не удалось собрать Syntolk.exe.' }
Write-Output $exe
