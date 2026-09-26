# 商店更新说明

BetterDownload 0.6.0 新增可选的歌词写入（默认关闭）：打开后从网易云获取这首歌的歌词，与封面、歌曲信息一起写入 FLAC / MP3，可选同时保存 `.lrc` 和附带翻译；需要联网，只访问网易云自己的歌词接口。纯音乐不写入，歌词获取失败时歌曲照常转换。预览图换成当前图标。

- 源码：https://github.com/xiaoming6680/NCM-BetterDownload
- 发布：https://github.com/xiaoming6680/NCM-BetterDownload/releases/tag/v0.6.0
- 作者：XIAOMING6680
- `worker.exe` 由固定版本的 Roslyn 确定性编译，可按 [BUILD.md](BUILD.md) 重新构建并比对哈希。
- 版本安装包由标签对应的 Actions 构建，发布附件附构建信息与校验文件。

首次登记 #737 已合并；0.4.1 同步申请为 #750。0.5.0 的同步申请 #755 尚未合并，0.6.0 包含它的全部内容。自动化验证见 [VALIDATION.md](VALIDATION.md)。
