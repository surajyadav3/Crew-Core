# This script sets the Android SDK environment variables for the current user.
$SDK_PATH = "C:\Users\SURAJ YADAV\AppData\Local\Android"

Write-Host "Setting ANDROID_HOME to $SDK_PATH..." -ForegroundColor Cyan
[System.Environment]::SetEnvironmentVariable("ANDROID_HOME", $SDK_PATH, "User")

$oldPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
$platformTools = "$SDK_PATH\platform-tools"
$emulator = "$SDK_PATH\emulator"

$newPath = $oldPath
if ($oldPath -notlike "*$platformTools*") {
    Write-Host "Adding platform-tools to Path..." -ForegroundColor Cyan
    $newPath = "$newPath;$platformTools"
}

if ($oldPath -notlike "*$emulator*") {
    Write-Host "Adding emulator to Path..." -ForegroundColor Cyan
    $newPath = "$newPath;$emulator"
}

if ($newPath -ne $oldPath) {
    [System.Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    Write-Host "Path updated successfully." -ForegroundColor Green
} else {
    Write-Host "Path already contains the necessary directories." -ForegroundColor Yellow
}

Write-Host "`nSUCCESS: Environment variables updated!" -ForegroundColor Green
Write-Host "IMPORTANT: Please close this terminal and open a NEW one for changes to take effect." -ForegroundColor Cyan
Write-Host "Then run: npx expo start --android" -ForegroundColor White
