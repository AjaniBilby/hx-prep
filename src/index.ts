var hx_prep = function(){

type SwapSpec = { swapStyle: string };

let htmx: {
	swap: (target: Element | string, content: string, swapSpec: SwapSpec) => void,
	getSwapSpecification: (target: Element | string) => SwapSpec,
	getAttributeValue: (node: Element, attribute: string) => string | null,
};

type Inflight = {
	target: Element,      // the element original targeted
	html: string,         // the original innerHTML
	rules: string | null, // the rules to apply to the skeleton if JIT
	swap?: SwapSpec       // the swap to use to apply the skeleton (undefined if applied)
	htmxData?: any
}
const inflight = new Map<XMLHttpRequest, Inflight>();
const register = new Map<string, { html: string | null, pending?: XMLHttpRequest[] }>();

(globalThis as any).htmx.defineExtension("hx-prep", {
	init: (config: typeof htmx) => { htmx = config; },
	onEvent: (name: string, event: CustomEvent) => {
		switch (name) {
			case "htmx:beforeProcessNode": { // preload skeletons
				const prep = ResolveSkeleton(event.detail.elt);
				if (!prep) return;

				PreloadSkeleton(prep);
				return;
			}
			case "htmx:configRequest": {
				if (event.detail.verb !== "get") return;

				const prep = ResolveSkeleton(event.detail.elt);
				if (!prep) return;

				event.detail.headers["HX-Prep"] = prep;

				// Will the skeleton be injected before this request goes out?
				const loaded = register.has(prep);
				if (loaded) event.detail.headers["HX-Prep-Status"] = "prepared";
				else {
					event.detail.headers["HX-Prep-Status"] = "preparing";
					PreloadSkeleton(prep);
				}

				return;
			}
			case "htmx:beforeRequest": {
				const prep = event.detail.requestConfig.headers["HX-Prep"];
				if (!prep) return;

				const xhr = event.detail.xhr as XMLHttpRequest;
				const skeleton = GetSkeleton(xhr, prep);
				if (skeleton === null) return; // confirmed no skeleton

				const swap = htmx.getSwapSpecification(event.detail.elt as Element);
				if (swap.swapStyle !== "innerHTML" && swap.swapStyle !== "outerHTML") return;

				// Cache information for rollback/delayed skeleton application
				const target: Element = event.detail.target;
				const rules = htmx.getAttributeValue(event.detail.elt, "hx-prep-rules");
				const htmxData = { ...event.detail.elt['htmx-internal-data'] }; // shallow copy to prevent the htmx unmount changes
				const entry: Inflight = { target, html: target.outerHTML, rules, swap, htmxData };
				inflight.set(xhr, entry);

				// TODO: Bug: When applied prevents URL from changing on boost
				if (skeleton !== undefined) ApplySkeleton(entry, skeleton);

				return;
			}
			case "htmx:beforeHistorySave": {
				for (const [,prev] of inflight) RollbackSkeleton(prev);
				return;
			}
			case "htmx:beforeSwap": {
				const xhr = event.detail.xhr as XMLHttpRequest;

				// restore original
				const prev = inflight.get(event.detail.xhr);
				if (!prev) return;
				event.detail.elt['htmx-internal-data'] = prev.htmxData;
				inflight.delete(xhr);

				event.detail.target = RollbackSkeleton(prev) || event.detail.target;

				return;
			}
		}
	}
});


function RollbackSkeleton(prev: Inflight) {
	if (prev.swap) return null; // it was never applied in the first place

	console.info(`hx-prep: restore`, prev.target);
	htmx.swap(prev.target, prev.html, { swapStyle: "outerHTML" });
	return prev.target;
}



function ResolveSkeleton(elt: Element) {
	const prep = htmx.getAttributeValue(elt, "hx-prep");
	if (!prep) return null;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const url = new URL(prep, window.location as any as URL);
	return url.pathname + url.search;
}

function GetSkeleton (ctx: XMLHttpRequest, url: string) {
	const cache = register.get(url);
	if (cache) {
		if (cache.html !== null) return cache.html;
		if (!cache.pending) return null;

		cache.pending.push(ctx);
		return undefined;
	}

	// loading missing, and queue insertion
	register.set(url, { html: null, pending: [ ctx ]});
	LoadSkeleton(url).catch(console.error);
	return undefined;
}
function ApplySkeleton(entry: Inflight, skeleton: string) {
	if (!entry.swap) return; // already applied

	try {
		console.info(`hx-prep: applying skeleton to`, entry);

		// htmx swap
		if (entry.swap.swapStyle === "innerHTML") htmx.swap(entry.target, skeleton, { swapStyle: "innerHTML" });
		else htmx.swap(entry.target, skeleton, { swapStyle: "outerHTML" });

		entry.target.classList.add("hx-prep");
		entry.swap = undefined; // mark applied

		if (!entry.rules) return;
		const lines = entry.rules.split(";");

		for (const line of lines) {
			const rule = ParseRule(line);
			if (!rule) continue;

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			let target = entry.target.querySelector(`[hx-prep-slot="${rule.slot}"],[data-hx-prep-slot="${rule.slot}"]`) as any;

			while (rule.prop.length > 1) {
				if (!target) break;

				const key = rule.prop.pop()!;
				target = target[key as keyof typeof target];
			}

			if (!target) continue;

			const key = rule.prop.pop();
			if (!key) continue;

			target[key] = rule.value;
		}
	} catch (e) { console.error(e) /* don't allow an error to crash htmx */ }
}

function ParseRule(rule: string) {
	const i = rule.indexOf("=");
	if (i === -1) return null;

	const target = rule.slice(0, i).trim().split(".");
	const value  = JSON.parse(rule.slice(i+1).trim());

	return { slot: target[0], prop: target.slice(1).reverse(), value };
}


function PreloadSkeleton (url: string) { LoadSkeleton(url).catch(console.error); }
async function LoadSkeleton (url: string) {
	if (register.has(url)) return;
	register.set(url, { html: null, pending: [] });

	console.info(`hx-prep: preloading skeleton ${url}`);

	try {
		const req = await fetch(url);
		if (!req.ok) throw new Error(await req.text());
		const html = await req.text();

		const cache = register.get(url);
		if (!cache) return register.set(url, { html, pending: undefined });

		cache.html = html;

		if (cache.pending && cache.pending.length > 0) {
			console.info(`hx-prep: loaded skeleton ${url}, applying to inflight ${cache.pending.length}`);

			for (const xhr of cache.pending) {
				const pending = inflight.get(xhr);
				if (!pending) continue;

				ApplySkeleton(pending, html);
			}
		} else {
			console.info(`hx-prep: loaded skeleton ${url}`);
		}



	} catch (e) {
		console.error(url, e);

		const cache = register.get(url);
		if (cache) {
			cache.pending = undefined;
			cache.html = null;
			return;
		}

		register.set(url, { html: null, pending: undefined });
		return;
	}
}


}()