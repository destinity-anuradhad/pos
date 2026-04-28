@echo off
title Destinity Inspire POS - Publishing All Platforms
setlocal enabledelayedexpansion

echo ============================================================
echo   Destinity Inspire POS - Publishing All Platforms
echo ============================================================
echo.

:: ── Parse flags ─────────────────────────────────────────────────
set BUILD_WEB=1
set BUILD_WIN=1
set BUILD_APK=1

for %%A in (%*) do (
    if /i "%%A"=="web"     ( set BUILD_WIN=0 & set BUILD_APK=0 )
    if /i "%%A"=="windows" ( set BUILD_WEB=0 & set BUILD_APK=0 )
    if /i "%%A"=="android" ( set BUILD_WEB=0 & set BUILD_WIN=0 )
)

:: ── Create output folders ────────────────────────────────────────
echo [setup] Creating publish\ folders...
if not exist "%~dp0publish\web"     mkdir "%~dp0publish\web"
if not exist "%~dp0publish\windows" mkdir "%~dp0publish\windows"
if not exist "%~dp0publish\android" mkdir "%~dp0publish\android"
echo.

set ERRORS=0

:: ════════════════════════════════════════════════════════════════
:: 1. WEB BUILD
:: ════════════════════════════════════════════════════════════════
if %BUILD_WEB%==1 (
    echo ============================================================
    echo   [1/3] Building WEB
    echo ============================================================
    echo.

    echo   Building Angular production bundle...
    cd /d "%~dp0frontend"
    call ng build --configuration production
    if %errorlevel% neq 0 (
        echo   [ERROR] Angular build failed.
        set ERRORS=1
        goto web_done
    )

    echo   Copying to publish\web\ ...
    robocopy "%~dp0frontend\dist\frontend\browser" "%~dp0publish\web" /E /NFL /NDL /NJH /NJS >nul
    echo   [OK] Web build published to publish\web\
    :web_done
    echo.
)

:: ════════════════════════════════════════════════════════════════
:: 2. WINDOWS INSTALLER
:: ════════════════════════════════════════════════════════════════
if %BUILD_WIN%==1 (
    echo ============================================================
    echo   [2/3] Building WINDOWS Installer
    echo ============================================================
    echo.

    :: Angular build needed for electron-builder to bundle dist
    if %BUILD_WEB%==0 (
        echo   Building Angular production bundle (required for desktop^)...
        cd /d "%~dp0frontend"
        call ng build --configuration production
        if %errorlevel% neq 0 (
            echo   [ERROR] Angular build failed.
            set ERRORS=1
            goto win_done
        )
    )

    echo   Running electron-builder for Windows...
    cd /d "%~dp0electron"
    call npx electron-builder --win --publish never
    if %errorlevel% neq 0 (
        echo   [ERROR] electron-builder failed.
        set ERRORS=1
        goto win_done
    )

    echo   Copying installer to publish\windows\ ...
    for %%F in ("%~dp0electron\dist\*.exe") do (
        copy "%%F" "%~dp0publish\windows\" >nul
        echo   [OK] Copied %%~nxF to publish\windows\
    )
    if not exist "%~dp0publish\windows\*.exe" (
        echo   [WARN] No .exe found in electron\dist\ — check build output.
        set ERRORS=1
    )
    :win_done
    echo.
)

:: ════════════════════════════════════════════════════════════════
:: 3. ANDROID APK
:: ════════════════════════════════════════════════════════════════
if %BUILD_APK%==1 (
    echo ============================================================
    echo   [3/3] Building ANDROID APK
    echo ============================================================
    echo.

    :: Angular build needed for Capacitor sync
    if %BUILD_WEB%==0 (
        echo   Building Angular production bundle (required for APK^)...
        cd /d "%~dp0frontend"
        call ng build --configuration production
        if %errorlevel% neq 0 (
            echo   [ERROR] Angular build failed.
            set ERRORS=1
            goto apk_done
        )
    )

    echo   Syncing Capacitor...
    cd /d "%~dp0"
    call npx cap sync android
    if %errorlevel% neq 0 (
        echo   [ERROR] Capacitor sync failed.
        set ERRORS=1
        goto apk_done
    )

    echo   Running Gradle assembleDebug...
    cd /d "%~dp0android"
    call gradlew.bat assembleDebug
    if %errorlevel% neq 0 (
        echo   [ERROR] Gradle build failed.
        set ERRORS=1
        goto apk_done
    )

    set APK_SRC=%~dp0android\app\build\outputs\apk\debug\app-debug.apk
    if exist "!APK_SRC!" (
        copy "!APK_SRC!" "%~dp0publish\android\Destinity-Inspire-POS.apk" >nul
        echo   [OK] APK published to publish\android\Destinity-Inspire-POS.apk
    ) else (
        echo   [ERROR] APK not found at expected location.
        set ERRORS=1
    )
    :apk_done
    echo.
)

:: ════════════════════════════════════════════════════════════════
:: SUMMARY
:: ════════════════════════════════════════════════════════════════
echo ============================================================
echo   PUBLISH SUMMARY
echo ============================================================
if %BUILD_WEB%==1 (
    if exist "%~dp0publish\web\index.html" (
        echo   [OK] Web          publish\web\
    ) else (
        echo   [!!] Web          FAILED or skipped
    )
)
if %BUILD_WIN%==1 (
    if exist "%~dp0publish\windows\*.exe" (
        for %%F in ("%~dp0publish\windows\*.exe") do echo   [OK] Windows      publish\windows\%%~nxF
    ) else (
        echo   [!!] Windows      FAILED or skipped
    )
)
if %BUILD_APK%==1 (
    if exist "%~dp0publish\android\Destinity-Inspire-POS.apk" (
        echo   [OK] Android APK  publish\android\Destinity-Inspire-POS.apk
    ) else (
        echo   [!!] Android APK  FAILED or skipped
    )
)
echo ============================================================
echo.
if %ERRORS%==1 (
    echo   Some builds failed. Check output above.
) else (
    echo   All builds completed successfully!
)
echo.
echo   Other commands:
echo   publish.bat web      ^>  Web only
echo   publish.bat windows  ^>  Windows installer only
echo   publish.bat android  ^>  Android APK only
echo ============================================================
echo.
pause
