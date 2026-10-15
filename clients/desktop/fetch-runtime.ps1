$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$root=Split-Path -Parent $MyInvocation.MyCommand.Path
$version='44.7.0'
$name="electron-v$version-win32-x64.zip"
$downloads=Join-Path $root 'tools/downloads'
New-Item -ItemType Directory -Path $downloads -Force | Out-Null
$checks=Join-Path $downloads 'SHASUMS256.txt'
$zip=Join-Path $downloads $name
$base="https://github.com/electron/electron/releases/download/v$version"
Invoke-WebRequest -UseBasicParsing -Uri "$base/SHASUMS256.txt" -OutFile $checks
$line=Get-Content -LiteralPath $checks | Where-Object {$_ -match ('\s+\*?'+[Regex]::Escape($name)+'$')}
if(@($line).Count -ne 1){throw 'Official checksum missing'}
$expected=($line -split '\s+')[0]
if(-not(Test-Path -LiteralPath $zip) -or (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash -ne $expected){
  Invoke-WebRequest -UseBasicParsing -Uri "$base/$name" -OutFile $zip
}
if((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash -ne $expected){throw 'Electron checksum mismatch'}
$dest=Join-Path $root "tools/electron-$version"
if(-not(Test-Path -LiteralPath (Join-Path $dest 'electron.exe'))){Expand-Archive -LiteralPath $zip -DestinationPath $dest -Force}
[PSCustomObject]@{version=$version;sha256=$expected;directory=$dest}|ConvertTo-Json -Compress
