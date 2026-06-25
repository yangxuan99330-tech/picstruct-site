@echo off
setlocal
cd /d "%~dp0"
echo PicStruct local preview
echo http://127.0.0.1:8788/
echo.
"C:\Program Files\nodejs\node.exe" dev-server.js
