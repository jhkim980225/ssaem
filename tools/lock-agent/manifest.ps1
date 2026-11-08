# build.bat 끝에 불린다. 잠금 프로그램이 1시간마다 보는 public/downloads/ssaem-lock.json (버전·SHA-256)을 만든다.
$root = Join-Path $PSScriptRoot "..\..\public\downloads"
$exe = Join-Path $root "ssaem-lock.exe"
$v = (Select-String -Path (Join-Path $PSScriptRoot "ssaem-lock.cs") -Pattern 'const string Version = "(.+?)"').Matches[0].Groups[1].Value
$h = (Get-FileHash -Algorithm SHA256 $exe).Hash.ToLower()
[IO.File]::WriteAllText((Join-Path $root "ssaem-lock.json"), "{`"v`":`"$v`",`"sha256`":`"$h`"}`n")
Write-Output "ssaem-lock.json: v$v $h"
