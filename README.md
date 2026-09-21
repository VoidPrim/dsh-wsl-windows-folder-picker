# dsh-wsl-windows-folder-picker

**English** | [中文](README_cn.md)

Use the Windows folder dialog when using dsh under WSL.

Once installed, "Add workspace" opens the Windows folder dialog, and it can be toggled anytime in Settings.

## Install

Requires dsh `>=0.1.5-rc.2`.

```bash
dsh plugin --profile web add github:VoidPrim/dsh-wsl-windows-folder-picker
```

Restart dsh after installing, then refresh the page:

```bash
dsh web
```

Uninstall:

```bash
dsh plugin --profile web remove dsh-wsl-windows-folder-picker
```

## Settings

Settings gains a "Windows folder picker" page:

![Settings page](assets/settings.png)

| Option | Default | Description |
| --- | --- | --- |
| Use the Windows folder picker | On | Turn off to return to the default |
| Remember last location | On | Start from the last chosen folder next time |
| Dialog timeout | 5 minutes | Close the dialog automatically on timeout, or set to no limit |

## License

MIT
