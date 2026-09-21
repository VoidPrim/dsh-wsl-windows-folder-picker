window.__ModuleLoader__.load({
	id: "dsh-wsl-windows-folder-picker",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		const createElement = React.createElement;

		/** Locale namespace for this plugin's copy. */
		const NS = "wsl-windows-folder-picker";

		/** Must match SETTINGS_NAMESPACE in the Host half. */
		const SETTINGS_NAMESPACE = "wsl-windows-folder-picker";

		/** Nav position: after General (0), Models (10), and Plugins (15). */
		const SECTION_ORDER = 20;

		/**
		 * The directory-flow seats this surface may occupy. Both are `single`
		 * slots, so the shipped browse surface from the composition and this
		 * surface are the two candidates and exactly one renders.
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
		 * Dictionaries. Every locale must carry the same key set (bilingual
		 * balance is enforced at registration), so `zh` is the source of truth.
		 */
		const zh = {
			"section.title": "Windows 文件夹选择器",
			"section.description": "在 WSL 中调用 Windows 的文件夹对话框来选择工作区目录。",
			"enable.title": "使用 Windows 文件夹选择器",
			"enable.description": "开启后，添加工作区时打开 Windows 的资源管理器式对话框；关闭后改回 dsh 内置的网页目录浏览器。",
			"enable.readOnly": "这项设置由服务端保存，当前连接为只读，无法修改。",
			"remember.title": "记住上次位置",
			"remember.description": "下次打开对话框时，从上一次选中的文件夹开始。",
			"timeout.title": "对话框超时",
			"timeout.description": "对话框打开超过该时间后自动放弃，避免一直占用选择操作。",
			"timeout.none": "不限制",
			"timeout.minutes": "{n} 分钟",
			"unavailable.title": "Windows 互操作不可用",
			"unavailable.description": "当前找不到 powershell.exe，插件已自动改用内置的目录浏览器。请确认 WSL 互操作（interop）已启用。",
			"on": "已开启",
			"off": "已关闭",
		};
		const en = {
			"section.title": "Windows folder picker",
			"section.description": "Use Windows' folder dialog to choose a workspace directory from WSL.",
			"enable.title": "Use the Windows folder picker",
			"enable.description": "When on, adding a workspace opens Windows' Explorer-style dialog. When off, dsh's built-in in-page directory browser is used instead.",
			"enable.readOnly": "This setting is stored on the server and this connection is read-only, so it cannot be changed here.",
			"remember.title": "Remember last location",
			"remember.description": "Reopen the dialog in the folder chosen last time.",
			"timeout.title": "Dialog timeout",
			"timeout.description": "Give up on the dialog after this long, so it cannot hold the pick open indefinitely.",
			"timeout.none": "No limit",
			"timeout.minutes": "{n} min",
			"unavailable.title": "Windows interop unavailable",
			"unavailable.description": "powershell.exe was not found, so the plugin fell back to the built-in directory browser. Check that WSL interop is enabled.",
			"on": "On",
			"off": "Off",
		};

		/**
		 * Selectable dialog timeouts in seconds; 0 means the pick is never capped.
		 *
		 * The Host owns the stored value and the schema bound (0–3600); this list is
		 * only the choices offered here, so every entry must stay inside that range.
		 */
		const TIMEOUT_CHOICES = [0, 60, 180, 300, 600, 1800];

		/**
		 * The value shown before the Host's section arrives. Must be one of
		 * {@link TIMEOUT_CHOICES} or the `<select>` would render with no matching
		 * option, and must equal the Host's `DEFAULT_TIMEOUT_SECONDS` or the control
		 * would show a value the Host is not actually using.
		 */
		const DEFAULT_TIMEOUT_SECONDS = 300;

		/**
		 * Insert this row's stylesheet once per document.
		 *
		 * A static client bundle has no build-time CSS pipeline, so the sheet is
		 * inserted directly and tagged by package id — the approach the shipped
		 * rows take, and one that lets a hot reload replace rather than stack it.
		 */
		function installStyles() {
			const id = "dsh-wsl-windows-folder-picker/Settings.css";
			if (typeof document === "undefined") return;
			if (document.querySelector("style[data-plugin-css=" + JSON.stringify(id) + "]") !== null) return;
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-wsl-windows-folder-picker";
			tag.dataset.pluginCss = id;
			tag.textContent = [
				".dshWslPickerSection{display:flex;flex-direction:column;gap:4px}",
				".dshWslPickerHeading{display:flex;flex-direction:column;gap:2px;margin-bottom:8px}",
				".dshWslPickerHeadingTitle{color:var(--dsw-alias-label-primary);font-size:16px;line-height:24px;font-weight:500}",
				".dshWslPickerHeadingDesc{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}",
				".dshWslPickerRow{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 0}",
				".dshWslPickerText{display:flex;flex-direction:column;gap:2px;min-width:0}",
				".dshWslPickerTitle{color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}",
				".dshWslPickerDesc{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;word-break:break-word}",
				".dshWslPickerSwitch{box-sizing:border-box;flex:none;width:36px;height:20px;padding:2px;border-radius:10px;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);cursor:pointer;transition:background .15s ease,border-color .15s ease}",
				'.dshWslPickerSwitch[aria-checked="true"]{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}',
				".dshWslPickerSwitch:disabled{cursor:default;opacity:.5}",
				".dshWslPickerKnob{display:block;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-bg-base);transition:transform .15s ease}",
				'.dshWslPickerSwitch[aria-checked="true"] .dshWslPickerKnob{transform:translateX(16px)}',
				".dshWslPickerSelect{box-sizing:border-box;flex:none;min-width:112px;height:28px;padding:0 8px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;font-size:13px;cursor:pointer}",
				".dshWslPickerSelect:disabled{cursor:default;opacity:.5}",
				".dshWslPickerNotice{margin:4px 0 12px;padding:10px 12px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l1)}",
				".dshWslPickerNoticeTitle{color:var(--dsw-alias-state-error-primary);font-size:13px;line-height:20px}",
				".dshWslPickerNoticeDesc{margin-top:2px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}",
			].join("");
			document.head.appendChild(tag);
		}

		/**
		 * Subscribe a component to a settings scope snapshot.
		 *
		 * The scope is an external store (`getSnapshot` + `subscribe`), so the
		 * component mirrors it through React state rather than through a
		 * package-specific store helper this bundle cannot import.
		 *
		 * @param scope - bound settings scope, or undefined when unbindable.
		 * @returns the current snapshot, re-rendered on every scope change.
		 */
		function useScopeSnapshot(scope) {
			const [snapshot, setSnapshot] = React.useState(() =>
				scope === undefined ? undefined : scope.getSnapshot(),
			);
			React.useEffect(() => {
				if (scope === undefined) return undefined;
				let alive = true;
				const sync = () => {
					if (alive) setSnapshot(scope.getSnapshot());
				};
				sync();
				const dispose = scope.subscribe(sync);
				return () => {
					alive = false;
					if (typeof dispose === "function") dispose();
				};
			}, [scope]);
			return snapshot;
		}

		/** The namespace section, or an empty object while the mirror is still loading. */
		function sectionOf(snapshot) {
			const value = snapshot === undefined || snapshot === null ? undefined : snapshot.value;
			return value !== null && typeof value === "object" ? value : {};
		}

		/** Read a boolean field, falling back to the Host default. */
		function boolOf(section, field, fallback) {
			return typeof section[field] === "boolean" ? section[field] : fallback;
		}

		/**
		 * Decide whether this plugin's native surface should hold the directory-flow
		 * seat.
		 *
		 * Only positive evidence turns it off (`available: false`, `enabled: false`).
		 * Anything else — a loading mirror, one that never answers, a section missing
		 * the key — leaves both halves on the same default, because the Host applies
		 * that default too. Treating "no information" as `browse` would mount the
		 * browse surface against a capability serving `native` and break listings.
		 *
		 * @param snapshot - the bound scope's current snapshot.
		 * @returns whether to occupy the directory-flow holes.
		 */
		function wantsNativeSurface(snapshot) {
			const section = sectionOf(snapshot);
			if (boolOf(section, "available", true) === false) return false;
			return boolOf(section, "enabled", true) !== false;
		}

		/**
		 * Drive one preference with instant feedback: a change is shown immediately
		 * and the override dropped once the scope reports it back.
		 *
		 * Deliberately NOT gated on `writable` — while the mirror is still loading that
		 * flag is false, and gating on it is what swallows a user's first click.
		 *
		 * @param scope - bound settings scope.
		 * @param field - field name inside the namespace section.
		 * @param fallback - value assumed before the Host's section arrives.
		 * @returns the value to display, and a setter.
		 */
		function usePreference(scope, field, fallback) {
			const snapshot = useScopeSnapshot(scope);
			const reported = sectionOf(snapshot)[field];
			const current = reported === undefined ? fallback : reported;
			const [pending, setPending] = React.useState(undefined);
			const shown = pending === undefined ? current : pending;
			React.useEffect(() => {
				if (pending !== undefined && current === pending) setPending(undefined);
			}, [current, pending]);
			// A failed write must not leave the control showing a value the Host never
			// accepted; dropping the override snaps it back to the reported value.
			return {
				shown,
				set: (next) => {
					if (scope === undefined) return;
					setPending(next);
					Promise.resolve(scope.set(field, next)).catch(() => setPending(undefined));
				},
			};
		}

		/** One labelled preference row with a switch on the right. */
		function SwitchRow(props) {
			const t = props.t;
			const label = props.shown ? t("on") : t("off");
			return createElement(
				"div",
				{ className: "dshWslPickerRow" },
				createElement(
					"div",
					{ className: "dshWslPickerText" },
					createElement("div", { className: "dshWslPickerTitle" }, props.title),
					createElement("div", { className: "dshWslPickerDesc" }, props.description),
				),
				createElement(
					"button",
					{
						type: "button",
						role: "switch",
						className: "dshWslPickerSwitch",
						"aria-checked": props.shown ? "true" : "false",
						"aria-label": props.title + ": " + label,
						title: label,
						disabled: props.disabled === true,
						onClick: props.disabled === true ? undefined : () => props.onChange(!props.shown),
					},
					createElement("span", { className: "dshWslPickerKnob" }),
				),
			);
		}

		/** One labelled row with a select on the right. */
		function SelectRow(props) {
			return createElement(
				"div",
				{ className: "dshWslPickerRow" },
				createElement(
					"div",
					{ className: "dshWslPickerText" },
					createElement("div", { className: "dshWslPickerTitle" }, props.title),
					createElement("div", { className: "dshWslPickerDesc" }, props.description),
				),
				createElement(
					"select",
					{
						className: "dshWslPickerSelect",
						"aria-label": props.title,
						value: String(props.value),
						disabled: props.disabled === true,
						onChange: props.disabled === true ? undefined : props.onChange,
					},
					props.options.map((option) =>
						createElement("option", { key: String(option.value), value: String(option.value) }, option.label),
					),
				),
			);
		}

		/**
		 * This plugin's own Settings page: the master switch, the two secondary
		 * preferences, and an explicit notice when Windows interop is missing.
		 *
		 * The section owner passes only `close`; copy, values, and the write path
		 * all arrive through `inject`.
		 *
		 * @param props - the injected scope and translator.
		 */
		function WslPickerSection(props) {
			const t = props.t;
			const scope = props.scope;
			const snapshot = useScopeSnapshot(scope);
			const section = sectionOf(snapshot);
			const available = boolOf(section, "available", true);
			const enable = usePreference(scope, "enabled", true);
			const remember = usePreference(scope, "rememberLast", true);
			const timeoutPref = usePreference(scope, "timeoutSeconds", DEFAULT_TIMEOUT_SECONDS);
			// `snapshot.writable` is false while the mirror is still loading, so it is
			// only trusted once the transport has actually answered; otherwise it would
			// disable every control during the very window the optimistic write exists
			// to cover.
			//
			// A settings transport that will NEVER answer is the opposite case and must
			// be disabled: over a non-loopback address dsh serves a process-local mirror
			// (`status: "unavailable"`) whose writes are dropped silently, so an enabled
			// control would appear to flip, persist nothing, and leave the picker in the
			// mode the Host is actually serving.
			const willNeverAnswer = snapshot !== undefined && snapshot.status === "unavailable";
			const readOnly =
				willNeverAnswer || (snapshot !== undefined && snapshot.status === "ready" && snapshot.writable === false);
			const showAdvanced = available && enable.shown;

			const rows = [
				createElement(SwitchRow, {
					key: "enabled",
					t,
					title: t("enable.title"),
					description: readOnly ? t("enable.readOnly") : t("enable.description"),
					shown: enable.shown,
					disabled: !available || readOnly,
					onChange: enable.set,
				}),
			];
			if (showAdvanced) {
				rows.push(
					createElement(SwitchRow, {
						key: "remember",
						t,
						title: t("remember.title"),
						description: t("remember.description"),
						shown: remember.shown,
						disabled: readOnly,
						onChange: remember.set,
					}),
				);
				rows.push(
					createElement(SelectRow, {
						key: "timeout",
						title: t("timeout.title"),
						description: t("timeout.description"),
						value: timeoutPref.shown,
						disabled: readOnly,
						options: TIMEOUT_CHOICES.map((seconds) => ({
							value: seconds,
							label: seconds === 0 ? t("timeout.none") : t("timeout.minutes", { n: seconds / 60 }),
						})),
						onChange: (event) => {
							const next = Number(event.target.value);
							if (Number.isFinite(next)) timeoutPref.set(next);
						},
					}),
				);
			}

			const children = [
				createElement(
					"div",
					{ className: "dshWslPickerHeading", key: "heading" },
					createElement("div", { className: "dshWslPickerHeadingTitle" }, t("section.title")),
					createElement("div", { className: "dshWslPickerHeadingDesc" }, t("section.description")),
				),
			];
			if (!available) {
				children.push(
					createElement(
						"div",
						{ className: "dshWslPickerNotice", key: "notice" },
						createElement("div", { className: "dshWslPickerNoticeTitle" }, t("unavailable.title")),
						createElement("div", { className: "dshWslPickerNoticeDesc" }, t("unavailable.description")),
					),
				);
			}
			children.push(...rows);
			return createElement("div", { className: "dshWslPickerSection" }, children);
		}

		/**
		 * The native directory-flow occupant for this plugin's own dialog.
		 *
		 * Renderless: each rising `open` edge runs exactly one pick and reports
		 * exactly one outcome, and the ref arms once per open so re-renders (and an
		 * adoption keeping `open` true while `busy`) never launch a second chooser.
		 *
		 * @param props - owner conversation plus the injected pick call.
		 * @returns nothing — the chooser renders on the Windows display.
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
						outcome.current.onError(reason instanceof Error ? reason.message : String(reason));
					},
				);
			}, [props.open, props.pick]);
			return null;
		}

		/** Services this client half requires. */
		const inject = ["slots", "locale", "settingsScope", "uiWorkspace"];

		/**
		 * Client plugin body: this plugin's Settings page, plus the native
		 * directory-flow surface while the Host serves the `native` capability.
		 *
		 * The Host publishes `available` alongside the user's `enabled` so the browser
		 * decides from the same facts, and the decision is a slot registration — never
		 * a module-graph change the running page could not follow.
		 *
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			installStyles();
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "wsl-windows-folder-picker: dictionaries");
			const t = ctx.locale.bind(NS);
			const scope = ctx.settingsScope.bind({ namespace: SETTINGS_NAMESPACE });

			ctx.slots.inject("settings.section", () =>
				ctx.slots.register(
					{
						name: "settings.section",
						id: "wsl-windows-folder-picker",
						order: SECTION_ORDER,
						// Re-read on every locale change: the shell never subscribes
						// locale state, so the label must resolve lazily.
						label: () => t("section.title"),
						locale: NS,
						inject: () => ({ t, scope }),
					},
					WslPickerSection,
				),
			);

			// Keep the picker surface in step with the live preferences. The
			// disposer removes the registration, which is what hands the single slot
			// back to the shipped browse surface — the live half of the switch.
			ctx.effect(() => {
				let disposers = [];
				let armed = false;
				const unregister = () => {
					armed = false;
					const held = disposers;
					disposers = [];
					for (const dispose of held) {
						try {
							dispose();
						} catch {
							/* a seat already gone must not stop the rest */
						}
					}
				};
				const sync = () => {
					const wanted = wantsNativeSurface(scope.getSnapshot());
					if (wanted === armed) return;
					if (!wanted) {
						unregister();
						return;
					}
					// `slots.inject` can throw synchronously when a declaration is
					// already present and the registration is refused, so the seats are
					// collected first and only committed once every one of them exists.
					// A partial commit would leave one hole native and the other browse.
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
						for (const dispose of created) {
							try {
								dispose();
							} catch {
								/* rolling back the seats that did land */
							}
						}
						throw error;
					}
					disposers = created;
					armed = true;
				};
				sync();
				const dispose = scope.subscribe(sync);
				return () => {
					if (typeof dispose === "function") dispose();
					unregister();
				};
			}, "wsl-windows-folder-picker: picker surface");
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
