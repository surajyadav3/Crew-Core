@echo off
set "ADB_PATH=C:\Users\SURAJ YADAV\AppData\Local\Android\platform-tools\adb.exe"
echo Resetting ADB server...
"%ADB_PATH%" kill-server
"%ADB_PATH%" start-server
echo.
echo Setting up port reverse for Metro...
"%ADB_PATH%" reverse tcp:8081 tcp:8081
echo.
echo Checking connected devices...
"%ADB_PATH%" devices
echo.
echo If the device still shows as 'offline', please restart your Android Emulator.
"%ADB_PATH%" reconnect offline
pause
