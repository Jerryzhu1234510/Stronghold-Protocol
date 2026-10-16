@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 仅本机测试：http://127.0.0.1:27630/
echo 关闭窗口停止本地服务。正式服务器不会被修改。
"%~dp0runtime\node.exe" "%~dp0tools\local-030.mjs"
pause
