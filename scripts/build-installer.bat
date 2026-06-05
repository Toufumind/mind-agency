@echo off
REM Mind Agency Installer Builder
REM Requires: Inno Setup 6+ (https://jrsoftware.org/isinfo.php)
REM Or: NSIS (https://nsis.sourceforge.io/)

echo.
echo ========================================
echo   Mind Agency Installer Builder
echo ========================================
echo.

REM Check for Inno Setup
where iscc >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo [1/2] Building with Inno Setup...
    iscc "%~dp0..\installer\installer.iss"
    goto :done
)

REM Check for NSIS
where makensis >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo [1/2] Building with NSIS...
    makensis "%~dp0..\installer\installer.nsi"
    goto :done
)

echo.
echo ERROR: Neither Inno Setup nor NSIS found.
echo.
echo Install one of:
echo   Inno Setup: https://jrsoftware.org/isinfo.php
echo   NSIS:       https://nsis.sourceforge.io/
echo.
echo Or download portable Inno Setup:
echo   https://jrsoftware.org/files/isportable.exe
echo.
exit /b 1

:done
echo.
echo [2/2] Installer built successfully!
echo Output: dist-installer\Mind-Agency-Setup-0.4.0.exe
echo.
