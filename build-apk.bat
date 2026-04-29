@echo off
:: Destinity Inspire POS — Build debug APK
:: Run this from the project root after installing Android Studio

if "%ANDROID_HOME%"=="" (
  echo [ERROR] ANDROID_HOME is not set.
  echo Please install Android Studio and add it to your environment:
  echo   set ANDROID_HOME=C:\Users\%USERNAME%\AppData\Local\Android\Sdk
  echo   setx ANDROID_HOME "%%ANDROID_HOME%%"
  pause
  exit /b 1
)

:: Write local.properties for Gradle
echo sdk.dir=%ANDROID_HOME:\=\\% > android\local.properties
echo [OK] local.properties written: %ANDROID_HOME%

:: Build Angular + sync Capacitor + compile APK
echo.
echo [1/3] Building Angular production bundle...
cd frontend && call ng build --configuration production && cd ..

echo.
echo [2/3] Syncing Capacitor to Android...
call npx cap sync android

echo.
echo [3/3] Building debug APK...
cd android && gradlew.bat assembleDebug && cd ..

echo.
if exist android\app\build\outputs\apk\debug\app-debug.apk (
  echo [SUCCESS] APK built:
  echo   android\app\build\outputs\apk\debug\app-debug.apk
) else (
  echo [FAILED] APK not found — check Gradle output above.
)
pause
