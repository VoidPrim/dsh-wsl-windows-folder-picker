/**
 * dsh-wsl-windows-folder-picker — the Windows-backed directory-picker backend.
 *
 * Builds the `directoryPicker` capability of kind `native`: it runs
 * `powershell.exe` through WSL interop and drives the modern shell dialog
 * (IFileDialog with FOS_PICKFOLDERS). The picked Windows path is translated back
 * with `wslpath -u`.
 *
 * Exports factories rather than a Cordis plugin so `index.js` can pick one mode.
 *
 * @module dsh-wsl-windows-folder-picker/backend
 */

import { execFile } from 'node:child_process'
import { release } from 'node:os'
import { accessSync, constants } from 'node:fs'
import { createRequire } from 'node:module'
import { delimiter, join } from 'node:path'

/** Output markers the PowerShell script prints on stdout. */
const OK = 'DSHOK|'
const CANCEL = 'DSHCANCEL'
const ERR = 'DSHERR|'

/** Dialog title, kept in one place. */
const TITLE = '选择工作区文件夹'

/**
 * How long the Windows chooser may stay open before the pick is abandoned.
 * An operator who leaves the dialog open while doing something else must not
 * pin the pick forever, but the cap has to be generous enough that reading a
 * directory listing first is never mistaken for a stall.
 */
const DEFAULT_TIMEOUT_MS = 300_000

/**
 * Inline C# driving the modern Windows folder picker. `IFileDialog` opened with
 * FOS_PICKFOLDERS is the shell dialog Explorer itself uses, so the operator gets
 * the familiar places sidebar, breadcrumb bar, and search box rather than the
 * legacy tree dialog. Compiled at runtime by `Add-Type`, which is why the whole
 * script must stay ASCII-only (it is shipped as a UTF-16LE `-EncodedCommand`).
 */
const CSHARP = [
  'using System;',
  'using System.Runtime.InteropServices;',
  '',
  'public static class DshWinFolderPicker {',
  '  [ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
  '  interface IFileDialog {',
  '    [PreserveSig] int Show(IntPtr parent);',
  '    void SetFileTypes(uint c, IntPtr f);',
  '    void SetFileTypeIndex(uint i);',
  '    void GetFileTypeIndex(out uint i);',
  '    void Advise(IntPtr e, out uint c);',
  '    void Unadvise(uint c);',
  '    void SetOptions(uint o);',
  '    void GetOptions(out uint o);',
  '    void SetDefaultFolder(IShellItem i);',
  '    void SetFolder(IShellItem i);',
  '    void GetFolder(out IShellItem i);',
  '    void GetCurrentSelection(out IShellItem i);',
  '    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string n);',
  '    void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string n);',
  '    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string t);',
  '    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string t);',
  '    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string t);',
  '    void GetResult(out IShellItem i);',
  '    void AddPlace(IShellItem i, int f);',
  '    void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string e);',
  '    void Close(int hr);',
  '    void SetClientGuid(ref Guid g);',
  '    void ClearClientData();',
  '    void SetFilter(IntPtr f);',
  '    void GetResults(out IntPtr i);',
  '    void GetSelectedItems(out IntPtr i);',
  '  }',
  '  [ComImport, Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
  '  interface IShellItem {',
  '    void BindToHandler(IntPtr p, ref Guid b, ref Guid r, out IntPtr o);',
  '    void GetParent(out IShellItem p);',
  '    void GetDisplayName(uint sig, [MarshalAs(UnmanagedType.LPWStr)] out string n);',
  '    void GetAttributes(uint m, out uint a);',
  '    void Compare(IShellItem i, uint h, out int o);',
  '  }',
  '  [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")]',
  '  class FolderPickerDialog { }',
  '  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]',
  '  static extern void SHCreateItemFromParsingName(string path, IntPtr bind, ref Guid riid, out IShellItem item);',
  '  public static string Pick(string title, string initial) {',
  '    IFileDialog d = (IFileDialog)new FolderPickerDialog();',
  '    d.SetOptions(0x20u | 0x40u | 0x800u);',
  '    d.SetTitle(title);',
  '    if (initial != null && initial.Length > 0) {',
  '      try {',
  '        Guid g = new Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe");',
  '        IShellItem item;',
  '        SHCreateItemFromParsingName(initial, IntPtr.Zero, ref g, out item);',
  '        d.SetFolder(item);',
  '      } catch { }',
  '    }',
  '    int hr = d.Show(IntPtr.Zero);',
  '    if (hr == unchecked((int)0x800704C7)) return null;',
  '    if (hr != 0) throw new COMException("folder dialog failed with 0x" + hr.ToString("X8"), hr);',
  '    IShellItem result;',
  '    d.GetResult(out result);',
  '    string path;',
  '    result.GetDisplayName(0x80058000, out path);',
  '    return path;',
  '  }',
  '}',
].join('\n')

