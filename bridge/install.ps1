#Requires -RunAsAdministrator
<#
  Tradebot MT5 Bridge - one-command installer for a Windows PC / VPS.

  What it does:
    1. Downloads the bridge (bridge.py) into C:\Tradebot\bridge
    2. Installs Python 3.12 if missing, creates a virtual environment, installs MetaTrader5 + FastAPI
    3. Generates a secret access key (kept in C:\Tradebot\bridge\config.json)
    4. Sets up HTTPS with Caddy and a free <your-ip>.sslip.io address (or your own -Domain)
    5. Opens firewall ports 80/443 and registers scheduled tasks so everything starts automatically
    6. Prints the Bridge URL + Access key to enter in the Tradebot app

  Before running: install XM's MetaTrader 5, log in with "Save password" ticked, and press "Algo Trading".

  Run in an *Administrator* PowerShell:
    iwr https://raw.githubusercontent.com/dnzryts/Tradebot/main/bridge/install.ps1 -OutFile $env:TEMP\tb.ps1
    powershell -ExecutionPolicy Bypass -File $env:TEMP\tb.ps1

  Options:  -Domain bridge.example.com   use your own domain (its DNS A record must point to this server)
            -Port 8787                   local port of the bridge (default 8787)
            -NewKey                      generate a new access key (the old one stops working)
#>
param(
  [string]$Domain = "",
  [int]$Port = 8787,
  [switch]$NewKey,
  [string]$Repo = "dnzryts/Tradebot",
  [string]$Branch = "main"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Root = "C:\Tradebot"
$Dir = Join-Path $Root "bridge"
function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Ok($msg) { Write-Host "    $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "    $msg" -ForegroundColor Yellow }
function Run($exe, [string[]]$argList) {
  & $exe @argList
  if ($LASTEXITCODE -ne 0) { throw "Command failed ($LASTEXITCODE): $exe $($argList -join ' ')" }
}

New-Item -ItemType Directory -Force -Path $Dir | Out-Null

# ---------------------------------------------------------------- 1. bridge files
Step "Getting the bridge files"
$here = if ($PSScriptRoot) { (Resolve-Path $PSScriptRoot).Path } else { "" }
foreach ($f in @("bridge.py", "requirements.txt")) {
  $target = Join-Path $Dir $f
  if ($here -and ($here -eq (Resolve-Path $Dir).Path) -and (Test-Path $target)) { continue }       # running from C:\Tradebot\bridge
  if ($here -and (Test-Path (Join-Path $here $f))) { Copy-Item (Join-Path $here $f) $target -Force } # running from a repo checkout
  else { Invoke-WebRequest "https://raw.githubusercontent.com/$Repo/$Branch/bridge/$f" -OutFile $target -UseBasicParsing }
}
Ok "Files in $Dir"

# ---------------------------------------------------------------- 2. Python + packages
function Find-Python {
  foreach ($c in @("$env:ProgramFiles\Python312\python.exe", "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe")) {
    if (Test-Path $c) { return $c }
  }
  return $null
}
$python = Find-Python
if (-not $python) {
  Step "Installing Python 3.12 (64-bit)"
  $exe = Join-Path $env:TEMP "python-3.12.10-amd64.exe"
  Invoke-WebRequest "https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe" -OutFile $exe -UseBasicParsing
  Start-Process $exe -ArgumentList "/quiet InstallAllUsers=1 PrependPath=1 Include_test=0" -Wait
  $python = Find-Python
  if (-not $python) { throw "Python installation failed. Install Python 3.12 (64-bit) from python.org and run this script again." }
}
Ok "Python: $python"

Step "Creating virtual environment and installing MetaTrader5 + FastAPI"
$venvPy = Join-Path $Dir ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPy)) { Run $python @("-m", "venv", (Join-Path $Dir ".venv")) }
Run $venvPy @("-m", "pip", "install", "--quiet", "--upgrade", "pip")
Run $venvPy @("-m", "pip", "install", "--quiet", "--upgrade", "-r", (Join-Path $Dir "requirements.txt"))
Ok "Packages installed"

# ---------------------------------------------------------------- 3. MetaTrader 5 terminal
Step "Looking for the MetaTrader 5 terminal"
$terminal = ""
$found = @()
foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, "$env:APPDATA\MetaQuotes")) {
  if ($base -and (Test-Path $base)) {
    $found += Get-ChildItem -Path $base -Filter "terminal64.exe" -Recurse -Depth 3 -ErrorAction SilentlyContinue
  }
}
if ($found.Count -gt 0) {
  $pick = $found | Where-Object { $_.FullName -match "XM" } | Select-Object -First 1
  if (-not $pick) { $pick = $found | Select-Object -First 1 }
  $terminal = $pick.FullName
  Ok "Found: $terminal"
} else {
  Warn "MetaTrader 5 not found. Install XM's MT5, log in (tick 'Save password'), then run this script again."
}

