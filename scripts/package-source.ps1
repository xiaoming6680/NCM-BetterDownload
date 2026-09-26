$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $projectRoot 'plugin/manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$dist = Join-Path $projectRoot 'dist'
[IO.Directory]::CreateDirectory($dist) | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archivePath = Join-Path $dist "BetterDownload-$($manifest.version)-source.zip"
if (Test-Path -LiteralPath $archivePath) { Remove-Item -LiteralPath $archivePath }
$zip = [IO.Compression.ZipFile]::Open($archivePath, 'Create')
try {
    $files = @('README.md','LICENSE','CHANGELOG.md','package.json','.gitignore','.gitattributes') | ForEach-Object { Get-Item -LiteralPath (Join-Path $projectRoot $_) }
    foreach ($folder in @('src','scripts','tests','docs','.github','plugin')) { $files += Get-ChildItem -LiteralPath (Join-Path $projectRoot $folder) -File -Recurse }
    foreach ($file in $files) {
        $relative = $file.FullName.Substring($projectRoot.Length + 1).Replace('\','/')
        if ($relative -match '^plugin/' -and $relative -notin @('plugin/manifest.json','plugin/main.js','plugin/download-hook.js','plugin/progress-card.js','plugin/lyrics.js','plugin/preview.jpg','plugin/release.json','plugin/LICENSE','plugin/TAGLIB-LICENSE','plugin/NOTICE.md')) { continue }
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $relative, 'Optimal') | Out-Null
    }
} finally { $zip.Dispose() }
Get-FileHash -LiteralPath $archivePath -Algorithm SHA256 | Format-List
Write-Output "Source: $archivePath"
