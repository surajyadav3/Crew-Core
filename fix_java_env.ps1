# This script sets the JAVA_HOME environment variable for the current user.
$JAVA_PATH = "C:\Program Files\Android\Android Studio\jbr"

if (Test-Path $JAVA_PATH) {
    Write-Host "Setting JAVA_HOME to $JAVA_PATH..." -ForegroundColor Cyan
    [System.Environment]::SetEnvironmentVariable("JAVA_HOME", $JAVA_PATH, "User")

    $oldPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
    $javaBin = "$JAVA_PATH\bin"

    if ($oldPath -notlike "*$javaBin*") {
        Write-Host "Adding Java bin to Path..." -ForegroundColor Cyan
        $newPath = "$oldPath;$javaBin"
        [System.Environment]::SetEnvironmentVariable("Path", $newPath, "User")
        Write-Host "Path updated successfully." -ForegroundColor Green
    } else {
        Write-Host "Java bin already in Path." -ForegroundColor Yellow
    }

    Write-Host "`nSUCCESS: JAVA_HOME is set!" -ForegroundColor Green
    Write-Host "IMPORTANT: Please close this terminal and open a NEW one for changes to take effect." -ForegroundColor Red
} else {
    Write-Host "ERROR: Could not find Java at $JAVA_PATH" -ForegroundColor Red
    Write-Host "Please verify that Android Studio is installed correctly." -ForegroundColor Yellow
}
