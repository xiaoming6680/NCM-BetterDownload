# BetterDownload 发布流程

源码仓库：[xiaoming6680/NCM-BetterDownload](https://github.com/xiaoming6680/NCM-BetterDownload)。作者：XIAOMING6680。

## 构建与分发

1. 修改代码后同步递增 `plugin/manifest.json` 和 `package.json` 版本。
2. 推送 `main`，等待 `Build and test plugin` 工作流通过。工作流编译程序、验证依赖哈希、运行测试并生成源码包。
3. 下载 `BetterDownload` artifact。`dist/build-info.json` 记录对应源码提交与构建地址，`dist/SHA256SUMS.txt` 记录产物哈希。
4. 商店同步源码仓库的 `plugin/` 目录。构建是确定性的，本地 `npm run build` 与 Actions 编出的 `worker.exe` 逐字节相同；源码改动后把重新构建的程序和源码一起提交：

```powershell
git add -f plugin/worker.exe plugin/TagLibSharp.dll
git commit -m 'Update worker build'
git push
```

工作流的 “Check committed binaries match this source” 步骤会核对仓库中的程序：普通推送不一致时给出警告，标签构建不一致时失败。

5. 推送 `v版本号` 标签后，工作流还会生成正式命名的 `.plugin`。将该 Actions 产物、源码包与校验文件作为 GitHub Release 附件；未经完整客户端验收的版本标记为 Pre-release。

工作程序与依赖变化时必须递增版本，避免使用之前版本的运行副本。

## 客户端验收

已知设置页加载环境为 BetterNCM 1.3.4。下载接口对照网易云 3.1.37 和 2.10.13 的前端资源核对：3.x 从 webpack 模块里的 SDK 订阅，2.10.x 用网易云自带的 `legacyNativeCmder` 订阅，事件都是 `storage.onaddid3done`。完整下载链路需在发布前分别在 3.x 和 2.10.x 上验收：

- NCM 内分别为 FLAC 和 MP3 的下载均能转换、播放并显示内嵌封面和中文标签。
- 3.x 用“臻音全景声”下载的歌转换为 `.m4a`，音频包与原始数据一致，卡片提示多数播放器不支持。
- 输出位于 `VipSongsDownload/unlock`，保留源文件和歌手子目录，同名输出不覆盖。
- 验证下载失败、暂停恢复、连续下载、修改下载位置、启停及常用主题兼容性。
- 普通 FLAC / MP3 不触发转换。
- 卡片闲置后完全退出，点击文件夹或窗口失焦后不会卡住。

## BetterNCM 商店投稿

遵循[官方投稿流程](https://github.com/BetterNCM/BetterNCM-Plugins#插件提交及更新)与[上架准则](https://github.com/std-microblock/chromatic/wiki/插件商店上架插件方式及准则)。原生工作程序使用 Actions 编译，插件目录中保留运行文件、预览图与必要许可证。

向官方库 `plugins-list/ncm-better-download.json` 提交以下登记内容：

```json
{
  "name": "BetterDownload",
  "repo": "xiaoming6680/NCM-BetterDownload",
  "branch": "main",
  "subpath": "/plugin",
  "author": "XIAOMING6680"
}
```

PR 附对应源码 commit、Actions run 和真实客户端验收结果。初次上架经维护者审核后，官方脚本会定期检查 manifest 版本更新。投稿正文草稿见 [STORE-PR.md](STORE-PR.md)。

## 本地维护工具

`scripts/check-release.ps1 -Release` 检查版本、作者、仓库链接、运行文件和许可证；`scripts/package-source.ps1` 生成不含运行数据和二进制的源码包。`scripts/configure-release.ps1` 可在仓库迁移时更新作者及链接信息。

TagLibSharp 2.3.0 为未修改的 LGPL 依赖，附带许可证与对应源码链接。保留可替换 DLL 的结构。
