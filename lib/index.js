/**
 * dsh-wsl-windows-folder-picker — Host half.
 *
 * Serves the `ctx.directoryPicker` seam with one **dispatching** capability: the
 * Windows folder chooser when the user wants it and interop can run it, dsh's
 * own browse primitives otherwise. A durable switch plus two finer preferences
 * live in this plugin's own Settings page.
 *
 * ## Why one capability, and why nothing is mounted at runtime
 *
 * The workspace picker is two coupled pieces:
 *
 *   - the **backend** behind `ctx.directoryPicker`, whose `capability().kind` is
 *     either `native` (one OS dialog) or `browse` (listing primitives for the
 *     in-page browser), and
 *   - the **browser surface** occupying the two directory-flow holes, which must
 *     match: a `native` surface calls `pickDirectory()`, a `browse` surface calls
 *     `listDirectory()`/`createDirectory()`.
 *
 * They cannot be mixed — `requireCapability` refuses a mismatch outright — and
 * they cannot both be swapped live either, because a page's client module graph
 * is frozen at load: mounting a different *surface* package mid-session is not
 * something the running page can follow.
 *
 * So this plugin never changes which packages are mounted. It serves ONE
 * capability whose `kind` is read fresh on every call, and the browser half
 * flips its own slot registration (see `lib/client.js`) off the same two facts
 * this file uses. Both halves therefore derive the mode from one shared source —
 * the `available` fact published here plus the user's `enabled` — instead of
 * each guessing, and neither ever disagrees with the other.
 *
 * The dispatcher serves both verbs from the same object, so `pick` works when
 * the mode is `native` and `list`/`createDirectory` work when it is `browse`.
 *
 * ## The browse fallback borrows the shipped implementation
 *
 * Off-mode must behave exactly like dsh's own in-page browser, so its logic is
 * not reimplemented: `@deepseek-ai/dsh-host-directory-picker-browse` is
 * instantiated prototype-only, which runs the shipped `list` and
 * `createDirectory` verbatim — same listing shape, same truncation rule, same
 * error codes the shipped browser surface already consumes — while skipping its
 * constructor, which would register a competing `directoryPicker` service.
 *
 * @module dsh-wsl-windows-folder-picker
 */

import { createRequire } from 'node:module'
import { createDispatchingCapability, windowsPickerAvailable } from './backend.js'

/** Cordis plugin name. */
export const name = 'dsh-wsl-windows-folder-picker'

/** Settings namespace owned by this plugin; the client half binds the same key. */
export const SETTINGS_NAMESPACE = 'wsl-windows-folder-picker'

/** A fresh install uses the Windows chooser; that is the point of the plugin. */
const DEFAULT_ENABLED = true

/** Default dialog cap in seconds, matching `DEFAULT_TIMEOUT_MS` in the backend. */
const DEFAULT_TIMEOUT_SECONDS = 300

/**
 * Load schemastery through the profile's own module scope.
 *
 * A `link:`-installed plugin resolves its bare imports against its source
 * directory, which has no `node_modules`, so a plain
 * `import '@deepseek-ai/schemastery'` fails even though dsh itself ships it. The
 * loader anchors entry imports at `ctx.baseUrl` — the directory holding the
 * profile configuration — so anchoring a `createRequire` there reaches the
 * profile's node_modules and its shared fallback. That works for a `link:`
 * install and for a copied or hoisted one alike.
 *
 * @param ctx - Host plugin context carrying `baseUrl`.
 * @returns the schemastery function, or undefined when it cannot be reached.
 */
function loadSchema(ctx) {
  const baseUrl = ctx.baseUrl
  if (typeof baseUrl !== 'string' || baseUrl.length === 0) return undefined
  try {
    const anchored = createRequire(new URL('package.json', baseUrl).href)
    const loaded = anchored('@deepseek-ai/schemastery')
    const schema = loaded === null || loaded === undefined ? undefined : loaded.default ?? loaded
    return typeof schema === 'function' ? schema : undefined
  } catch {
    return undefined
  }
}

/**
 * Build the namespace schema.
 *
 * `available` is a boot fact, not a preference. It rides the resolved value so
 * it reaches the browser through the ordinary settings view, and the `validate`
 * hook re-stamps the real host fact over anything a hand-edited document claims.
 * The client half needs it because `enabled` alone does not say which capability
 * this host is actually serving — a user who leaves the switch on in an
 * environment where interop later broke would otherwise mount a native surface
 * against a browse capability and see Add-workspace fail.
 *
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
 * Register the preferences and keep a live mirror of the resolved section.
 *
 * `onPreferences` is called on every path, so `preferences` is never left holding
 * a stale value: the registered path reports the resolved section, and the
 * degraded paths (no settings service, or schemastery unreachable) report the
 * defaults explicitly. The client half cannot distinguish "no namespace yet"
 * from "no namespace ever" — it applies the same defaults this object does — so
 * reporting them here is what keeps the two halves serving the same mode.
 *
 * @param ctx - Host plugin context.
 * @param onPreferences - receives each resolved section.
 * @returns nothing.
 */
function installPreferences(ctx, onPreferences) {
  /** Defaults used when the settings service cannot be reached at all. */
  const fallback = () => ({
    enabled: DEFAULT_ENABLED,
    rememberLast: true,
    timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
  })
  ctx.inject(['settings'], (settingsCtx) => {
    const schema = loadSchema(ctx)
    if (schema === undefined) {
      console.error(
        'wsl-windows-folder-picker: schemastery is unreachable, so no settings were registered. ' +
          'The picker works with its defaults, but the preferences cannot be changed.',
      )
      onPreferences(fallback())
      return
    }
    const scope = settingsCtx.settings.register(SETTINGS_NAMESPACE, buildSchema(schema), {
      // The one place this namespace can be made to disagree with reality is a
      // hand-edited settings document, so the boot fact is re-stamped over
      // whatever was resolved. The client half decides which browser surface to
      // mount from this value, and a forged one would put a native surface over
      // a browse capability — the exact failure this key exists to prevent.
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
 * read `capability().kind` on every call and may hold the reference across
 * calls; only the preferences it reads change. That is what makes the switch
 * live without mounting or unmounting anything.
 *
 * The defaults are live from the first call rather than held back until the
 * settings namespace answers. The browser half cannot see a namespace that is
 * still loading, so it mounts its surface from the same defaults; serving
 * `browse` during that window would put a native surface over a browse
 * capability and break Add-workspace. Both halves therefore agree at every
 * instant, and a namespace that never arrives — no settings service, or
 * schemastery unreachable — leaves them agreeing on the defaults.
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
      // `available` is deliberately absent when no namespace was registered. The
      // client half reads it from that namespace, so with no namespace it cannot
      // see the key at all — and it then applies the same defaults this object
      // does. Publishing `available: false` here would make the Host serve
      // `browse` while the browser mounted the native surface, which is precisely
      // the disagreement this design exists to prevent.
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
