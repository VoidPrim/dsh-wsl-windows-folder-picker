window.__ModuleLoader__.load({
	id: "dsh-wsl-windows-folder-picker",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");

		/**
		 * The directory-flow seats this surface may occupy. Both are `single`
		 * slots, so the shipped browse surface and this one are the two candidates
		 * and exactly one renders.
		 */
		const FLOW_SLOTS = ["sidebar.workspaces.directoryFlow", "conversation.hero.workspace.directoryFlow"];

		/**
		 * A `single` slot renders the entry with the LOWEST priority, and the shipped
		 * browse surface registers at the default 0 — so -1 wins while mounted, and
		 * disposing hands the seat straight back to browse. That handoff is the whole
		 * live switch: runtime package swapping is impossible because a page's client
		 * module graph is frozen at load.
		 */
		const SURFACE_PRIORITY = -1;

		/**
		 * Renderless surface that turns an open directory flow into one Windows pick.
		 *
		 * The flow renders this exactly while it is asking, so the pick is armed once
		 * per open and the outcome is delivered through the latest props — the flow
		 * may re-render mid-pick, and a stale closure would report to a dead step.
		 *
		 * @param props - flow callbacks plus the injected pick call.
		 */
		function WindowsDirectoryFlow(props) {
			const armed = React.useRef(false);
			const outcome = React.useRef(props);
			outcome.current = props;
			const alive = React.useRef(true);
			React.useEffect(() => {
				alive.current = true;
				return () => {
					alive.current = false;
				};
			}, []);
			React.useEffect(() => {
				if (!props.open) {
					armed.current = false;
					return;
				}
				if (armed.current) return;
				armed.current = true;
				props.pick().then(
					(path) => {
						if (!alive.current) return;
						if (path === null) outcome.current.onCancel();
						else outcome.current.onPicked(path);
					},
					(reason) => {
						if (!alive.current) return;
						// A failed dialog must not leave the flow waiting forever.
						outcome.current.onError(reason instanceof Error ? reason.message : String(reason));
					},
				);
			}, [props.open, props.pick]);
			return null;
		}

		/** Services this client half requires. */
		const inject = ["slots", "uiWorkspace"];

		/**
		 * Client plugin body: the native directory-flow surface, holding its two
		 * seats for as long as this module is mounted.
		 *
		 * There is no preference left to reconcile, so nothing here appears or
		 * disappears at runtime. Turning the picker off is the Plugins page disabling
		 * this bundle's row, which unloads this module together with the Host half
		 * that refines the seam — and the shipped picker's own surface is mounted
		 * underneath all along, so the seat this leaves behind is filled, not empty.
		 *
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			ctx.effect(() => {
				const created = [];
				try {
					for (const slot of FLOW_SLOTS) {
						created.push(
							ctx.slots.inject(slot, () =>
								ctx.slots.register(
									{
										name: slot,
										priority: SURFACE_PRIORITY,
										inject: () => ({ pick: () => ctx.uiWorkspace.pickDirectory() }),
									},
									WindowsDirectoryFlow,
								),
							),
						);
					}
				} catch (error) {
					// `slots.inject` can throw synchronously when a declaration is
					// already present and the registration is refused. A partial commit
					// would leave one hole native and the other browse, so the seats that
					// did land are released before the failure propagates.
					for (const dispose of created) {
						try {
							dispose();
						} catch {
							/* rolling back the seats that did land */
						}
					}
					throw error;
				}
				return () => {
					for (const dispose of created) {
						try {
							dispose();
						} catch {
							/* a seat already gone must not stop the rest */
						}
					}
				};
			}, "wsl-windows-folder-picker: picker surface");
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});