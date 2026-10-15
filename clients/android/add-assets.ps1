param([Parameter(Mandatory=$true)][string]$Apk,[Parameter(Mandatory=$true)][string]$Assets)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$mobileAssetRoot=(Resolve-Path -LiteralPath $Assets).Path.TrimEnd('\')
$mobileAssetZip=[IO.Compression.ZipFile]::Open((Resolve-Path -LiteralPath $Apk).Path,[IO.Compression.ZipArchiveMode]::Update)
try{
 $mobileAssetManifest=Get-Content -LiteralPath (Join-Path $mobileAssetRoot 'pack/manifest.json') -Raw|ConvertFrom-Json
 $mobileAssetNames=@('GPL-3.0.txt','THIRD-PARTY-NOTICES.txt','servers.json','pack/manifest.json')
 $mobileAssetNames+=@($mobileAssetManifest.entries.PSObject.Properties|ForEach-Object{'pack/'+[Uri]::UnescapeDataString($_.Name.TrimStart('/'))})
 foreach($mobileAssetName in $mobileAssetNames){
  $mobileAssetPath=[IO.Path]::GetFullPath((Join-Path $mobileAssetRoot $mobileAssetName))
  if(-not $mobileAssetPath.StartsWith($mobileAssetRoot+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe APK asset path.'}
  [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($mobileAssetZip,$mobileAssetPath,'assets/'+$mobileAssetName,[IO.Compression.CompressionLevel]::Optimal)|Out-Null
 }
}finally{$mobileAssetZip.Dispose()}
