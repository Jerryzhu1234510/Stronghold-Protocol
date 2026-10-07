@echo off
rem 列出正在运行的服务器实例（端口 / 版本 / 前端指纹 / 进程 / 人数）。只读：不重启、不杀进程。
rem 用途：确认「我连的是哪一版」——端口上可能还跑着另一个目录里的旧副本（docs\DEPLOY.md）。
rem 等价命令：node tools\whats-running.mjs [端口…]
chcp 65001 >nul
setlocal EnableExtensions
title 卫戍协议：盟约 - 正在运行的实例
cd /d "%~dp0.."

where node >nul 2>nul
if errorlevel 1 goto :nonode

node tools\whats-running.mjs %*
set "CODE=%ERRORLEVEL%"
echo.
if defined SP_NO_PAUSE exit /b %CODE%
pause
exit /b %CODE%

:nonode
echo.
echo 未找到 Node.js（需要 22 或更高，22 / 24 LTS）。Node.js not found.
echo   安装：winget install OpenJS.NodeJS.LTS   或   https://nodejs.org/zh-cn/download
echo.
pause
exit /b 1
