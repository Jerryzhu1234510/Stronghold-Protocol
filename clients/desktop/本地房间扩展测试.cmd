@echo off
chcp 65001 >nul
cd /d "%~dp0"
start "" "卫戍协议.exe" --local-test
