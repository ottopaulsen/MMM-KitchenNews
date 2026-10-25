/* MMM-KitchenNews - MMM-KitchenNews.js
 *
 * Simple single-line news ticker for the kitchen monitor (works elsewhere too).
 *
 * Each article is rendered as:   LOGO 4/12 Title (3 hours): summary...
 * on one line, the logo and a "position/total" counter inline in front of the
 * title. The first article scrolls in from the right, then the row scrolls left
 * continuously and loops. Articles are mixed across sources, newest first.
 *
 * See README.md for the full option reference.
 */

Module.register("MMM-KitchenNews", {

	defaults: {
		// Sources. Each: { name, url, logo?, encoding?, maxAgeHours?, maxCount?, id? }
		// maxAgeHours / maxCount fall back to the globals below when omitted.
		sources: [],

		// Global fallbacks + overall cap
		maxAgeHours: 24,       // drop articles older than this
		maxCount: 5,           // max articles kept per source
		maxTotalCount: 30,     // overall cap; oldest discarded when exceeded
		skipIfNoSummary: false,// global + per-source: if true, only show articles that have a summary

		// Category filtering (global + per-source; a list on the source overrides the global one).
		// Matching is exact. Empty lists = no filtering.
		categories: [],        // if non-empty: only show articles tagged with one of these
		excludeCategories: [], // if non-empty: hide articles tagged with any of these (wins over categories)

		// Display mode: 1 = continuous ticker (scrolls), 2 = one fixed article at a
		// time, left-aligned, fading in and out. mode is a global (module) option.
		mode: 1,
		lines: 2,              // mode 2: number of text lines to show per article
		showTimeSeconds: 8,    // mode 2: seconds the article stays fully visible before fading
		fadeTimeSeconds: 1,    // mode 2: fade in/out duration in seconds (decimals allowed)
		justifyText: "left",   // mode 2: horizontal text alignment - "left", "right" or "center"
		alignLogo: "center",   // mode 2: vertical logo alignment vs the text - "top", "bottom" or "center"

		// Motion (mode 1)
		speed: 175,            // scroll speed in pixels per second (constant - identical at any bar width; 0 = frozen)
		clearBeforeNext: false,// false: next trails the previous with a gap; true: wait until previous is gone
		gapBetweenArticles: 80,// px of empty space between articles (clearBeforeNext=false)

		// Layout
		height: 56,            // px, max height of the bar
		width: 0,              // px, explicit bar width; 0 = fill the region. Full-width "bar" regions
		                       // (top_bar/bottom_bar) fill on their own; centered regions
		                       // (top_center, ...) have no width of their own, so set this there.
		titleSize: 40,         // font size of the title (number = px, or any CSS size string)
		summarySize: 36,       // font size of age + summary
		maxLogoWidth: 100,     // px, max width of the logo (height follows the title size)

		// Margin around the bar (px). Some room above, none below by default.
		marginTop: 8,
		marginRight: 0,
		marginBottom: 0,
		marginLeft: 0,

		// Progress bar - a scroll-bar-style block marking which article (of N) is showing.
		// It spans the whole module width; its height is on top of `height`, and the outer
		// margin stays outside it too.
		showProgressBar: true,
		progressBarPosition: "bottom", // "top" or "bottom" - above or below the text
		progressBarMargin: 4,          // px between the text and the progress bar
		progressBarHeight: 3,          // px, height of the progress bar
		progressBarColour: "white",    // colour of the moving block
		progressBarOpacity: 50,        // percent (0-100)
		progressBarWidth: 0,           // px width of the moving block; 0 = total width / number of articles

		// Fetching
		fetchInterval: 10 * 60 * 1000, // how often feeds are re-fetched (ms)
		logoFallback: true,    // when a source has no logo, use its site favicon
		showAge: true          // show "(3 hours)" after the title
	},

	getStyles () {
		return ["MMM-KitchenNews.css"];
	},

	start () {
		this.feedItems = {};   // id -> [items]
		this.errors = {};      // id -> error info
		this.currentList = [];
		this.lastHash = "";
		this._raf = null;
		this.sources = this.prepareSources();

		this.sendSocketNotification("KN_SET_FEEDS", {
			sources: this.sources.map((s) => ({ id: s.id, url: s.url, encoding: s.encoding })),
			fetchInterval: this.config.fetchInterval,
			userAgent: "Mozilla/5.0 (compatible; MMM-KitchenNews/1.0; +https://magicmirror.builders)"
		});
	},

	// Normalise the configured sources: assign ids, names, logos and per-source limits.
	prepareSources () {
		return (this.config.sources || []).map((s, idx) => {
			let host = "";
			try { host = new URL(s.url).hostname.replace(/^www\./, ""); } catch (error) { host = ""; }
			const id = s.id || s.name || host || `src${idx}`;
			const name = s.name || host || id;
			let logo = s.logo || null;
			if (!logo && this.config.logoFallback && host) {
				logo = `https://www.google.com/s2/favicons?domain=${host}&sz=64`;
			}
			return {
				id,
				name,
				url: s.url,
				encoding: s.encoding || "UTF-8",
				logo,
				maxAgeHours: (s.maxAgeHours !== undefined && s.maxAgeHours !== null) ? s.maxAgeHours : this.config.maxAgeHours,
				maxCount: (s.maxCount !== undefined && s.maxCount !== null) ? s.maxCount : this.config.maxCount,
				skipIfNoSummary: (s.skipIfNoSummary !== undefined && s.skipIfNoSummary !== null) ? s.skipIfNoSummary : this.config.skipIfNoSummary,
				categories: Array.isArray(s.categories) ? s.categories : (this.config.categories || []),
				excludeCategories: Array.isArray(s.excludeCategories) ? s.excludeCategories : (this.config.excludeCategories || [])
			};
		});
	},

	socketNotificationReceived (notification, payload) {
		if (notification === "KN_ITEMS") {
			this.feedItems[payload.id] = payload.items || [];
			this.maybeUpdate();
		} else if (notification === "KN_ERROR") {
			this.errors[payload.id] = payload;
		}
	},

	// Merge all sources into one list: per-source age + count filters, then a
	// global newest-first sort, then the global total cap.
	buildList () {
		const now = Date.now();
		let all = [];

		for (const source of this.sources) {
			const raw = this.feedItems[source.id] || [];
			const maxAgeMs = (source.maxAgeHours || 0) * 3600 * 1000;

			let list = raw.map((it) => {
				const t = it.pubdate ? Date.parse(it.pubdate) : NaN;
				return { title: it.title, summary: it.summary, url: it.url, categories: it.categories || [], ts: isNaN(t) ? null : t, source };
			});

			if (maxAgeMs > 0) {
				list = list.filter((a) => a.ts !== null && (now - a.ts) <= maxAgeMs);
			}
			if (source.skipIfNoSummary) {
				list = list.filter((a) => a.summary && a.summary.trim().length > 0);
			}
			if (source.categories && source.categories.length) {
				const want = new Set(source.categories);
				list = list.filter((a) => a.categories.some((c) => want.has(c)));
			}
			if (source.excludeCategories && source.excludeCategories.length) {
				const block = new Set(source.excludeCategories);
				list = list.filter((a) => !a.categories.some((c) => block.has(c)));
			}
			list.sort((a, b) => (b.ts || 0) - (a.ts || 0));
			if (source.maxCount > 0) list = list.slice(0, source.maxCount);

			all = all.concat(list);
		}

		all.sort((a, b) => (b.ts || 0) - (a.ts || 0)); // newest first, sources mixed
		if (this.config.maxTotalCount > 0) all = all.slice(0, this.config.maxTotalCount);
		return all;
	},

	maybeUpdate () {
		const list = this.buildList();
		const hash = list.map((a) => `${a.source.id}|${a.ts || 0}|${a.title}`).join("~~");
		if (hash === this.lastHash && list.length) return; // nothing changed
		this.lastHash = hash;
		this.currentList = list;
		this.updateDom(0);
	},

	getDom () {
		this.stopEngine(); // stop the previous render's engine before replacing the DOM

		const mode = Number(this.config.mode) === 2 ? 2 : 1;
		const wrap = document.createElement("div");
		wrap.className = mode === 2 ? "kn-wrap kn-mode2" : "kn-wrap";
		wrap.style.setProperty("--kn-height", this.cssSize(this.config.height));
		wrap.style.setProperty("--kn-logo-h", this.cssSize(this.config.height));
		wrap.style.setProperty("--kn-logo-w", this.cssSize(this.config.maxLogoWidth));
		wrap.style.setProperty("--kn-title-size", this.cssSize(this.config.titleSize));
		wrap.style.setProperty("--kn-summary-size", this.cssSize(this.config.summarySize));
		wrap.style.setProperty("--kn-lines", String(Math.max(1, Number(this.config.lines) || 1)));
		const alignLogoMap = { top: "flex-start", bottom: "flex-end", center: "center" };
		wrap.style.setProperty("--kn-align-logo", alignLogoMap[this.config.alignLogo] || "center");
		wrap.style.setProperty("--kn-justify-text", ["left", "right", "center"].includes(this.config.justifyText) ? this.config.justifyText : "left");
		// A fixed line height lets mode 2 reserve exactly `lines` lines of height, so a
		// short (one-line) article keeps the same footprint as a full one and the rest
		// of the screen doesn't jump. Derived from the larger of the two font sizes.
		const toPx = (v) => (typeof v === "number" ? v : (isNaN(Number(v)) ? null : Number(v)));
		const tsPx = toPx(this.config.titleSize);
		const ssPx = toPx(this.config.summarySize);
		wrap.style.setProperty("--kn-line-h", (tsPx !== null && ssPx !== null) ? `${Math.round(Math.max(tsPx, ssPx) * 1.3)}px` : "1.3em");
		wrap.style.marginTop = this.cssSize(this.config.marginTop);
		wrap.style.marginRight = this.cssSize(this.config.marginRight);
		wrap.style.marginBottom = this.cssSize(this.config.marginBottom);
		wrap.style.marginLeft = this.cssSize(this.config.marginLeft);
		// A centered region gives the bar no width of its own; an explicit width fixes that.
		if (this.config.width) wrap.style.width = this.cssSize(this.config.width);

		const list = this.currentList || [];
		if (!list.length) {
			const empty = document.createElement("div");
			empty.className = "kn-empty dimmed small";
			empty.textContent = Object.keys(this.feedItems).length ? "No current news" : "Loading news …";
			wrap.appendChild(empty);
			return wrap;
		}

		const bar = document.createElement("div");
		bar.className = "kn-bar";
		const total = list.length;

		this.dom = { wrap, bar, mode };

		if (mode === 2) {
			// One article at a time; the mode-2 driver swaps and fades the content.
			const stage = document.createElement("div");
			stage.className = "kn-stage";
			bar.appendChild(stage);
			this.dom.stage = stage;
		} else {
			const vp = document.createElement("div");
			vp.className = "kn-viewport";
			const track = document.createElement("div");
			track.className = "kn-track";
			const segs = [];
			list.forEach((a, idx) => {
				const art = this.buildArticle(a, idx, total, 1);
				track.appendChild(art);
				segs.push({ el: art, article: a });
			});
			vp.appendChild(track);
			bar.appendChild(vp);
			this.dom.vp = vp;
			this.dom.track = track;
			this.dom.segs = segs;
		}

		// Progress bar (both modes): a transparent track with a visible block that
		// steps across it as the shown article changes (like a scroll bar).
		let progress = null;
		let progressBlock = null;
		if (this.config.showProgressBar) {
			progress = document.createElement("div");
			progress.className = "kn-progress";
			progress.style.height = this.cssSize(this.config.progressBarHeight);
			progressBlock = document.createElement("div");
			progressBlock.className = "kn-progress-block";
			progressBlock.style.background = String(this.config.progressBarColour);
			progressBlock.style.opacity = String((Number(this.config.progressBarOpacity) || 0) / 100);
			progress.appendChild(progressBlock);
		}

		const progressOnTop = this.config.progressBarPosition === "top";
		if (progress && progressOnTop) {
			progress.style.marginBottom = this.cssSize(this.config.progressBarMargin);
			wrap.appendChild(progress);
		}
		wrap.appendChild(bar);
		if (progress && !progressOnTop) {
			progress.style.marginTop = this.cssSize(this.config.progressBarMargin);
			wrap.appendChild(progress);
		}

		this.dom.progress = progress;
		this.dom.progressBlock = progressBlock;

		// Start the engine once the DOM is attached and measurable.
		requestAnimationFrame(() => this.startEngine());

		return wrap;
	},

	// Build one article element. mode 1 lays it out inline on a single line; mode 2
	// puts the logo beside a text block that wraps to `lines` lines.
	buildArticle (a, idx, total, mode) {
		const art = document.createElement("span");
		art.className = "kn-article";
		if (mode === 1) art.style.transform = "translate3d(10000px, 0, 0)"; // parked until placed

		// Logo.
		const logo = document.createElement("span");
		logo.className = "kn-logo";
		const img = document.createElement("img");
		img.className = "kn-logo-img";
		const txt = document.createElement("span");
		txt.className = "kn-logo-txt";
		txt.textContent = a.source.name;
		txt.style.display = "none";
		img.addEventListener("error", () => {
			img.style.display = "none";
			txt.style.display = "inline";
		});
		if (a.source.logo) {
			img.src = a.source.logo;
			img.alt = a.source.name;
		} else {
			img.style.display = "none";
			txt.style.display = "inline";
		}
		logo.appendChild(img);
		logo.appendChild(txt);
		art.appendChild(logo);

		// Text: counter, title, age, summary (one line in mode 1, wrapped in mode 2).
		const text = document.createElement("span");
		text.className = "kn-text";

		const count = document.createElement("span");
		count.className = "kn-count";
		count.textContent = `${idx + 1}/${total}`;
		text.appendChild(count);

		const title = document.createElement("span");
		title.className = "kn-title";
		title.textContent = a.title;
		text.appendChild(title);

		if (this.config.showAge) {
			const age = document.createElement("span");
			age.className = "kn-age";
			age.textContent = ` (${this.ageString(a.ts)})`;
			text.appendChild(age);
		}

		if (a.summary) {
			const sep = document.createElement("span");
			sep.className = "kn-sep";
			sep.textContent = ": ";
			text.appendChild(sep);

			const sum = document.createElement("span");
			sum.className = "kn-summary";
			sum.textContent = a.summary;
			text.appendChild(sum);
		}

		art.appendChild(text);
		return art;
	},

	// Pick the driver for the current mode.
	startEngine () {
		if (this.dom && this.dom.mode === 2) this.startMode2();
		else this.initEngine();
	},

	// Mode 2: show one article at a time, fixed to the left, fading in and out.
	startMode2 () {
		const d = this.dom;
		const list = this.currentList || [];
		if (!d || !d.stage || !list.length) return;
		this.stopMode2();
		this.state = { i: 0 };

		// Progress geometry: the block steps once per article.
		if (d.progress && d.progressBlock) {
			const totalW = d.progress.clientWidth || d.bar.clientWidth || 0;
			d.progStep = totalW / list.length;
			const blockW = (Number(this.config.progressBarWidth) > 0) ? Number(this.config.progressBarWidth) : d.progStep;
			d.progressBlock.style.width = `${blockW}px`;
		}

		this.m2Show(0);
	},

	// Render article `idx`, fade it in, hold, fade it out, then advance.
	m2Show (idx) {
		const d = this.dom;
		const list = this.currentList || [];
		if (!d || !d.stage || !list.length) return;
		const n = list.length;
		idx = ((idx % n) + n) % n;
		this.state = this.state || {};
		this.state.i = idx;

		const fadeMs = Math.max(0, Number(this.config.fadeTimeSeconds) || 0) * 1000;
		const showMs = Math.max(0, Number(this.config.showTimeSeconds) || 0) * 1000;

		const art = this.buildArticle(list[idx], idx, n, 2);
		art.style.opacity = "0";
		art.style.transition = `opacity ${fadeMs}ms linear`;
		d.stage.replaceChildren(art);
		this.updateProgress();

		// Fade in on the next frame (so the 0 opacity is applied first).
		this._m2raf = requestAnimationFrame(() => { art.style.opacity = "1"; });

		// Hold, then fade out, then advance.
		this._m2t1 = setTimeout(() => {
			art.style.opacity = "0";
			this._m2t2 = setTimeout(() => this.m2Show(idx + 1), fadeMs);
		}, fadeMs + showMs);
	},

	// Stop the mode-2 cycle and clear its timers.
	stopMode2 () {
		if (this._m2raf) { cancelAnimationFrame(this._m2raf); this._m2raf = null; }
		if (this._m2t1) { clearTimeout(this._m2t1); this._m2t1 = null; }
		if (this._m2t2) { clearTimeout(this._m2t2); this._m2t2 = null; }
	},

	initEngine () {
		const d = this.dom;
		if (!d || !d.segs || !d.segs.length) return;

		const vpW = d.vp.clientWidth || d.bar.clientWidth || 0;
		const gapPx = this.config.clearBeforeNext
			? Math.max(this.config.gapBetweenArticles, vpW)
			: this.config.gapBetweenArticles;

		// Lay the articles end-to-end on a virtual track and record where each one
		// starts. They are positioned individually (not in one wide row), so each
		// stays its own small compositor layer.
		let offset = 0;
		for (const s of d.segs) {
			s.width = s.el.offsetWidth;
			s.offset = offset;
			offset += s.width + gapPx;
		}
		d.vpW = vpW;
		d.gapPx = gapPx;
		d.total = offset;        // full virtual track length, including the trailing gap

		// Progress bar geometry: the module width split into one step per article.
		if (d.progress && d.progressBlock) {
			const totalW = d.progress.clientWidth || d.vpW || 0;
			d.progStep = totalW / d.segs.length;
			const blockW = (Number(this.config.progressBarWidth) > 0) ? Number(this.config.progressBarWidth) : d.progStep;
			d.progressBlock.style.width = `${blockW}px`;
		}

		this.stopEngine();
		this.state = { i: 0 };
		d.anims = [];

		const vel = this.velocityPps();
		if (vel <= 0) {
			// Frozen: first article at the left edge, the rest parked off to the right.
			for (const s of d.segs) {
				s.el.style.transform = `translate3d(${s.offset === 0 ? 0 : vpW + s.offset}px, 0, 0)`;
			}
			this.updateProgress();
			return;
		}

		// Animate each article as its OWN small layer sliding across the viewport,
		// rather than one giant multi-thousand-pixel row. A full row exceeds the
		// Raspberry Pi's max texture size, so it can't be composited and falls back
		// to CPU rasterization - the cause of the once-a-second stutter. One article
		// per layer keeps each within GPU limits, so the motion runs on the
		// compositor thread and stays smooth. Each article starts just off the right
		// edge (later ones further right), travels the whole track length left over
		// one period, then the infinite iteration snaps it back - seamless because
		// the layout repeats every `d.total` pixels.
		d.durationMs = (d.total / vel) * 1000;
		for (const s of d.segs) {
			const startX = vpW + s.offset;
			const endX = startX - d.total;
			s.el.style.transform = `translate3d(${startX}px, 0, 0)`;
			s.anim = s.el.animate(
				[
					{ transform: `translate3d(${startX}px, 0, 0)` },
					{ transform: `translate3d(${endX}px, 0, 0)` }
				],
				{ duration: d.durationMs, iterations: Infinity, easing: "linear" }
			);
			d.anims.push(s.anim);
		}
		d.refAnim = d.segs[0].anim;

		// The progress block only steps between articles, so a light rAF that reads
		// the animation clock and moves it on a change is enough; its own smoothness
		// doesn't matter. Skip it entirely when there is no bar.
		this.updateProgress();
		if (d.progress && d.progressBlock) {
			this._raf = requestAnimationFrame(() => this.trackProgress());
		}
	},

	// Follow the compositor animation's clock and step the progress block to the
	// article currently leading at the left edge.
	trackProgress () {
		const d = this.dom;
		const st = this.state;
		if (!d || !st || !d.refAnim || !d.segs.length) { this._raf = null; return; }

		const timing = d.refAnim.effect.getComputedTiming();
		const p = timing.progress; // 0..1 within the current iteration (null if not running)
		if (p !== null && p !== undefined) {
			const scrollX = p * d.total - d.vpW;
			let i = 0;
			while (i + 1 < d.segs.length && scrollX >= d.segs[i + 1].offset) i += 1;
			if (i !== st.i) {
				st.i = i;
				this.updateProgress();
			}
		}
		this._raf = requestAnimationFrame(() => this.trackProgress());
	},

	// Cancel every per-article animation, the mode-2 cycle, and the progress tracker.
	stopEngine () {
		if (this._raf) {
			cancelAnimationFrame(this._raf);
			this._raf = null;
		}
		this.stopMode2();
		const d = this.dom;
		if (d && d.anims) {
			for (const a of d.anims) {
				try { a.cancel(); } catch (error) { /* already gone */ }
			}
			d.anims = [];
			d.refAnim = null;
		}
	},

	// speed is pixels per second - constant regardless of bar width.
	velocityPps () {
		return Math.max(0, Number(this.config.speed) || 0);
	},

	// Move the progress block to the current article's step.
	updateProgress () {
		const d = this.dom;
		if (!d || !d.progressBlock || !this.state) return;
		const left = (this.state.i || 0) * (d.progStep || 0);
		d.progressBlock.style.transform = `translate3d(${left}px, 0, 0)`;
	},

	ageString (ts) {
		if (ts === null || ts === undefined) return "?";
		const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
		if (mins < 60) return `${mins} min`;
		const hrs = Math.round(mins / 60);
		if (hrs < 48) return `${hrs} ${hrs === 1 ? "hour" : "hours"}`;
		const days = Math.round(hrs / 24);
		return `${days} ${days === 1 ? "day" : "days"}`;
	},

	cssSize (v) {
		return (typeof v === "number") ? `${v}px` : String(v);
	},

	suspend () {
		if (this._raf) {
			cancelAnimationFrame(this._raf);
			this._raf = null;
		}
		this.stopMode2();
		const d = this.dom;
		if (d && d.anims) {
			for (const a of d.anims) {
				try { a.pause(); } catch (error) { /* ignore */ }
			}
		}
	},

	resume () {
		const d = this.dom;
		if (!d) return;
		if (d.mode === 2) {
			if (d.stage && this.currentList && this.currentList.length) {
				this.m2Show((this.state && this.state.i) || 0);
			}
			return;
		}
		if (d.anims && d.anims.length) {
			for (const a of d.anims) {
				try { a.play(); } catch (error) { /* ignore */ }
			}
			if (!this._raf && d.progress && d.progressBlock) {
				this._raf = requestAnimationFrame(() => this.trackProgress());
			}
		} else if (d.segs && d.segs.length) {
			this.initEngine();
		}
	}
});
