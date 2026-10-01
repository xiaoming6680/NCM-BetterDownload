# 工作程序构建来源

从 0.5.0 起，`plugin/worker.exe` 由固定版本的 Roslyn 编译器以 `/deterministic` 编译：NuGet 包 `Microsoft.Net.Compilers.Toolset` 5.9.0，包 SHA256 `B0227910320C5AF14D80EC32B5E1A759C1E3CC2EC12E7D9CC8862CF826BD9551`（与 NuGet 公布的 SHA512 一致）。同一份源码在任何 Windows 机器上运行 `npm run build`，都会得到逐字节相同的程序，可以自行重新构建并比对下表哈希。

`plugin/TagLibSharp.dll` 取自 NuGet `TagLibSharp` 2.3.0 包的 `lib/net462`，构建脚本会校验包的 SHA256。

| 文件 | SHA256 |
| --- | --- |
| worker.exe（0.7.0） | `30fa63cbb0bae14b5394a61f85a3b9eafc26381ed1741586d9f867b4b43c19dd` |
| TagLibSharp.dll | `b1833a41ab1e933f7b006e5db15300b7223bfccc2c3b6689d49a9171dd27de1d` |

仓库中的这两个文件与 GitHub Actions 的构建逐字节一致：提交 `0513737` 的 [Actions run 36851655970](https://github.com/xiaoming6680/NCM-BetterDownload/actions/runs/36851655970)，以及标签 v0.7.0 的 [Actions run 36851865626](https://github.com/xiaoming6680/NCM-BetterDownload/actions/runs/36851865626)（artifact `11156345563`），编出的 `worker.exe` 与上表哈希相同。

0.6.0 的 `worker.exe` SHA256 为 `4025e222c11579d701e7bd823b10432a10dd67c08b311d0daa532eac8e6e0d27`，与提交 `8ae319a` 的 [Actions run 36270856097](https://github.com/xiaoming6680/NCM-BetterDownload/actions/runs/36270856097) 构建逐字节一致。

0.5.0 的 `worker.exe` SHA256 为 `b67b9ead2ba44e6336f5380c47f2a458085195f587199cec6b393f21e3ae4bd4`，来源为提交 `5d11a58d6119db4c0651c72aeb382899cf625f37` 的 [Actions run 36041628440](https://github.com/xiaoming6680/NCM-BetterDownload/actions/runs/36041628440)（artifact `10826921260`）。

GitHub Actions 每次构建都会核对仓库中的 `worker.exe` 与本次编译结果是否一致；标签构建不一致时失败。发布附件以标签对应的 Actions 构建为准，构建信息与 SHA256SUMS 一并提供。

0.4.x 的 `worker.exe` 由 .NET Framework 自带的旧编译器构建，来源为提交 `7cb2286094b25f67d1280b0310a723045ac5ca49` 的 [Actions run 34150136265](https://github.com/xiaoming6680/NCM-BetterDownload/actions/runs/34150136265)（SHA256 `3a35f028e85604374756ffcc45622433a392203a01ea20994ab3183aa81a6f56`）。
