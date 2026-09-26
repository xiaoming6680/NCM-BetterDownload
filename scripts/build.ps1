param([switch]$Release)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pluginDir = Join-Path $projectRoot 'plugin'
$manifest = Get-Content -LiteralPath (Join-Path $pluginDir 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$links = Get-Content -LiteralPath (Join-Path $pluginDir 'release.json') -Raw -Encoding UTF8 | ConvertFrom-Json
& (Join-Path $PSScriptRoot 'restore-taglib.ps1')
if ($Release) {
    if ($manifest.author -eq '待填写' -or -not $manifest.author) { throw '请先填写 manifest.json 的 author。' }
    if ($links.repository -notmatch '^https://github\.com/[^/]+/[^/]+/?$' -or $links.issues -notmatch '^https://github\.com/[^/]+/[^/]+/issues/?$') { throw '请先填写 release.json 的 repository 和 issues。' }
}
$compiler = @(& (Join-Path $PSScriptRoot 'restore-compiler.ps1'))[-1]
# /deterministic: identical source gives an identical worker.exe on any machine. winexe: no console window can appear.
& $compiler /nologo /deterministic /debug- /target:winexe /platform:anycpu /optimize+ /reference:System.Web.Extensions.dll "/reference:$pluginDir/TagLibSharp.dll" "/out:$pluginDir/worker.exe" (Join-Path $projectRoot 'src/Worker.cs') (Join-Path $projectRoot 'src/Metadata.cs')
if ($LASTEXITCODE -ne 0) { throw 'C# 编译失败。' }
& (Join-Path $PSScriptRoot 'check-release.ps1') -Release:$Release
$dist = Join-Path $projectRoot 'dist'
[IO.Directory]::CreateDirectory($dist) | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
$label = if ($Release) { '' } else { '-dev' }
$archivePath = Join-Path $dist "BetterDownload-$($manifest.version)$label.plugin"
if (Test-Path -LiteralPath $archivePath) { Remove-Item -LiteralPath $archivePath }
$zip = [IO.Compression.ZipFile]::Open($archivePath, 'Create')
try {
    foreach ($name in @('manifest.json', 'download-hook.js', 'progress-card.js', 'lyrics.js', 'main.js', 'worker.exe', 'TagLibSharp.dll', 'TAGLIB-LICENSE', 'preview.jpg', 'release.json', 'LICENSE', 'NOTICE.md')) {
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $pluginDir $name), $name, 'Optimal') | Out-Null
    }
} finally { $zip.Dispose() }
Get-FileHash -LiteralPath $archivePath -Algorithm SHA256 | Format-List
Write-Output "Built: $archivePath"
