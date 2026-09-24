/**
 * dsh-wsl-windows-folder-picker — Host half.
 *
 * Refines `ctx.directoryPicker` into a dispatching capability: the Windows
 * folder chooser when interop can run it, the stock interaction otherwise.
 *
 * The seam allows exactly one implementation per context — loading a second
 * throws — so this cannot be a second provider beside the `browse` backend the
 * shipped adaptive chooser mounts. It shadows that service instance's
 * `capability()` instead, and restores it on dispose.
 *
 * That indirection is what makes disabling this plugin harmless. The chooser
 * stays enabled and keeps both its interaction and the browser surface that
 * renders the in-page add-workspace flow, so dropping this plugin's shadow is the
 * whole of the hand-back. The two directory-flow slots are `single` slots with no
 * default occupant, so a fallback that depended on this package being mounted
 * would take the add-workspace affordance down with it.
 *
 * There is no Config, hence no Settings page. The Plugins page already disables
 * this bundle's row, which is the switch at the granularity that matters.
 *
 * @module dsh-wsl-windows-folder-picker
 */

import { createDispatchingCapability, windowsPickerAvailable } from './backend.js'

/** Cordis plugin name. */
export const name = 'dsh-wsl-windows-folder-picker'

/**
 * Required service: the seam this plugin refines.
 *
 * Required rather than optional because a shadow needs something to shadow. The
 * shipped chooser provides it at boot, so this stays unmet only when an operator
 * disabled that chooser too — and then there is no picker here to refine, which
 * the plugin page reports as a plugin waiting for its dependency.
 */
export const inject = ['directoryPicker']

/**
 * Serve this plugin's dispatching capability in place of the seam's own, for as
 * long as this plugin is mounted; restoring the original is the hand-back.
 *
 * `capability` is an ordinary method on the shipped backends' prototype, so an
 * own property shadows it for every consumer and deleting that property restores
 * prototype lookup. The original descriptor is captured anyway, because a
 * backend is free to define it as an own property instead.
 *
 * The shadowed capability is created once per mount and never replaced, because
 * consumers read `capability().kind` and may hold the result across calls.
 *
 * @param ctx - Host plugin context carrying the injected `directoryPicker`.
 */
function refineSeam(ctx) {
  const seam = ctx.directoryPicker
  ctx.effect(() => {
    const original = Object.getOwnPropertyDescriptor(seam, 'capability')
    const capability = createDispatchingCapability(ctx)
    seam.capability = () => capability
    return () => {
      if (original === undefined) delete seam.capability
      else Object.defineProperty(seam, 'capability', original)
    }
  }, 'wsl-windows-folder-picker: seam capability')
}

/**
 * Refine the seam, after reporting the one condition that leaves this plugin
 * unable to do its job.
 *
 * The warning carries the remedy because nothing else can: the client half
 * cannot see this host fact (the remote namespace exposes only
 * `pick`/`list`/`createDirectory`), so it takes the directory-flow seat either
 * way and a pick is simply refused.
 *
 * @param ctx - Host plugin context.
 */
export function apply(ctx) {
  if (!windowsPickerAvailable()) {
    console.error(
      'wsl-windows-folder-picker: powershell.exe is unreachable, so the Windows folder dialog cannot run. ' +
        "Enable WSL interop to use it, or switch this plugin off in the Plugins page to go back to dsh's own picker.",
    )
  }

  refineSeam(ctx)
}