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

## 许可

MIT
