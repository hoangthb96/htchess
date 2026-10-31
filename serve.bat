@echo off
rem Host htchess on all interfaces (LAN + Tailscale). Double-click or run from cmd.
rem After starting, the game is at http://<this-machine-ip>:5272/chess
setlocal
cd /d "%~dp0"
set "DOTNET_ROOT=%USERPROFILE%\.dotnet"
set "ASPNETCORE_URLS=http://0.0.0.0:5272"
if not exist "publish\htchess.exe" (
    echo First run: publishing release build...
    "%DOTNET_ROOT%\dotnet.exe" publish htchess\htchess.csproj -c Release -o publish || exit /b 1
)
"publish\htchess.exe"
