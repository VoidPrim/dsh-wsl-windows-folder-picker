# dsh-wsl-windows-folder-picker

**English** | [中文](README_cn.md)

Use the Windows folder dialog when using dsh under WSL.

Once installed, "Add workspace" opens the Windows folder dialog.

## Install

Requires dsh `>=0.1.7-rc.1`.

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

Upgrading dsh rebuilds the profile composition, which drops this plugin. Install it again afterwards.

Installing a different plugin can also reset the profile's bundle list and drop this one. If the picker stops working, check that the plugin is listed under `dsh.profile.bundles` in the profile's `package.json`, not just in `dependencies` — an entry that is a dependency but not a bundle is never composed.

## License

MIT
