param([switch]$Release)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pluginDir = Join-Path $projectRoot 'plugin'
$manifest = Get-Content -LiteralPath (Join-Path $pluginDir 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$package = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$links = Get-Content -LiteralPath (Join-Path $pluginDir 'release.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.version -ne $package.version -or $manifest.version -notmatch '^\d+\.\d+\.\d+$') { throw '插件与 package.json 版本必须一致，并使用 x.y.z 格式。' }
if ($manifest.name -ne 'BetterDownload' -or $manifest.slug -ne 'ncm-better-download') { throw '名称应为 BetterDownload；保留现有 slug 以支持开发版升级。' }
if ([string]::IsNullOrWhiteSpace($manifest.author) -or $manifest.author -eq '待填写') { throw '请填写插件作者。' }
foreach ($file in @('manifest.json','main.js','download-hook.js','progress-card.js','lyrics.js','worker.exe','TagLibSharp.dll','preview.jpg','release.json','LICENSE','TAGLIB-LICENSE','NOTICE.md')) {
    if (-not (Test-Path -LiteralPath (Join-Path $pluginDir $file) -PathType Leaf)) { throw "插件缺少 $file" }
}
foreach ($inject in $manifest.injects.Main) {
    if ($inject.file -notmatch '^[\w.-]+\.js$' -or -not (Test-Path -LiteralPath (Join-Path $pluginDir $inject.file))) { throw '无效的注入脚本路径。' }
}
if ((Get-Item -LiteralPath (Join-Path $pluginDir 'preview.jpg')).Length -gt 200KB) { throw '预览图过大。' }
$repositoryReady = $links.repository -match '^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/?$'
$feedbackReady = $repositoryReady -and $links.issues -eq ($links.repository.TrimEnd('/') + '/issues')
if (-not $repositoryReady -or -not $feedbackReady) {
    if ($Release) { throw '源码仓库和 Issues 地址尚未配置。请创建真实仓库后运行 configure-release.ps1。' }
    Write-Output 'PENDING: 源码仓库和 Issues 地址；当前只能分发开发包。'
}
Write-Output "PASS: $($manifest.name) $($manifest.version), author $($manifest.author), version, runtime files, licenses, preview and injects."