/**
 * Resolve one module through the profile's own module scope.
 *
 * A `link:`-installed plugin has no `node_modules` beside its source, so a bare
 * import fails even for packages dsh itself ships. `ctx.baseUrl` is the profile
 * directory, whose scope reaches everything the profile can see.
 *
 * @param ctx - Host plugin context carrying `baseUrl`.
 * @param specifier - package name to resolve.
 * @returns the loaded module.
 * @throws when `baseUrl` is unavailable or the package cannot be resolved.
 */
export function anchorRequire(ctx, specifier) {
  const baseUrl = ctx.baseUrl
  if (typeof baseUrl !== 'string' || baseUrl.length === 0) {
    throw new Error(
      'dsh-wsl-windows-folder-picker: ctx.baseUrl is unavailable, so "' + specifier + '" cannot be resolved',
    )
  }
  return createRequire(new URL('package.json', baseUrl).href)(specifier)
}

/**
 * Whether this Linux host is actually WSL, so Windows interop is reachable.
 * @returns true when the process runs inside a WSL distribution.
 */
function isWsl() {
  if (process.platform !== 'linux') return false
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP || process.env.WSLENV) return true
  try {
    return release().toLowerCase().includes('microsoft')
  } catch {
    return false
  }
}

/** Whether one candidate path is an executable file. */
function isExecutableFile(candidate) {
  try {
    accessSync(candidate, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Locate a runnable PowerShell. Every candidate must be *proven* executable,
 * because {@link windowsPickerAvailable} trusts this answer: WSL interop can be
 * disabled while a bare `powershell.exe` still satisfies a PATH probe, and
 * `execFile` would then fail with `ENOENT` only when the user tries to pick.
 *
 * @returns a runnable PowerShell path or name, or undefined.
 */
function findPowerShell() {
  const wellKnown =
    process.platform === 'win32'
      ? []
      : [
          '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',
          '/mnt/c/Windows/SysWOW64/WindowsPowerShell/v1.0/powershell.exe',
          '/mnt/c/Program Files/PowerShell/7/pwsh.exe',
        ]
  const pathValue = process.env.PATH ?? ''
  const dirs = pathValue.split(delimiter).filter((dir) => dir !== '')

  // Absolute locations first: they are evidence, not inference, so a host whose
  // PATH lost the interop entry still finds a usable chooser.
  for (const candidate of wellKnown) {
    if (isExecutableFile(candidate)) return candidate
  }
  for (const candidate of ['powershell.exe', 'pwsh.exe']) {
    if (dirs.some((dir) => isExecutableFile(join(dir, candidate)))) return candidate
  }
  return undefined
}

/**
 * Build the ASCII-only PowerShell program. Non-ASCII text (the dialog title and
 * the starting folder) travels as base64 and is decoded inside PowerShell,
 * because raw non-ASCII argv would be mangled by the ANSI code page.
 * @param title - dialog title.
 * @param initial - Windows path to preselect, or an empty string.
 * @returns the script text.
 */
function buildScript(title, initial) {
  const b64 = (text) => Buffer.from(text, 'utf8').toString('base64')
  return [
    "$ProgressPreference='SilentlyContinue'",
    '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8',
    "$title=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" + b64(title) + "'))",
    "$initial=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" + b64(initial) + "'))",
    "$cs=@'",
    CSHARP,
    "'@",
    // Every chooser runs inside ONE fresh STA runspace instead of PowerShell's own
    // main thread. That is what decides the dialog's language: a `powershell.exe`
    // launched from WSL fixes its main thread's preferred UI language to the
    // user's *locale* list rather than their *display* language, so the shell
    // chrome renders in English (Organize / New folder / Select Folder) even on a
    // fully Chinese Windows. A new STA thread resolves against the real display
    // language. Measured on this host, same process and script, only the opening
    // thread differing — and it fixes all three choosers at once, since each one
    // renders from the calling thread.
    'function Invoke-OnSta([scriptblock]$Work,[object[]]$Args2){',
    '  $ps=[PowerShell]::Create()',
    '  $null=$ps.Runspace=[RunspaceFactory]::CreateRunspace()',
    '  $ps.Runspace.ApartmentState=[Threading.ApartmentState]::STA',
    '  $ps.Runspace.ThreadOptions=[Threading.ThreadOptions]::ReuseThread',
    '  $ps.Runspace.Open()',
    '  $null=$ps.AddScript($Work)',
    '  foreach($a in $Args2){$null=$ps.AddArgument($a)}',
    '  $h=$ps.BeginInvoke()',
    '  try{$r=$ps.EndInvoke($h)}finally{$ps.Runspace.Dispose();$ps.Dispose()}',
    '  return $r',
    '}',
    '$body={',
    '  param($title,$initial,$cs)',
    '  $ErrorActionPreference="SilentlyContinue"',
    '  $done=$false',
    '  $text=$null',
    '  # 1. Modern shell dialog (IFileDialog + FOS_PICKFOLDERS).',
    '  try{',
    '    Add-Type -TypeDefinition $cs -Language CSharp | Out-Null',
    '    $p=[DshWinFolderPicker]::Pick($title,$initial)',
    "    if($p -eq $null){$text='DSHCANCEL'}else{$text='DSHOK|'+$p}",
    '    $done=$true',
    '  }catch{}',
    '  # 2. WinForms folder dialog.',
    '  if(-not $done){',
    '    try{',
    '      Add-Type -AssemblyName System.Windows.Forms | Out-Null',
    '      $d=New-Object System.Windows.Forms.FolderBrowserDialog',
    '      $d.Description=$title',
    '      $d.ShowNewFolderButton=$true',
    '      if($initial.Length -gt 0){try{$d.SelectedPath=$initial}catch{}}',
    "      if($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK){$text='DSHOK|'+$d.SelectedPath}else{$text='DSHCANCEL'}",
    '      $done=$true',
    '    }catch{}',
    '  }',
    '  # 3. Shell COM browser.',
    '  if(-not $done){',
    '    try{',
    '      $sh=New-Object -ComObject Shell.Application',
    '      $f=$sh.BrowseForFolder(0,$title,0)',
    "      if($f -eq $null){$text='DSHCANCEL'}else{$text='DSHOK|'+$f.Self.Path}",
    '      $done=$true',
    "    }catch{$text='DSHERR|'+$_.Exception.Message}",
    '  }',
    '  return $text',
    '}',
    '$out=Invoke-OnSta $body @($title,$initial,$cs)',
    '$out | ForEach-Object { $_ }',
  ].join('\n')
}

/**
 * Run one command and capture stdout. Never uses a shell, so no argument is ever
 * re-parsed. The caller's signal terminates the child, which also dismisses any
 * dialog the child owned.
 * @param command - executable or command name.
 * @param args - argv.
 * @param signal - caller lifetime.
 * @returns stdout, and whether the command succeeded.
 */
function runCapture(command, args, signal) {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { encoding: 'utf8', signal, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        resolve({ ok: error === null || error === undefined, stdout: typeof stdout === 'string' ? stdout : '' })
      },
    )
  })
}

