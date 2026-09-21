# 更新日志

本项目遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [0.1.0] — 2026-09-21

首个版本。此前以 `0.1.0-Alpha` 预发布，本次转为正式版本，同时完成了一轮代码审阅。

### 修复

- **`powershell.exe` 查找不再提前返回，互操作不可用时能正确报告。** 原实现只要检测到 WSL 就立即返回候选名 `powershell.exe`，不再验证它是否真的能执行。后果是 interop 被关闭（或 Windows PATH 未挂载）时，`windowsPickerAvailable()` 仍返回 `true`：设置页不显示"互操作不可用"提示，用户点「添加工作区」才在 `execFile` 处收到 `ENOENT`。现在每个候选都必须通过可执行性验证，且优先检查 Windows PowerShell 的已知绝对路径——那是直接证据，而非推断。
- **`package.json` 的 Node 版本要求从 `>=18` 改为 `>=18.17.0`。** `AbortSignal.any` 自 Node 18.17.0 起可用，原声明覆盖了尚不支持该 API 的 18.0–18.16。
- **`pickMac` 删除了一个无效分支。** 原先判断取消的正则分支与紧随其后的兜底分支返回完全相同的值，正则从未产生作用。

### 变更

- **新增 `lib/anchorRequire`，消除重复的模块解析逻辑。** `index.js` 与 `backend.js` 原本各写一份 `createRequire(new URL('package.json', baseUrl).href)`；现在统一走 `backend.js` 导出的这一函数，各自的错误策略（降级返回 `undefined` / 抛错）留在调用处。
- 精简了各处注释，删去"为什么没走另一条路"的设计论证，保留"为什么这样写"的必要说明。
- 收敛了仅供内部使用的导出：`backend.js` 的 `name` 与 `createWindowsCapability`、`index.js` 的 `DEFAULT_ENABLED` 与 `DEFAULT_TIMEOUT_SECONDS`。`backend.js` 并非插件入口，导出 `name` 会误导读者以为它可以直接挂载。
- 客户端对话框超时的默认值提取为 `DEFAULT_TIMEOUT_SECONDS` 常量，不再在多处重复字面量 `300`。
- 文档改为英文为主（`README.md`），中文版移至 `README_cn.md`，两页顶部互相链接。

### 新增

- 在 WSL 中调用 Windows 的文件夹选择对话框（`IFileDialog` + `FOS_PICKFOLDERS`），选中的路径经 `wslpath -u` 转回 WSL 路径。
- 独立的设置页面，含三项：总开关、记住上次位置、对话框超时。
- 依次降级的三种选择器：现代外壳对话框 → WinForms `FolderBrowserDialog` → `Shell.Application` COM 浏览器。
- 找不到 `powershell.exe` 时自动退回 dsh 内置的网页目录浏览器。

### 说明

- 目录选择器在**新建的 STA 线程**中打开。从 WSL 启动的 `powershell.exe`，其主线程首选 UI 语言取自用户的*区域*列表而非*显示*语言，会让外壳控件显示为英文（`Select Folder`、`Cancel`）；新线程按真正的显示语言解析。
- 宿主端只提供一个 `ctx.directoryPicker` 能力，`kind` 每次调用时现读；浏览器端通过槽位优先级（`-1` 压过内置界面的 `0`）实时接管或让位，运行时不挂载或卸载任何包。

[0.1.0]: https://github.com/VoidPrim/dsh-wsl-windows-folder-picker/commit/9644cc7725c0e3627f784ce376dad3b2290b6eab
