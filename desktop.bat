@echo off
pushd "%~dp0"

rem --- Node.js チェック／なければインストール ---
where node >nul 2>nul
if not errorlevel 1 goto :run
if exist "C:\Program Files\nodejs\node.exe" (
  set "PATH=%PATH%;C:\Program Files\nodejs"
  goto :run
)

echo Node.js が見つかりません。インストールを試みます...
where winget >nul 2>nul
if errorlevel 1 (
  echo winget が見つかりません。https://nodejs.org から Node.js LTS を手動インストールして再実行してください。
  pause
  exit /b 1
)
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements --silent
if errorlevel 1 (
  echo インストールに失敗しました。https://nodejs.org から Node.js LTS を手動インストールしてください。
  pause
  exit /b 1
)
set "PATH=%PATH%;C:\Program Files\nodejs"
where node >nul 2>nul
if errorlevel 1 (
  echo インストールは完了しました。このウィンドウを閉じて再度 desktop.bat を実行してください。
  pause
  exit /b 1
)

:run
set "ELECTRON_RUN_AS_NODE="

rem パッケージ済みexeがあればそちらを優先（タスクバー等が正しいアプリ名・アイコンになる）
if exist "dist\win-unpacked\AI Novelist Studio.exe" (
  start "" "dist\win-unpacked\AI Novelist Studio.exe"
  popd
  exit /b 0
)

rem --- exeが無い場合は従来通りelectronで起動 ---
npx electron .
set "RC=%ERRORLEVEL%"
popd
if not "%RC%"=="0" (
  echo.
  echo Electron の起動に失敗しました。ネットワークドライブ上では不安定な場合があります。
  echo フォルダをローカルディスクにコピーして実行するか、start.bat でブラウザでもご利用ください。
  pause
)
