var hx_prep = function(){

type SwapSpec = { swapStyle: string };
type Swap = "innerHTML" | "outerHTML";

let api: {
	getSwapSpecification: (target: Element | string) => SwapSpec,
	getAttributeValue: (node: Element, attribute: string) => string | null,
};

const inflight = new Map<XMLHttpRequest, { target: Element, html: string, rules: string | null, swap?: Swap }>();
const register = new Map<string, { html: string | null, pending?: XMLHttpRequest[] }>();

(globalThis as any).htmx.defineExtension("hx-prep", {
	init: (config: typeof api) => { api = config; },
	onEvent: (name: string, event: CustomEvent) => {
		switch (name) {
			case "htmx:beforeProcessNode": { // preload skeletons
				const prep = ResolveSkeleton(event.detail.elt);
				if (!prep) return;

				LoadSkeleton(prep).catch(console.error);

				return;
			}
			case "htmx:configRequest": {
				if (event.detail.verb !== "get") return;

				const prep = ResolveSkeleton(event.detail.elt);
				if (!prep) return;

				const xhr = event.detail.xhr as XMLHttpRequest;
				const skeleton = GetSkeleton(xhr, prep);
				if (skeleton === null) return; // confirmed no skeleton

				const target = event.detail.target as Element;
				const spec = api.getSwapSpecification(target);

				if (spec.swapStyle !== "innerHTML" && spec.swapStyle !== "outerHTML") return;
				const swap = spec.swapStyle;

				// Cache information for rollback/delayed skeleton application
				const rules = api.getAttributeValue(event.detail.elt, "hx-prep-rules");
				inflight.set(xhr, {
					target, html: target.outerHTML, rules,
					swap: skeleton == undefined ? swap : undefined
				});

				event.detail.headers["HX-Prep"] = prep;
				if (skeleton !== undefined) {
					if (swap === "innerHTML") target.innerHTML = skeleton;
					else target.outerHTML = skeleton;

					ApplySkeletonRules(target, rules);
					event.detail.headers["HX-Prep-Status"] = "prepared";
				} else {
					event.detail.headers["HX-Prep-Status"] = "preparing";
				}

				return;
			}
			case "htmx:beforeSwap": {
				const xhr = event.detail.xhr as XMLHttpRequest;

				const prev = inflight.get(event.detail.xhr);
				if (!prev) return;

				inflight.delete(xhr);

				if (!prev.swap && event.detail.target != prev.target) {
					prev.target.outerHTML = prev.html;
					prev.target.classList.add("htmx-settling");
					event.detail.target = prev.target;
				}

				return;
			}
		}
	}
});



function ResolveSkeleton(elt: Element) {
	const prep = api.getAttributeValue(elt, "hx-prep");
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

async function LoadSkeleton (url: string) {
	if (register.has(url)) return;
	register.set(url, { html: null, pending: [] });

	try {
		const req = await fetch(url);
		if (!req.ok) throw new Error(await req.text());
		const html = await req.text();

		const cache = register.get(url);
		if (!cache) return register.set(url, { html, pending: undefined });

		cache.html = html;

		if (cache.pending) for (const xhr of cache.pending) {
			const pending = inflight.get(xhr);
			if (!pending || !pending.swap) continue;

			const swap = pending.swap;
			pending.swap = undefined;

			if (swap === "innerHTML") pending.target.innerHTML = html;
			else pending.target.outerHTML = html;

			ApplySkeletonRules(pending.target, pending.rules);
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

function ApplySkeletonRules(elt: Element, rules: string | null) {
	elt.classList.add("hx-prep");

	try {
		if (!rules) return;
		const lines = rules.split(";");

		for (const line of lines) {
			const rule = ParseRule(line);
			if (!rule) continue;

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			let target = elt.querySelector(`[hx-prep-slot="${rule.slot}"],[data-hx-prep-slot="${rule.slot}"]`) as any;

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

}()