/**
 * Combine the caller's lifetime with a wall-clock cap, because `execFile`
 * accepts only one signal. A non-positive cap means "no cap".
 *
 * @param signal - caller lifetime, possibly undefined.
 * @param timeoutMs - wall-clock cap in milliseconds.
 * @returns the signal to run the child under.
 */
function withTimeout(signal, timeoutMs) {
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return signal
  const cap = AbortSignal.timeout(timeoutMs)
  if (signal === undefined) return cap
  return AbortSignal.any([signal, cap])
}

/** Read the marker line out of a script's stdout. */
function readOutcome(stdout) {
  const lines = stdout.split(/\r?\n/)
  for (const line of lines) {
    const text = line.trim()
    if (text === CANCEL) return { kind: 'cancel' }
    if (text.startsWith(OK)) return { kind: 'picked', path: text.slice(OK.length).trim() }
    if (text.startsWith(ERR)) return { kind: 'error', message: text.slice(ERR.length).trim() }
  }
  return { kind: 'none' }
}

/** macOS chooser, so this backend is not WSL-only. */
async function pickMac(signal) {
  const result = await runCapture(
    'osascript',
    ['-e', 'set f to choose folder with prompt "选择工作区文件夹"', '-e', 'POSIX path of f'],
    signal,
  )
  // osascript exits non-zero both when the operator cancels (`User canceled`,
  // error -128) and when it fails outright; neither leaves a path to return, and
  // the seam's contract for "nothing chosen" is null rather than an error.
  if (result.ok) return { kind: 'picked', path: result.stdout.replace(/[\r\n]+$/, '') }
  return { kind: 'cancel' }
}

