/**
 * dsh-wsl-windows-folder-picker — Host half.
 *
 * Serves `ctx.directoryPicker` with one dispatching capability: the Windows
 * folder chooser when the user wants it and interop can run it, dsh's own browse
 * primitives otherwise.
 *
 * The capability's `kind` is read fresh on every call and nothing is mounted at
 * runtime, because the browser surface that consumes it cannot change mid-session
 * (a page's client module graph is frozen at load) — see `lib/client.js`, which
 * flips its own slot registration off the same two facts used here.
 *
 * @module dsh-wsl-windows-folder-picker
 */

import { anchorRequire, createDispatchingCapability, windowsPickerAvailable } from './backend.js'

/** Cordis plugin name. */
export const name = 'dsh-wsl-windows-folder-picker'

/** Settings namespace owned by this plugin; the client half binds the same key. */
export const SETTINGS_NAMESPACE = 'wsl-windows-folder-picker'

/** A fresh install uses the Windows chooser; that is the point of the plugin. */
const DEFAULT_ENABLED = true

/** Default dialog cap in seconds, matching `DEFAULT_TIMEOUT_MS` in the backend. */
const DEFAULT_TIMEOUT_SECONDS = 300

/**
 * Load schemastery through the profile's module scope, degrading to `undefined`
 * (the plugin still works, its preferences just are not configurable).
 * @param ctx - Host plugin context.
 * @returns the schemastery function, or undefined when unreachable.
 */
function loadSchema(ctx) {
  try {
    const loaded = anchorRequire(ctx, '@deepseek-ai/schemastery')
    const schema = loaded === null || loaded === undefined ? undefined : loaded.default ?? loaded
    return typeof schema === 'function' ? schema : undefined
  } catch {
    return undefined
  }
}

/**
 * Build the namespace schema. `available` is a boot fact re-stamped by the
 * `validate` hook below, because the client half picks its surface from it.
 * @param schema - the schemastery function.
 * @returns the namespace schema.
 */
function buildSchema(schema) {
  return schema.object({
    enabled: schema.boolean().default(DEFAULT_ENABLED),
    rememberLast: schema.boolean().default(true),
    timeoutSeconds: schema.natural().min(0).max(3600).default(DEFAULT_TIMEOUT_SECONDS),
    available: schema.boolean().default(true),
  })
}

/**
 * Register the preferences and report every resolved section to `onPreferences`.
 *
 * Called on both paths, including when settings are unreachable: the client half
 * applies the same defaults this does, so reporting them keeps the two halves
 * serving the same mode.
 *
 * @param ctx - Host plugin context.
 * @param onPreferences - receives each resolved section.
 */
function installPreferences(ctx, onPreferences) {
  ctx.inject(['settings'], (settingsCtx) => {
    const schema = loadSchema(ctx)
    if (schema === undefined) {
      console.error(
        'wsl-windows-folder-picker: schemastery is unreachable, so no settings were registered. ' +
          'The picker works with its defaults, but the preferences cannot be changed.',
      )
      onPreferences({ enabled: DEFAULT_ENABLED, rememberLast: true, timeoutSeconds: DEFAULT_TIMEOUT_SECONDS })
      return
    }
    const scope = settingsCtx.settings.register(SETTINGS_NAMESPACE, buildSchema(schema), {
      // Re-stamp the boot fact over anything a hand-edited document claims: a
      // forged `available` would put a native surface over a browse capability.
      validate: (value) => {
        value.available = windowsPickerAvailable()
      },
    })
    onPreferences(scope.get())
    ctx.effect(() => scope.watch((next) => onPreferences(next)), 'wsl-windows-folder-picker: preferences')
  })
}

/**
 * Serve the seam and wire the preferences into it.
 *
 * The capability object is created once and never replaced, because consumers
 * read `capability().kind` on every call and may hold the reference across calls.
 *
 * @param ctx - Host plugin context.
 */
export function apply(ctx) {
  /** Latest resolved preferences; replaced wholesale on every settings change. */
  let preferences = {
    enabled: DEFAULT_ENABLED,
    rememberLast: true,
    timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
  }

  const capability = createDispatchingCapability(ctx, () => preferences)
  ctx.provide('directoryPicker', {
    capability() {
      return capability
    },
  })

  installPreferences(ctx, (next) => {
    const section = next === null || typeof next !== 'object' ? {} : next
    preferences = {
      enabled: typeof section.enabled === 'boolean' ? section.enabled : DEFAULT_ENABLED,
      rememberLast: section.rememberLast !== false,
      timeoutSeconds:
        typeof section.timeoutSeconds === 'number' ? section.timeoutSeconds : DEFAULT_TIMEOUT_SECONDS,
      // Deliberately absent when no namespace was registered: the client half
      // cannot see the key either, so both fall back to the same defaults.
      available: section.available,
    }
  })

  if (!windowsPickerAvailable()) {
    console.error(
      'wsl-windows-folder-picker: powershell.exe is unreachable, so the Windows chooser cannot run. ' +
        'Serving the in-page directory browser instead. Enable WSL interop to use the Windows dialog.',
    )
  }
}
