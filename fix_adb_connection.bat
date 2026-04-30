@echo off
echo Resetting ADB server...
"C:\MainSDK\platform-tools\adb.exe" kill-server
"C:\MainSDK\platform-tools\adb.exe" start-server
echo.
echo Checking connected devices...
"C:\MainSDK\platform-tools\adb.exe" devices
echo.
echo If the device still shows as 'offline', please restart your Android Emulator.
echo You can also try: "C:\MainSDK\platform-tools\adb.exe" reconnect offline
pause
