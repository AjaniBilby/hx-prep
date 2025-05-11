var hx_prep = function(){

type SwapSpec = { swapStyle: string };

const htmx = (window as any).htmx as {
	ajax: (verb: string, path: string, context: {
		source?: Element
		headers: Record<string, string>
		values:  FormData,
	}) => Promise<void>,
}

let binding: {
	swap: (target: Element | string, content: string, swapSpec: SwapSpec) => void,
	getSwapSpecification: (target: Element | string) => SwapSpec,
	getAttributeValue: (node: Element, attribute: string) => string | null,
};

const register = new Map<string, string>();
const inflight = new Set<string>();

let state = 0;

(globalThis as any).htmx.defineExtension("hx-prep", {
	init: (config: typeof binding) => { binding = config; },
	onEvent: (name: string, event: CustomEvent) => {
		switch (name) {
			case "htmx:beforeProcessNode": { // preload skeletons
				const prep = ResolveSkeleton(event.detail.elt);
				if (prep) PreloadSkeleton(prep);
				return;
			}
			case "htmx:beforeRequest": {
				const source = event.detail.elt as Element;

				const prep = ResolveSkeleton(source);
				if (!prep) return;

				const html = GetSkeleton(prep);
				if (html === null) return; // confirmed no skeleton

				const spec = binding.getSwapSpecification(source);
				let target = event.detail.target as Element;
				let swap   = spec.swapStyle;

				const id = `hx-prep-${++state}`;
				const prepared = document.createElement("div");
				prepared.id = id;
				prepared.className = "hx-prep";
				prepared.setAttribute("hx-target", "this");
				prepared.setAttribute("hx-swap",   "outerHTML");

				if (event.detail.boosted) {
					prepared.setAttribute("hx-push-url", "true");
					prepared.setAttribute("boosted",     "true");

					target = document.body;
					swap   = "innerHTML";
					console.log(spec);
				}

				{ // insert the skeleton
					const rules = binding.getAttributeValue(source, "hx-prep-rule");
					const skeleton = document.createElement("div");
					skeleton.innerHTML = html;
					skeleton.className = "hx-prep-skeleton";
					skeleton.setAttribute("hx-history", "false");
					ApplySkeletonRules(skeleton, rules);
					prepared.appendChild(skeleton);
				}

				// Insert the original data for restoration if needed
				if (swap === "innerHTML" || swap === "outerHTML") {
					const restore = document.createElement("div");
					restore.innerHTML = swap === "outerHTML" ? target.outerHTML : target.innerHTML;
					restore.className = "hx-prep-origin";
					prepared.appendChild(restore);
				}

				const verb = event.detail.requestConfig.verb;
				const path = event.detail.requestConfig.path;
				const headers = event.detail.requestConfig.headers;
				headers["HX-Prep"] = prep;
				headers["HX-Prep-Status"] = "prepared";
				const values = event.detail.requestConfig.formData;

				// Swap in the skeleton with the original data hidden in it
				binding.swap(target, prepared.outerHTML, spec);

				const reTarget = document.getElementById(id);
				if (!reTarget) return console.error("hx-prep: failed to insert skeleton");
				htmx.ajax(verb, path, { source: reTarget, headers, values }).then(() => Cleanup(reTarget));

				event.preventDefault();

				return;
			}
		}
	}
});


function Cleanup(elt: Element) {
	if (!elt.isConnected) return; // successfully replaced by response

	if (elt === document.body) return; // no-need to restore on a boost

	// perform rollback
	const origin = elt.querySelector(".hx-prep-origin");
	if (!origin) return console.error("hx-prep: failed to rollback oob, missing original html");

	elt.outerHTML = origin.innerHTML;
}



function ResolveSkeleton(elt: Element) {
	const prep = binding.getAttributeValue(elt, "hx-prep");
	if (!prep) return null;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const url = new URL(prep, window.location as any as URL);
	return url.pathname + url.search;
}

function GetSkeleton (url: string) {
	const cache = register.get(url);
	if (cache !== undefined) return cache;
	return PreloadSkeleton(url);

}
function ApplySkeletonRules(element: Element, rules: string | null) {
	if (!rules) return;

	try {
		console.info(`hx-prep: applying skeleton to`, element);

		const lines = rules.split(";");

		for (const line of lines) {
			const rule = ParseRule(line);
			if (!rule) continue;

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			let target = element.querySelector(`[hx-prep-slot="${rule.slot}"],[data-hx-prep-slot="${rule.slot}"]`) as any;

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


function PreloadSkeleton (url: string) {
	LoadSkeleton(url).catch(console.error);
	return null;
}
async function LoadSkeleton (url: string) {
	if (inflight.has(url)) return; // loading already started

	console.info(`hx-prep: preloading skeleton ${url}`);
	inflight.add(url);

	try {
		const req = await fetch(url);
		if (!req.ok) throw new Error(await req.text());
		const html = await req.text();

		register.set(url, html);
		console.info(`hx-prep: loaded skeleton ${url}`);
	} catch (e) {
		console.error(url, e);
		return;
	}
}


}()