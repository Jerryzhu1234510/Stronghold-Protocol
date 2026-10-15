$ErrorActionPreference='Stop'
$mobileBuildDrive='Z:'
if(Test-Path "$mobileBuildDrive\"){throw 'Z: is already in use; choose an unused build drive.'}
# Android SDK native tools do not reliably handle a Unicode working directory.
& subst.exe $mobileBuildDrive $PSScriptRoot
if($LASTEXITCODE -ne 0){throw 'Temporary build drive could not be created.'}
try{
 $env:SP_MOBILE_BUILD_ROOT="$mobileBuildDrive\"
 & node.exe (Join-Path $PSScriptRoot 'build.mjs')
 if($LASTEXITCODE -ne 0){throw 'Android build failed.'}
}finally{
 Remove-Item Env:\SP_MOBILE_BUILD_ROOT -ErrorAction SilentlyContinue
 & subst.exe $mobileBuildDrive /D
}