/** Linux chooser via zenity/kdialog, for a desktop Linux install. */
async function pickLinux(signal) {
  const zenity = await runCapture('zenity', ['--file-selection', '--directory', '--title=选择工作区文件夹'], signal)
  if (zenity.ok) return { kind: 'picked', path: zenity.stdout.replace(/[\r\n]+$/, '') }
  const kdialog = await runCapture('kdialog', ['--getexistingdirectory', '.', '--title', '选择工作区文件夹'], signal)
  if (kdialog.ok) return { kind: 'picked', path: kdialog.stdout.replace(/[\r\n]+$/, '') }
  return { kind: 'cancel' }
}

/**
 * Windows chooser (native Windows, and through WSL interop from WSL).
 * @param signal - caller lifetime.
 * @param initial - Windows path to preselect, or an empty string.
 * @param timeoutMs - wall-clock cap for the dialog, 0 to disable.
 */
async function pickWindows(signal, initial, timeoutMs) {
  const shell = findPowerShell()
  if (shell === undefined) {
    throw new Error(
      '找不到 powershell.exe：无法调用 Windows 文件夹选择器。若在 WSL 中，请确认 Windows 互操作（interop）已启用。',
    )
  }
  const encoded = Buffer.from(buildScript(TITLE, initial), 'utf16le').toString('base64')
  // `-STA` and `-ExecutionPolicy` belong to Windows PowerShell; PowerShell 7
  // rejects `-ExecutionPolicy` on some hosts, so they are passed selectively.
  const args = ['-NoProfile']
  if (/powershell\.exe$/i.test(shell)) args.push('-STA', '-ExecutionPolicy', 'Bypass')
  args.push('-EncodedCommand', encoded)
  const bounded = withTimeout(signal, timeoutMs)
  const result = await runCapture(shell, args, bounded)
  const outcome = readOutcome(result.stdout)
  if (outcome.kind === 'none') {
    // Killing the child is what dismisses the dialog, so a cap that fired and a
    // caller that gave up both land here with empty stdout; reporting which one
    // happened is the difference between a fixable setting and a mystery. The
    // caller's own abort was requested, so it is reported as such rather than
    // blamed on the cap.
    if (signal === undefined || !signal.aborted) {
      if (bounded !== signal && bounded.aborted) {
        throw new Error(
          'Windows 文件夹选择器超时（' + Math.round(timeoutMs / 1000) + ' 秒），已关闭对话框。可在插件设置中调整或不限制超时。',
        )
      }
    }
    throw new Error('Windows 文件夹选择器没有返回结果（powershell 调用被中断）。')
  }
  return outcome
}

/**
 * Translate a Windows path into its WSL spelling. A drive that is not mounted
 * into the distribution is reported rather than silently mangled.
 * @param windowsPath - the dialog's result.
 * @param signal - caller lifetime.
 * @returns the WSL path.
 */
async function toLinuxPath(windowsPath, signal) {
  const result = await runCapture('wslpath', ['-u', windowsPath], signal)
  if (!result.ok) {
    throw new Error(
      '无法把 ' + windowsPath + ' 转换成 WSL 路径：该盘符可能没有挂载进 WSL（例如 Z:）。请改选已挂载的盘符。',
    )
  }
  const linux = result.stdout.replace(/[\r\n]+$/, '').trim()
  if (linux === '') throw new Error('wslpath 没有返回有效路径：' + windowsPath)
  return linux.length > 1 && linux.endsWith('/') ? linux.slice(0, -1) : linux
}

/**
 * Whether this host can serve the Windows chooser at all. The profile patch
 * gates on WSL markers, but those can be present in an environment where
 * interop was later disabled, so the executable is probed too.
 * @returns true when `powershell.exe` is reachable.
 */
export function windowsPickerAvailable() {
  if (!isWsl() && process.platform !== 'win32') return false
  return findPowerShell() !== undefined
}

