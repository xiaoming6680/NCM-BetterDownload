# 商店更新说明

BetterDownload 0.7.0 新增支持旧版网易云 2.10.x（2.10.2 起），停在 2.10 的用户也能自动解锁下载的 VIP 歌曲；用“臻音全景声”下载的歌（MP4 封装的 Audio Vivid）现在也能解锁，原样取出为 `.m4a` 并写入封面、歌曲信息和歌词。卡片文案更简洁，提示与“打开文件夹”放在同一行。BetterNCM 最低版本从 1.3.4 降到 1.3.3（1.3.4 只更换了商店源，接口相同）。已在网易云 2.10.13 + BetterNCM 1.3.3 和 3.1.37 + BetterNCM 1.3.4 上实测。

- 源码：https://github.com/xiaoming6680/NCM-BetterDownload
- 发布：https://github.com/xiaoming6680/NCM-BetterDownload/releases/tag/v0.7.0
- 作者：XIAOMING6680
- `worker.exe` 由固定版本的 Roslyn 确定性编译，可按 [BUILD.md](BUILD.md) 重新构建并比对哈希。
- 版本安装包由标签对应的 Actions 构建，发布附件附构建信息与校验文件。

首次登记 #737 已合并；0.4.1 的同步 #750 已合并，商店目前仍是 0.4.1。0.5.0 的 #755 和 0.6.0 的 #757 尚未合并，0.7.0 包含 0.5.0、0.6.0 的全部内容，可关闭这两个、只合并 0.7.0 的。验证记录见 [VALIDATION.md](VALIDATION.md)。
