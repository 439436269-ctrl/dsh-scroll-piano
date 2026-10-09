/**
 * dsh-scroll-piano — browser half.
 *
 * 鼠标滑过 DSH 界面**右侧边缘的竖条区域**（聊天区滚动条/把手那一条）时，
 * 按鼠标的**纵向位置**发出钢琴音：越靠上音越高、越靠下音越低（特雷门琴式）。
 *
 * 为什么按「窗口右侧竖条 + 坐标」而不是抓某个 DOM 元素：那根滚动条是浏览器
 * **原生滚动条**（不在 DOM 里，类名还带 hash），抓不到也没法定制；用一个全局
 * `pointermove` + `clientX` 落到竖条区间、`clientY` 映射音高，最稳。
 *
 * 声音沿用 dsh-piano 的 Web Audio 实时合成（泛音 + 快速起音 + 指数衰减 +
 * 噪声锤击瞬态 + 低通/压缩），零采样、零网络、零依赖。
 */
window.__ModuleLoader__.load({
	id: "dsh-scroll-piano",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");
		const { useEffect, useRef, useState, useCallback } = React;
		const h = React.createElement;

		//#region styles
		const CSS = [
			".dshscp_pill{box-sizing:border-box;position:fixed;left:132px;bottom:16px;z-index:2147483000;height:32px;display:inline-flex;align-items:center;gap:10px;padding:0 10px;border-radius:16px;background:var(--dsw-alias-bg-elevated,#1f2430);color:var(--dsw-alias-label-primary,#e6e8ee);box-shadow:0 4px 18px rgba(0,0,0,.35);font-size:12px;line-height:16px;cursor:grab;touch-action:none}",
			".dshscp_pill button{box-sizing:border-box;border:none;background:transparent;color:inherit;font:inherit;cursor:pointer;padding:0 2px;display:inline-flex;align-items:center;gap:6px}",
			".dshscp_dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-tertiary,#6b7280)}",
			".dshscp_dotOn{background:#35c46a;box-shadow:0 0 6px rgba(53,196,106,.9)}",
			".dshscp_vol{width:76px;accent-color:var(--dsw-alias-state-business-primary,#5b8def)}",
			".dshscp_strip{position:fixed;top:0;right:0;width:3px;height:100%;z-index:2147482000;pointer-events:none;background:linear-gradient(180deg,rgba(91,141,239,.85),rgba(160,120,240,.85));opacity:0;transition:opacity .15s ease}",
			".dshscp_stripOn{opacity:.55}",
			".dshscp_ticks{position:fixed;top:0;right:0;width:20px;height:100%;z-index:2147482000;pointer-events:none}",
			".dshscp_tick{position:absolute;right:0;width:18px;height:12px;margin-top:-6px;pointer-events:auto;cursor:pointer}",
			".dshscp_tick::after{content:\"\";position:absolute;right:0;top:50%;transform:translateY(-50%);width:7px;height:2px;border-radius:1px;background:rgba(91,141,239,.95);box-shadow:0 0 4px rgba(91,141,239,.7);transition:all .12s ease}",
			".dshscp_tick:hover::after{width:16px;box-shadow:0 0 7px rgba(91,141,239,1)}",
			".dshscp_marker{position:fixed;right:0;width:7px;height:7px;border-radius:50%;z-index:2147482001;pointer-events:none;background:#fff;box-shadow:0 0 8px rgba(160,120,240,.95);opacity:0;transition:opacity .1s ease}",
			".dshscp_markerOn{opacity:1}",
			".dshscp_prev{position:fixed;right:18px;z-index:2147482002;pointer-events:none;max-width:min(320px,42vw);padding:7px 10px;border-radius:9px;background:rgba(20,24,32,.95);color:#e6e8ee;box-shadow:0 6px 22px rgba(0,0,0,.45);opacity:0;transition:opacity .1s ease}",
			".dshscp_prevOn{opacity:1}",
			".dshscp_prevTop{display:flex;align-items:center;gap:8px;margin-bottom:4px}",
			".dshscp_prevRole{flex:none;padding:1px 5px;border-radius:4px;background:rgba(91,141,239,.3);color:#bcd4ff;font-size:10px;line-height:14px}",
			".dshscp_prevRoleAI{background:rgba(160,120,240,.28);color:#d6c4ff}",
			".dshscp_prevText{font-size:12px;line-height:17px;color:#e6e8ee;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;word-break:break-word}"
		].join("");
		const tagId = "dsh-scroll-piano/scroll-piano.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const style = document.createElement("style");
			style.setAttribute("data-plugin-css", tagId);
			style.textContent = CSS;
			document.head.appendChild(style);
		}

		//#region audio engine
		let _ctx = null;
		let _out = null;
		let _noiseBuf = null;
		function audioCtx() {
			if (!_ctx) {
				const AC = window.AudioContext || window.webkitAudioContext;
				if (!AC) return null;
				_ctx = new AC();
			}
			if (_ctx.state === "suspended") _ctx.resume().catch(() => {});
			return _ctx;
		}
		function midiToFreq(m) {
			return 440 * Math.pow(2, (m - 69) / 12);
		}
		/**
		 * 共享输出链（只建一次）：总线 → 低通 → 压缩器。
		 * 所有音共用一个压缩器，滑奏时多音叠加由它统一压住：既防削波，
		 * 也避免每个音都重建一条 master/lowpass/compressor 链。
		 */
		function outputChain(ctx) {
			if (_out) return _out;
			const master = ctx.createGain();
			master.gain.value = 0.85;
			const lp = ctx.createBiquadFilter();
			lp.type = "lowpass";
			lp.frequency.value = 6500;
			lp.Q.value = 0.3;
			const comp = ctx.createDynamicsCompressor();
			comp.threshold.value = -22;
			comp.knee.value = 24;
			comp.ratio.value = 12;
			comp.attack.value = 0.004;
			comp.release.value = 0.18;
			master.connect(lp);
			lp.connect(comp);
			comp.connect(ctx.destination);
			_out = master;
			return master;
		}
		/**
		 * 缓存的锤击噪声缓冲（只建一次）。
		 * 上一版每个音都新建一个 AudioBuffer，快速滑动时分配抖动会引入杂音。
		 */
		function noiseBuffer(ctx) {
			if (_noiseBuf) return _noiseBuf;
			const len = Math.max(1, Math.floor(ctx.sampleRate * 0.02));
			const buf = ctx.createBuffer(1, len, ctx.sampleRate);
			const data = buf.getChannelData(0);
			for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
			_noiseBuf = buf;
			return buf;
		}
		/**
		 * 合成一枚「电钢」音：基音 + 3 枚泛音（各带指数衰减）+ 极轻的击弦瞬态。
		 * 泛音改成更少更柔的正弦、瞬态降到 0.05 倍，叠加时靠共享压缩器兜底。
		 */
		function playNote(midi, volume) {
			if (volume <= 0.01) return;
			const ctx = audioCtx();
			if (!ctx) return;
			const out = outputChain(ctx);
			const freq = midiToFreq(midi);
			const now = ctx.currentTime;
			const v = Math.max(0.02, Math.min(1, volume));

			const partials = [
				{ r: 1, a: 0.85, d: 2.0, type: "sine" },
				{ r: 2, a: 0.28, d: 1.1, type: "sine" },
				{ r: 3, a: 0.11, d: 0.6, type: "sine" },
				{ r: 4, a: 0.045, d: 0.4, type: "sine" }
			];
			for (const p of partials) {
				const osc = ctx.createOscillator();
				osc.type = p.type;
				osc.frequency.value = freq * p.r;
				osc.detune.value = (Math.random() - 0.5) * 3;
				const g = ctx.createGain();
				g.gain.setValueAtTime(0.0001, now);
				g.gain.linearRampToValueAtTime(p.a * v, now + 0.006);
				g.gain.exponentialRampToValueAtTime(0.0001, now + p.d);
				osc.connect(g);
				g.connect(out);
				osc.start(now);
				osc.stop(now + p.d + 0.08);
			}

			// 极轻的击弦瞬态：只留一点触键质感，不再是明显嘶声
			const noise = ctx.createBufferSource();
			noise.buffer = noiseBuffer(ctx);
			const hp = ctx.createBiquadFilter();
			hp.type = "highpass";
			hp.frequency.value = 2500;
			const ng = ctx.createGain();
			ng.gain.value = v * 0.05;
			noise.connect(hp);
			hp.connect(ng);
			ng.connect(out);
			noise.start(now);
		}

		//#region chat anchors
		/** 聊天区的滚动容器（从 `[data-chat-flow]` 往上找第一个可纵向滚动的祖先）。 */
		function findChatScroller() {
			const flow = document.querySelector("[data-chat-flow]");
			if (!flow) return null;
			let sc = flow.parentElement;
			while (sc && sc !== document.body) {
				const cs = getComputedStyle(sc);
				if (/(auto|scroll)/.test(cs.overflowY) && sc.clientHeight > 120) break;
				sc = sc.parentElement;
			}
			return sc && sc !== document.body ? sc : flow;
		}

		/**
		 * 聊天区滚动容器的度量。`right` 用来把触发区钉在聊天区右边缘（右侧栏打开时不盖面板）；
		 * `top/scrollTop/scrollHeight` 用来把**整段对话**压进竖条做小地图。
		 *
		 * 拿不到聊天区（欢迎页 / 新会话还没消息）时返回 null——调用方**退回窗口右边缘**，
		 * 否则那类页面连钢琴声都不出（踩过）。
		 */
		function chatViewport() {
			const el = findChatScroller();
			if (!el) return null;
			const r = el.getBoundingClientRect();
			return {
				right: Math.round(r.right),
				top: Math.round(r.top),
				scrollTop: el.scrollTop,
				scrollHeight: Math.max(1, el.scrollHeight),
				clientHeight: Math.max(1, el.clientHeight)
			};
		}

		/**
		 * 把**整段对话**映射成竖条上的小地图刻度：每条用户消息一个 y（0..视口高）。
		 *
		 * y 取的是「消息在**滚动内容**里的偏移 / 内容总长」，**与 scrollTop 无关**——
		 * 所以不管滚到哪、滚多远，自己的消息刻度**始终在那**，看得见也点得到。
		 * （上一版按视口坐标定位：滚到对话底部时你的消息 y 是 -4339，全跑到屏幕外了。）
		 */
		function minimapTicks(view) {
			const flow = document.querySelector("[data-chat-flow]");
			if (!flow || !view) return [];
			const out = [];
			for (const el of flow.children) {
				const key = String(el.getAttribute("data-chat-flow-key") || el.getAttribute("data-chat-node-key") || "");
				if (!/input-message/.test(key)) continue;
				const r = el.getBoundingClientRect();
				if (r.height <= 0) continue;
				if (!(el.innerText || "").trim()) continue;
				// 视口坐标 + 已滚动量 = 在滚动内容里的坐标
				const contentCenter = r.top - view.top + view.scrollTop + r.height / 2;
				const y = Math.round(contentCenter / view.scrollHeight * window.innerHeight);
				out.push({ y, el });
			}
			return out;
		}

		/** 取小地图纵坐标 y 附近（±TOL）的那条用户消息；没有就 null → 气泡收起。 */
		function messageNearTick(y, ticks) {
			const TOL = 16;
			let best = null;
			let bestD = Infinity;
			for (const t of ticks) {
				const d = Math.abs(t.y - y);
				if (d <= TOL && d < bestD) { bestD = d; best = t; }
			}
			return best;
		}

		//#region settings
		const LS_KEY = "dsh-scroll-piano:settings";
		const DEFAULTS = { on: true, volume: 0.25, stripWidth: 30, lowNote: 48, highNote: 84, inset: 56 };
		function loadSettings() {
			try {
				return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(LS_KEY) || "{}")) };
			} catch {
				return { ...DEFAULTS };
			}
		}
		function saveSettings(s) {
			try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch {}
		}

		//#region component
		function ScrollPiano() {
			const [settings, setSettings] = useState(loadSettings);
			// —— 左下角那条黑胶囊**可拖动**（音量滑块除外，它自己要收拖动事件）——
			const [pillPos, setPillPos] = useState(() => {
				try { return JSON.parse(localStorage.getItem("dsh-scroll-piano:pillPos") || "null"); } catch { return null; }
			});
			const pillPosRef = useRef(pillPos);
			pillPosRef.current = pillPos;
			const pillDragRef = useRef(null);
			const pillDraggedRef = useRef(false);
			const pillClearRef = useRef(0);
			const onPillDown = (e) => {
				// 按在音量滑块上不进拖动，否则调音量会被拖走
				if (e.target && e.target.tagName === "INPUT") return;
				if (e.pointerType === "mouse" && e.button !== 0) return;
				pillDraggedRef.current = false;
				const r = e.currentTarget.getBoundingClientRect();
				pillDragRef.current = { x: e.clientX, y: e.clientY, left: r.left, top: r.top, moved: false };
				try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
			};
			const onPillMove = (e) => {
				const d = pillDragRef.current;
				if (!d) return;
				const dx = e.clientX - d.x;
				const dy = e.clientY - d.y;
				if (!d.moved && Math.abs(dx) + Math.abs(dy) > 6) d.moved = true;
				if (!d.moved) return;
				const left = Math.max(4, Math.min(window.innerWidth - 60, d.left + dx));
				const top = Math.max(4, Math.min(window.innerHeight - 40, d.top + dy));
				pillPosRef.current = { left, top };
				setPillPos({ left, top });
			};
			const onPillUp = (e) => {
				const d = pillDragRef.current;
				pillDragRef.current = null;
				try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
				if (!d || !d.moved) return;
				pillDraggedRef.current = true;
				const pos = pillPosRef.current;
				if (pos) { try { localStorage.setItem("dsh-scroll-piano:pillPos", JSON.stringify(pos)); } catch {} }
				// 拖完不一定紧跟 click → 400ms 自动清，别吞掉下一次真正点击
				if (pillClearRef.current) window.clearTimeout(pillClearRef.current);
				pillClearRef.current = window.setTimeout(() => { pillDraggedRef.current = false; }, 400);
			};
			const settingsRef = useRef(settings);
			settingsRef.current = settings;
			const lastMidiRef = useRef(null);
			const lastPlayRef = useRef(0);
			const stripRef = useRef(null);
			const markerRef = useRef(null);
			const prevRef = useRef(null);
			const roleRef = useRef(null);
			const textRef = useRef(null);
			const ticksRef = useRef(null);
			const ticksDataRef = useRef([]); // [{y, el}] — 小地图刻度数据（showPreview 靠它找消息）
			const jumpToRef = useRef(() => {});
			const activeMsgRef = useRef(null);

			const setOn = useCallback((on) => {
				setSettings((s) => {
					const next = { ...s, on };
					saveSettings(next);
					return next;
				});
				if (on) audioCtx();
			}, []);
			const setVolume = useCallback((volume) => {
				setSettings((s) => {
					const next = { ...s, volume };
					saveSettings(next);
					return next;
				});
			}, []);

			useEffect(() => {
				let ro = null;
				let roEl = null;
				let mo = null;
				let moTimer = 0;
				let tickTimer = 0;
				/** 平滑滚动到某条消息（点蓝条 / 点气泡都走这里）。 */
				const jumpTo = (el) => {
					if (!el) return;
					try { el.scrollIntoView({ behavior: "smooth", block: "center" }); }
					catch { try { el.scrollIntoView(); } catch {} }
					activeMsgRef.current = null;
					if (prevRef.current) {
						prevRef.current.classList.remove("dshscp_prevOn");
						prevRef.current.style.pointerEvents = "none";
					}
					if (markerRef.current) markerRef.current.classList.remove("dshscp_markerOn");
				};
				jumpToRef.current = jumpTo;
				/** 点竖条上的蓝色小横杠 → 跳到那条消息（事件委托，刻度是动态增删的）。 */
				const onTickClick = (e) => {
					const t = e.target;
					if (!t || !t.classList || !t.classList.contains("dshscp_tick")) return;
					const idx = parseInt(t.getAttribute("data-i"), 10);
					if (idx >= 0) jumpTo(ticksDataRef.current[idx] && ticksDataRef.current[idx].el);
				};
				/** 竖条上给「我的消息」打小地图刻度：不管滚到哪，自己的消息始终标在那。 */
				const refreshTicks = () => {
					const box = ticksRef.current;
					const view = chatViewport();
					const data = minimapTicks(view);
					ticksDataRef.current = data;
					if (!box) return;
					while (box.children.length > data.length) box.removeChild(box.lastChild);
					while (box.children.length < data.length) {
						const i = document.createElement("i");
						i.className = "dshscp_tick";
						box.appendChild(i);
					}
					for (let i = 0; i < data.length; i++) {
						box.children[i].style.top = data[i].y + "px";
						box.children[i].setAttribute("data-i", String(i));
					}
				};
				// 对话增长 / 面板开合会改内容总长 → 节流到 150ms 重算（刻度与 scrollTop 无关，滚动不用重算）
				const scheduleTicks = () => {
					if (tickTimer) return;
					tickTimer = window.setTimeout(() => { tickTimer = 0; refreshTicks(); }, 150);
				};
				/** 把竖条 / 圆点 / 气泡钉到聊天区右边缘（右侧面板打开时跟着左移）。 */
				const placeAtChatEdge = () => {
					const view = chatViewport();
					const rightPx = view ? Math.max(0, window.innerWidth - view.right) : 0;
					if (stripRef.current) stripRef.current.style.right = rightPx + "px";
					if (markerRef.current) markerRef.current.style.right = rightPx + "px";
					if (prevRef.current) prevRef.current.style.right = rightPx + 18 + "px";
					if (ticksRef.current) ticksRef.current.style.right = rightPx + "px";
					scheduleTicks();
					// 面板开合 / 窗口缩放会改聊天容器宽度 → 挂 ResizeObserver 跟着走
					const sc = findChatScroller();
					if (ro && sc && sc !== roEl) {
						if (roEl) ro.unobserve(roEl);
						ro.observe(sc);
						roEl = sc;
					}
					return view;
				};
				if (typeof ResizeObserver !== "undefined") ro = new ResizeObserver(() => placeAtChatEdge());
				// 右侧面板开合是 DOM 增删（不一定触发 resize）→ 用 MutationObserver 兜底，
				// 只监听 childList（不监听 attributes，避免自己写 style 造成回环）。
				if (typeof MutationObserver !== "undefined") {
					mo = new MutationObserver(() => {
						if (moTimer) return;
						moTimer = window.setTimeout(() => { moTimer = 0; placeAtChatEdge(); }, 200);
					});
					mo.observe(document.body, { childList: true, subtree: true });
				}
				const showMarker = (y) => {
					const m = markerRef.current;
					if (m) m.style.top = Math.round(y - 3.5) + "px";
				};
				/**
				 * 气泡**只在鼠标压在某条「用户消息」上时出现**，内容只有那条消息的正文。
				 * 其余位置（AI 回复 / 工具块 / 空白）整个收起——不放音名、不放 MIDI 数字。
				 */
				const showPreview = (y, msg) => {
					const el = prevRef.current;
					if (!el) return;
					if (!msg) {
						activeMsgRef.current = null;
						el.classList.remove("dshscp_prevOn");
						el.style.pointerEvents = "none";
						return;
					}
					activeMsgRef.current = msg;
					// 内容现取现算（消息可能被重新渲染）；去掉末尾的 HH:MM 时间戳
					if (textRef.current) {
						textRef.current.textContent = (msg.el.innerText || "")
							.replace(/\s+/g, " ").trim().replace(/\s*\d{1,2}:\d{2}$/, "").trim();
					}
					el.style.pointerEvents = "auto";
					el.style.cursor = "pointer";
					// 竖直居中于鼠标，并夹在视口内
					const h = el.offsetHeight || 40;
					const top = Math.max(8, Math.min(window.innerHeight - h - 8, y - h / 2));
					el.style.top = Math.round(top) + "px";
					el.classList.add("dshscp_prevOn");
				};
				const hidePreview = () => {
					activeMsgRef.current = null;
					if (prevRef.current) {
						prevRef.current.classList.remove("dshscp_prevOn");
						prevRef.current.style.pointerEvents = "none";
					}
					if (markerRef.current) markerRef.current.classList.remove("dshscp_markerOn");
				};

				/** 鼠标是否正压在气泡上（压在气泡上时别收掉，用户要点它跳转）。 */
				const overBubble = (x, y) => {
					const el = prevRef.current;
					if (!el || !el.classList.contains("dshscp_prevOn")) return false;
					const r = el.getBoundingClientRect();
					return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
				};

				const onMove = (e) => {
					const s = settingsRef.current;
					if (!s.on) return;
					if (overBubble(e.clientX, e.clientY)) return; // 鼠标停在气泡上（正要点击）
					const view = placeAtChatEdge();
					// 没有聊天区（欢迎页 / 新会话还没消息）→ 退回窗口右边缘，声音照出（踩过：这里 return 会让声音都没）
					const baseRight = view ? view.right : window.innerWidth;
					if (e.clientX < baseRight - s.stripWidth || e.clientX > baseRight + 2) {
						lastMidiRef.current = null;
						hidePreview();
						return;
					}
					const span = Math.max(1, window.innerHeight - s.inset * 2);
					const t = Math.min(1, Math.max(0, (e.clientY - s.inset) / span));
					// t=0（顶部）→ highNote；t=1（底部）→ lowNote
					const midi = Math.round(s.highNote - t * (s.highNote - s.lowNote));
					showMarker(e.clientY);
					// 预览只挑「我发的消息」里离该刻度最近的那条（不显示音名/MIDI）
					showPreview(e.clientY, messageNearTick(e.clientY, ticksDataRef.current));
					if (markerRef.current) markerRef.current.classList.add("dshscp_markerOn");
					if (midi !== lastMidiRef.current) {
						lastMidiRef.current = midi;
						// 限速：滑太快时不要瞬间堆几十个音（会糊成一片杂音）
						const nowMs = performance.now();
						if (nowMs - lastPlayRef.current >= 24) {
							lastPlayRef.current = nowMs;
							playNote(midi, s.volume);
						}
					}
				};
				const onLeave = () => {
					lastMidiRef.current = null;
					hidePreview();
				};
				document.addEventListener("pointermove", onMove, { passive: true });
				document.addEventListener("pointerleave", onLeave);
				// 不需要监听 scroll：刻度是按「内容偏移/内容总长」算的，与 scrollTop 无关
				if (ticksRef.current) ticksRef.current.addEventListener("click", onTickClick);
				window.addEventListener("blur", onLeave);
				window.addEventListener("resize", placeAtChatEdge);
				placeAtChatEdge();
				return () => {
					document.removeEventListener("pointermove", onMove);
					document.removeEventListener("pointerleave", onLeave);
					if (ticksRef.current) ticksRef.current.removeEventListener("click", onTickClick);
					window.removeEventListener("blur", onLeave);
					window.removeEventListener("resize", placeAtChatEdge);
					if (ro) ro.disconnect();
					if (mo) mo.disconnect();
					if (moTimer) window.clearTimeout(moTimer);
					if (tickTimer) window.clearTimeout(tickTimer);
				};
			}, []);

			/** 点气泡也跳（文字提示已去掉，主入口是点蓝条）。 */
			const onBubbleClick = () => jumpToRef.current(activeMsgRef.current && activeMsgRef.current.el);

			// 竖条 + 「我的消息」刻度（**点蓝色小横杠跳过去**）+ 位置圆点 + 预览气泡
			return h(React.Fragment, null,
				h("div", { ref: stripRef, className: "dshscp_strip" + (settings.on ? " dshscp_stripOn" : "") }),
				h("div", { ref: ticksRef, className: "dshscp_ticks" }),
				h("div", { ref: markerRef, className: "dshscp_marker" }),
				h("div", {
					ref: prevRef,
					className: "dshscp_prev",
					onClick: onBubbleClick
				},
					h("div", { className: "dshscp_prevTop" },
						h("span", { ref: roleRef, className: "dshscp_prevRole" }, "你")
					),
					h("div", { ref: textRef, className: "dshscp_prevText" })
				),
				h("div", {
					className: "dshscp_pill",
					onPointerDown: onPillDown,
					onPointerMove: onPillMove,
					onPointerUp: onPillUp,
					onPointerCancel: onPillUp,
					style: pillPos ? { left: pillPos.left + "px", top: pillPos.top + "px", bottom: "auto" } : undefined
				},
					h("button", {
						onClick: () => {
							if (pillDraggedRef.current) { pillDraggedRef.current = false; return; } // 刚才是拖，不是点
							setOn(!settings.on);
						},
						title: settings.on ? "关闭滚动钢琴" : "开启滚动钢琴"
					},
						h("span", { className: "dshscp_dot" + (settings.on ? " dshscp_dotOn" : "") }),
						"🎵 滚动钢琴" + (settings.on ? " ON" : " OFF")
					),
					h("input", {
						className: "dshscp_vol",
						type: "range",
						min: 0,
						max: 1,
						step: 0.05,
						value: settings.volume,
						onChange: (e) => setVolume(parseFloat(e.target.value)),
						title: "音量"
					})
				)
			);
		}

		//#region apply
		const inject = ["slots"];
		function apply(ctx) {
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "dsh-scroll-piano:overlay",
				order: 110,
				inject: () => ({})
			}, ScrollPiano));
		}
		exports.apply = apply;
		exports.inject = inject;

		return module.exports;
	}
});