# ---------------------------------------------------------------- 4. access key + config
Step "Creating the access key"
$cfgPath = Join-Path $Dir "config.json"
$token = ""
if ((Test-Path $cfgPath) -and -not $NewKey) {
  try { $token = (Get-Content $cfgPath -Raw | ConvertFrom-Json).token } catch { $token = "" }
}
if (-not $token -or $token.Length -lt 24) {
  $bytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $token = [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
  Ok "New access key generated"
} else { Ok "Keeping existing access key (use -NewKey to replace it)" }
$cfg = [ordered]@{ token = $token; host = "127.0.0.1"; port = $Port; terminal_path = $terminal }
$cfg | ConvertTo-Json | Set-Content -Path $cfgPath -Encoding ASCII
# Only this user, SYSTEM and Administrators may read the key
& icacls $cfgPath /inheritance:r /grant:r "$($env:USERNAME):(M)" "SYSTEM:(F)" "Administrators:(F)" | Out-Null

# ---------------------------------------------------------------- 5. HTTPS with Caddy
Step "Setting up HTTPS"
if (-not $Domain) {
  $ip = (Invoke-RestMethod "https://api.ipify.org" -UseBasicParsing).ToString().Trim()
  if ($ip -notmatch "^\d{1,3}(\.\d{1,3}){3}$") { throw "Could not detect the public IPv4 address (got '$ip'). Re-run with -Domain." }
  $Domain = ($ip -replace "\.", "-") + ".sslip.io"
}
Ok "Address: https://$Domain"
$caddy = Join-Path $Root "caddy.exe"
if (-not (Test-Path $caddy)) {
  Invoke-WebRequest "https://caddyserver.com/api/download?os=windows&arch=amd64" -OutFile $caddy -UseBasicParsing
}
$caddyfile = Join-Path $Root "Caddyfile"
$conf = "$Domain {`r`n    encode gzip`r`n    reverse_proxy 127.0.0.1:$Port`r`n}`r`n"
Set-Content -Path $caddyfile -Value $conf -Encoding ASCII
Ok "Caddy ready"

Step "Opening firewall ports 80 and 443 (needed for the HTTPS certificate)"
Get-NetFirewallRule -DisplayName "Tradebot HTTPS" -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName "Tradebot HTTPS" -Direction Inbound -Protocol TCP -LocalPort 80, 443 -Action Allow | Out-Null
Ok "Firewall rule added (also open 80/443 in your VPS provider's panel if it has its own firewall)"

# ---------------------------------------------------------------- 6. auto-start
Step "Registering auto-start tasks"
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

$caddyAction = New-ScheduledTaskAction -Execute $caddy -Argument "run --config `"$caddyfile`" --adapter caddyfile" -WorkingDirectory $Root
Register-ScheduledTask -TaskName "Tradebot Caddy" -Action $caddyAction -Trigger (New-ScheduledTaskTrigger -AtStartup) `
  -Settings $settings -User "SYSTEM" -RunLevel Highest -Force | Out-Null

# The bridge talks to the MT5 window, so it runs inside your logged-in desktop session.
$me = "$env:USERDOMAIN\$env:USERNAME"
$bridgeAction = New-ScheduledTaskAction -Execute (Join-Path $Dir ".venv\Scripts\pythonw.exe") -Argument "`"$(Join-Path $Dir 'bridge.py')`"" -WorkingDirectory $Dir
$principal = New-ScheduledTaskPrincipal -UserId $me -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName "Tradebot Bridge" -Action $bridgeAction -Trigger (New-ScheduledTaskTrigger -AtLogOn -User $me) `
  -Settings $settings -Principal $principal -Force | Out-Null
Ok "Tasks 'Tradebot Caddy' (at startup) and 'Tradebot Bridge' (at your logon) registered"

Step "Starting"
Stop-ScheduledTask -TaskName "Tradebot Bridge" -ErrorAction SilentlyContinue
Stop-ScheduledTask -TaskName "Tradebot Caddy" -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName "Tradebot Caddy"
Start-ScheduledTask -TaskName "Tradebot Bridge"

$localOk = $false
for ($i = 0; $i -lt 20 -and -not $localOk; $i++) {
  Start-Sleep -Seconds 2
  try { $localOk = (Invoke-RestMethod "http://127.0.0.1:$Port/health" -UseBasicParsing).ok } catch {}
}
if ($localOk) { Ok "Bridge is running locally" } else { Warn "Bridge did not answer yet - see $Dir\bridge.log" }

$httpsOk = $false
for ($i = 0; $i -lt 30 -and -not $httpsOk; $i++) {
  Start-Sleep -Seconds 3
  try { $httpsOk = (Invoke-RestMethod "https://$Domain/health" -UseBasicParsing).ok } catch {}
}
if ($httpsOk) { Ok "HTTPS works: https://$Domain" }
else { Warn "HTTPS not reachable yet. Check that ports 80/443 are open in your VPS provider's firewall; the certificate is issued automatically once they are." }

$summary = @"
Tradebot MT5 Bridge
===================
Bridge URL : https://$Domain
Access key : $token

In the Tradebot app: Profile > Connect MT5 > Own VPS (bridge) and enter both values.
Keep the access key secret - anyone with it can trade on this MT5 account.
"@
Set-Content -Path (Join-Path $Root "CONNECTION.txt") -Value $summary -Encoding ASCII
& icacls (Join-Path $Root "CONNECTION.txt") /inheritance:r /grant:r "$($env:USERNAME):(M)" "SYSTEM:(F)" "Administrators:(F)" | Out-Null

Write-Host ""
Write-Host "==================================================================" -ForegroundColor Green
Write-Host "  Bridge URL : https://$Domain" -ForegroundColor White
Write-Host "  Access key : $token" -ForegroundColor White
Write-Host "==================================================================" -ForegroundColor Green
Write-Host "  Saved to C:\Tradebot\CONNECTION.txt"
Write-Host "  Keep MT5 open with 'Algo Trading' ON. Disconnect RDP with the X button (do not sign out)."
