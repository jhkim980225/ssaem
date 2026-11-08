@echo off
rem Build with the .NET Framework 4 compiler that ships with Windows (nothing to install).
rem Output: public\downloads\ssaem-lock.exe  (see README.md)
set CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
if not exist "%~dp0..\..\public\downloads" mkdir "%~dp0..\..\public\downloads"
"%CSC%" /nologo /codepage:65001 /target:winexe /optimize+ /out:"%~dp0..\..\public\downloads\ssaem-lock.exe" /r:System.Windows.Forms.dll /r:System.Drawing.dll "%~dp0ssaem-lock.cs"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0manifest.ps1"
