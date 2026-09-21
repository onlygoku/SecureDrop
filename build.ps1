$ErrorActionPreference = 'Stop'

# tkinterdnd2 ships Tcl assets that must be bundled with the application.
py -m PyInstaller --noconfirm --clean --windowed --name SecureDrop --collect-data tkinterdnd2 app.py

Write-Host "Build complete: dist\SecureDrop\SecureDrop.exe"
