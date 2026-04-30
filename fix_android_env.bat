@echo off
set SDK_PATH=C:\Users\SURAJ YADAV\AppData\Local\Android
echo Setting ANDROID_HOME to %SDK_PATH%...
setx ANDROID_HOME "%SDK_PATH%"

echo Adding platform-tools and emulator to PATH...
:: Note: This adds to the User PATH. setx path can be tricky with long strings, 
:: but here we are just appending.
setx PATH "%PATH%;%SDK_PATH%\platform-tools;%SDK_PATH%\emulator"

echo.
echo SUCCESS: Environment variables updated!
echo IMPORTANT: Please close this terminal and open a NEW one for changes to take effect.
echo Then run: npx expo start --android
pause
