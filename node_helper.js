/* MMM-KitchenNews - node_helper.js
 *
 * Fetches and parses RSS/Atom feeds server-side (the browser cannot, because of
 * CORS) and hands clean article objects to the front-end.
 *
 * Reuses the exact parsing stack the stock `newsfeed` module uses on this
 * install - feedme + iconv-lite + html-to-text - so there is nothing to
 * `npm install`. Fetching goes through the global `fetch`, which on the mirror
 * uses the undici dispatcher pinned in MagicMirror's package.json (redirects
 * followed), see the project CLAUDE.md.
 */

const stream = require("node:stream");
const FeedMe = require("feedme");
const iconv = require("iconv-lite");
const NodeHelper = require("node_helper");
const Log = require("logger");

// html-to-text is present on this install (the default newsfeed uses it), but
// fall back to a crude strip if a future install is missing it.
let htmlToText = null;
try {
	htmlToText = require("html-to-text").htmlToText;
} catch (error) {
	htmlToText = null;
}

module.exports = NodeHelper.create({

	start () {
		this.timers = {};
		this.userAgent = "Mozilla/5.0 (compatible; MMM-KitchenNews/1.0; +https://magicmirror.builders)";
		this.fetchInterval = 10 * 60 * 1000;
		Log.info("[MMM-KitchenNews] node_helper started");
	},

	socketNotificationReceived (notification, payload) {
		if (notification === "KN_SET_FEEDS") {
			this.userAgent = payload.userAgent || this.userAgent;
			this.fetchInterval = Math.max(60 * 1000, payload.fetchInterval || this.fetchInterval);

			// Clear any previous timers (config reload / module restart).
			for (const id of Object.keys(this.timers)) clearInterval(this.timers[id]);
			this.timers = {};

			for (const source of payload.sources || []) {
				this.setupSource(source);
			}
		}
	},

	setupSource (source) {
		const run = () => this.fetchSource(source);
		run();
		this.timers[source.id] = setInterval(run, this.fetchInterval);
	},

	async fetchSource (source) {
		try {
			const res = await fetch(source.url, {
				redirect: "follow",
				headers: {
					"User-Agent": this.userAgent,
					"Cache-Control": "no-cache",
					Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, application/json, */*"
				}
			});

			if (!res.ok) {
				Log.warn(`[MMM-KitchenNews] ${source.id}: HTTP ${res.status}`);
				this.sendSocketNotification("KN_ERROR", { id: source.id, status: res.status });
				return;
			}

			const items = await this.parse(res, source.encoding || "UTF-8");
			Log.info(`[MMM-KitchenNews] ${source.id}: ${items.length} items`);
			this.sendSocketNotification("KN_ITEMS", { id: source.id, items });
		} catch (error) {
			Log.error(`[MMM-KitchenNews] ${source.id}: fetch failed - ${error.message}`);
			this.sendSocketNotification("KN_ERROR", { id: source.id, error: error.message });
		}
	},

	parse (res, encoding) {
		return new Promise((resolve, reject) => {
			const items = [];
			let settled = false;
			const parser = new FeedMe();

			parser.on("item", (item) => {
				const title = this.clean(item.title);
				const summary = this.clean(
					item.description || item.summary || item.content || item["content:encoded"] || ""
				);
				const pubdate = item.pubdate || item.published || item.updated
					|| item["dc:date"] || item["a10:updated"] || null;
				const url = item.url || item.link || "";
				const categories = this.categoryList(item.category);

				if (title) items.push({ title, summary, pubdate, url, categories });
			});

			parser.on("end", () => {
				if (settled) return;
				settled = true;
				resolve(items);
			});

			const nodeStream = res.body instanceof stream.Readable
				? res.body
				: stream.Readable.fromWeb(res.body);

			stream.promises
				.pipeline(nodeStream, iconv.decodeStream(encoding), parser)
				.catch((error) => {
					if (settled) return;
					settled = true;
					reject(error);
				});
		});
	},

	// Normalise a feed item's <category> into a clean array of category strings.
	// feedme hands us a string, an array, or objects ({ text }, atom's { term }, ...).
	categoryList (raw) {
		if (raw == null) return [];
		const arr = Array.isArray(raw) ? raw : [raw];
		const out = [];
		for (const c of arr) {
			let name = "";
			if (typeof c === "string") name = c;
			else if (c && typeof c === "object") name = c.text || c["#"] || c.term || c.label || "";
			name = String(name).replace(/\s+/g, " ").trim();
			if (name) out.push(name);
		}
		return out;
	},

	// Turn feed HTML into a single clean line of plain text.
	clean (value) {
		if (!value) return "";
		const text = String(value);
		if (htmlToText) {
			try {
				return htmlToText(text, {
					wordwrap: false,
					selectors: [
						{ selector: "a", options: { ignoreHref: true, noAnchorUrl: true } },
						{ selector: "img", format: "skip" }
					]
				}).replace(/\s+/g, " ").trim();
			} catch (error) {
				// fall through to the crude strip
			}
		}
		return text.replace(/<[^>]*>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
	}
});
