$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$mobileVersion=([xml](Get-Content -LiteralPath (Join-Path $PSScriptRoot 'android/AndroidManifest.xml') -Raw)).manifest.GetAttribute('versionName','http://schemas.android.com/apk/res/android')
$mobileApk=Join-Path $PSScriptRoot "export/卫戍协议-安卓完整版-v$mobileVersion.apk"
$mobileZip=[IO.Compression.ZipFile]::OpenRead($mobileApk)
try{
 $mobileManifestEntry=$mobileZip.GetEntry('assets/pack/manifest.json')
 $mobileReader=New-Object IO.StreamReader($mobileManifestEntry.Open())
 try{$mobileManifest=$mobileReader.ReadToEnd()|ConvertFrom-Json}finally{$mobileReader.Dispose()}
 $mobileChecked=0;$mobileBytes=[long]0;$mobileDigest=[Security.Cryptography.SHA256]::Create()
 foreach($property in $mobileManifest.entries.PSObject.Properties){
  $mobileAssetName='assets/pack/'+[Uri]::UnescapeDataString($property.Name.TrimStart('/'))
  $mobileAsset=$mobileZip.GetEntry($mobileAssetName)
  if(-not $mobileAsset -or $mobileAsset.Length -ne $property.Value.bytes){throw "Missing or truncated asset: $($property.Name)"}
  $mobileStream=$mobileAsset.Open()
  try{$mobileHash=[BitConverter]::ToString($mobileDigest.ComputeHash($mobileStream)).Replace('-','').ToLowerInvariant()}finally{$mobileStream.Dispose()}
  if($mobileHash -ne $property.Value.hash){throw "Asset hash differs: $($property.Name)"}
  $mobileChecked++;$mobileBytes+=$mobileAsset.Length
 }
 if(-not $mobileZip.GetEntry('classes.dex') -or -not $mobileZip.GetEntry('AndroidManifest.xml')){throw 'APK application entries are missing.'}
 $mobileReceipt=[ordered]@{ok=$true;version=$mobileVersion;files=$mobileChecked;extras=@($mobileManifest.extras.PSObject.Properties).Count;uncompressedBytes=$mobileBytes;apkBytes=(Get-Item -LiteralPath $mobileApk).Length;sha256=(Get-FileHash -LiteralPath $mobileApk -Algorithm SHA256).Hash.ToLowerInvariant();allResourceHashesVerified=$true;physicalDeviceTested=$false}
 $mobileReceipt|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $PSScriptRoot 'export/apk-resource-verification.json') -Encoding UTF8
 $mobileReceipt|ConvertTo-Json -Compress
}finally{$mobileZip.Dispose()}