/**
 * Build the Windows-backed `native` capability. The returned object is stable
 * for the service lifetime (consumers hold it across calls), so the remembered
 * folder lives in its closure.
 *
 * @param readOptions - reads `{rememberLast, timeoutSeconds}` live on each pick.
 * @returns a `native` capability backed by the Windows folder chooser.
 */
function createWindowsCapability(readOptions) {
  /** Remembered so a second pick reopens where the operator last chose. */
  let lastWindowsPath = ''
  const settings = () => {
    const value = typeof readOptions === 'function' ? readOptions() : undefined
    const section = value === null || typeof value !== 'object' ? {} : value
    return {
      rememberLast: section.rememberLast !== false,
      timeoutMs:
        typeof section.timeoutSeconds === 'number' && Number.isFinite(section.timeoutSeconds)
          ? section.timeoutSeconds * 1000
          : DEFAULT_TIMEOUT_MS,
    }
  }

  return {
    kind: 'native',
    async pick(signal) {
      const { rememberLast, timeoutMs } = settings()
      const initial = rememberLast ? lastWindowsPath : ''
      let outcome
      if (isWsl() || process.platform === 'win32') {
        outcome = await pickWindows(signal, initial, timeoutMs)
      } else if (process.platform === 'darwin') {
        outcome = await pickMac(signal)
      } else if (process.platform === 'linux') {
        outcome = await pickLinux(signal)
      } else {
        throw new Error('当前平台不支持原生文件夹选择器：' + process.platform)
      }
      if (outcome.kind === 'cancel') return null
      if (outcome.kind === 'error') throw new Error('Windows 文件夹选择器报错：' + outcome.message)
      if (outcome.kind !== 'picked') return null
      if (isWsl()) {
        if (rememberLast) lastWindowsPath = outcome.path
        return await toLinuxPath(outcome.path, signal)
      }
      return outcome.path
    },
  }
}

/**
 * Borrow the shipped browse implementation's logic without its service.
 *
 * The browse backend registers `directoryPicker` in its constructor, so
 * instantiating it would collide with this plugin's own provision. Its methods
 * read only `this.config`, so a prototype-only instance runs the shipped code
 * verbatim with no second service.
 *
 * @param ctx - Host plugin context carrying `baseUrl`.
 * @returns the shipped `list` and `createDirectory`.
 */
function loadBrowsePrimitives(ctx) {
  let loaded
  try {
    loaded = anchorRequire(ctx, '@deepseek-ai/dsh-host-directory-picker-browse')
  } catch (cause) {
    throw new Error(
      'dsh-wsl-windows-folder-picker: could not load @deepseek-ai/dsh-host-directory-picker-browse, so the ' +
        `in-page directory browser is unavailable. (${cause instanceof Error ? cause.message : String(cause)})`,
    )
  }
  const Ctor = loaded === null || loaded === undefined ? undefined : loaded.default ?? loaded
  if (typeof Ctor !== 'function' || Ctor.prototype === undefined) {
    throw new Error('dsh-wsl-windows-folder-picker: the browse backend did not expose its class')
  }
  const borrowed = Object.create(Ctor.prototype)
  borrowed.config = { maxEntries: 1000 }
  return {
    list: (path, signal) => borrowed.list(path, signal),
    createDirectory: (path, name) => borrowed.createDirectory(path, name),
  }
}

/**
 * Build the single capability served for both modes.
 *
 * `kind` is read fresh on every call, which is what makes the switch live:
 * nothing is mounted or unmounted, and the browser half flips its slot
 * registration off the same two facts (see `wantsNativeSurface` in client.js —
 * the rule is duplicated because a client bundle cannot share host code).
 *
 * @param ctx - Host plugin context.
 * @param wanted - reads the live preferences section.
 * @returns the dispatching capability.
 */
export function createDispatchingCapability(ctx, wanted) {
  const windows = createWindowsCapability(wanted)
  let browse
  const browseFace = () => {
    if (browse === undefined) browse = loadBrowsePrimitives(ctx)
    return browse
  }
  const reads = () => {
    const value = wanted()
    return value === null || typeof value !== 'object' ? {} : value
  }
  const useWindows = () => {
    const section = reads()
    if (section.available === false) return false
    return section.enabled !== false
  }
  return {
    get kind() {
      return useWindows() ? 'native' : 'browse'
    },
    async pick(signal) {
      return await windows.pick(signal)
    },
    async list(path, signal) {
      return await browseFace().list(path, signal)
    },
    async createDirectory(path, name) {
      return await browseFace().createDirectory(path, name)
    },
  }
}
