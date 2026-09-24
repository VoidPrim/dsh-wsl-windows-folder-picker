# dsh-wsl-windows-folder-picker

[English](README.md) | **中文**

在 WSL 环境下使用 dsh 时，使用 Windows 的文件夹选择对话框。

装完之后，「添加工作区」打开的是 Windows 的文件夹选择对话框。

## 安装

要求 dsh `>=0.1.7-rc.1`。

```bash
dsh plugin --profile web add github:VoidPrim/dsh-wsl-windows-folder-picker
```

装完重启 dsh，然后刷新页面：

```bash
dsh web
```

卸载：

```bash
dsh plugin --profile web remove dsh-wsl-windows-folder-picker
```

升级 dsh 会重建 profile 组合，插件会被移除，升级后重新安装一次即可。

安装其他插件同样可能重置 profile 的 bundle 列表，把本插件挤掉。若发现对话框不再弹出，检查 profile 的 `package.json` 里本插件是否列在 `dsh.profile.bundles` 中——只出现在 `dependencies` 而不在 `bundles` 里，条目不会被组合。

## 许可

MIT
