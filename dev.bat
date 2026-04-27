@echo off
title Destinity Inspire POS - Dev Server

echo ============================================
echo   Destinity Inspire POS - Starting Dev...
echo ============================================
echo.

:: ---- Check for Android build flag ----
set BUILD_ANDROID=0
set BUILD_APK=0
for %%A in (%*) do (
    if /i "%%A"=="android"       set BUILD_ANDROID=1
    if /i "%%A"=="apk"           set BUILD_APK=1
)

:: ---- Install Python backend dependencies ----
echo [1/5] Checking Python backend dependencies...
cd /d %~dp0backend
python -m pip show flask >nul 2>&1
if %errorlevel% neq 0 (
    echo       Installing Python packages...
    python -m pip install -r requirements.txt --quiet --no-warn-script-location
    echo       Python packages installed.
) else (
    echo       Already installed. Skipping.
)
echo.

:: ---- Install root npm packages (Capacitor etc.) ----
echo [2/5] Checking root npm packages...
cd /d %~dp0
if not exist node_modules (
    echo       Running npm install at root...
    npm install --silent
    echo       Root packages installed.
) else (
    echo       Already installed. Skipping.
)
echo.

:: ---- Install Angular frontend packages ----
echo [3/5] Checking Angular frontend packages...
cd /d %~dp0frontend
if not exist node_modules (
    echo       Running npm install in frontend...
    npm install --silent
    echo       Frontend packages installed.
) else (
    echo       Already installed. Skipping.
)
echo.

:: ---- Install Electron packages ----
echo [4/5] Checking Electron packages...
cd /d %~dp0electron
if not exist node_modules (
    echo       Running npm install in electron...
    npm install --silent
    echo       Electron packages installed.
) else (
    echo       Already installed. Skipping.
)
echo.

:: ========================================
:: ANDROID BUILD MODE
:: ========================================
if %BUILD_ANDROID%==1 goto android_open
if %BUILD_APK%==1 goto android_apk

:: ---- Start all DEV services ----
echo [5/5] Starting all services...
echo.

echo   Starting Python Backend  (port 8000)...
start "POS Backend"  cmd /k "cd /d %~dp0backend && python main.py"

timeout /t 3 /nobreak >nul

echo   Starting Angular Frontend (port 4200)...
start "POS Frontend" cmd /k "cd /d %~dp0frontend && ng serve --port 4200"

timeout /t 3 /nobreak >nul

echo   Starting Electron Desktop...
start "POS Electron" cmd /k "cd /d %~dp0electron && npx electron ."

echo.
echo ============================================
echo   All services started!
echo   Frontend  : http://localhost:4200
echo   Backend   : http://localhost:8000
echo   API Docs  : http://localhost:8000/docs
echo ============================================
echo.
echo   Other commands:
echo   dev.bat android  ^>  Build ^& open in Android Studio
echo   dev.bat apk      ^>  Build debug APK file
echo ============================================
echo.
echo   Close this window or press any key to exit.
pause >nul
goto :eof

:: ========================================
:: ANDROID STUDIO (open project)
:: ========================================
:android_open
echo ============================================
echo   Building for Android (Android Studio)
echo ============================================
echo.
echo [1/3] Building Angular production bundle...
cd /d %~dp0frontend
call ng build --configuration production
if %errorlevel% neq 0 ( echo [ERROR] Angular build failed. & pause & exit /b 1 )
echo       Done.
echo.

echo [2/3] Syncing Capacitor...
cd /d %~dp0
call npx cap sync android
if %errorlevel% neq 0 ( echo [ERROR] Capacitor sync failed. & pause & exit /b 1 )
echo       Done.
echo.

echo [3/3] Opening Android Studio...
call npx cap open android
echo.
echo ============================================
echo   Android Studio is opening.
echo   Press Run (triangle) to launch on device
echo   or emulator.
echo ============================================
pause
goto :eof

:: ========================================
:: BUILD DEBUG APK
:: ========================================
:android_apk
echo ============================================
echo   Building Debug APK
echo ============================================
echo.
echo [1/3] Building Angular production bundle...
cd /d %~dp0frontend
call ng build --configuration production
if %errorlevel% neq 0 ( echo [ERROR] Angular build failed. & pause & exit /b 1 )
echo       Done.
echo.

echo [2/3] Syncing Capacitor...
cd /d %~dp0
call npx cap sync android
if %errorlevel% neq 0 ( echo [ERROR] Capacitor sync failed. & pause & exit /b 1 )
echo       Done.
echo.

echo [3/3] Building APK with Gradle...
cd /d %~dp0android
call gradlew.bat assembleDebug
if %errorlevel% neq 0 ( echo [ERROR] Gradle build failed. & pause & exit /b 1 )

echo.
echo ============================================
echo   APK built successfully!
echo   Location:
echo   android\app\build\outputs\apk\debug\
echo                    app-debug.apk
echo ============================================
echo.

:: Open the output folder
start explorer "%~dp0android\app\build\outputs\apk\debug"
pause
goto :eof
