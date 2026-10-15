@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "%~dp0icudtl.dat" goto incomplete
if not exist "%~dp0locales\zh-CN.pak" goto incomplete
if not exist "%~dp0resources\app\main.cjs" goto incomplete
if not exist "%~dp0resources\pack\assets.bin" goto incomplete
start "" "%~dp0卫戍协议.exe"
exit /b
:incomplete
echo 客户端文件不完整。请先将完整ZIP全部解压到一个文件夹。
echo 不要从压缩包内直接运行，也不要只取出EXE。
echo EXE旁边必须保留 icudtl.dat、locales 和 resources。
pause
