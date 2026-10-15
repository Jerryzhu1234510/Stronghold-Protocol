@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Please start the local 0.2.5 server first. Default port: 27625.
"%~dp0卫戍协议.exe" --local-test
