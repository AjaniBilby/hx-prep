Enable loading skeletons in your htmx project as easy as:

```html
<a href="/case/1" hx-prep="/skeleton" hx-prep-rule='id.innerText = "1"'>Case 1</a>
```

![banner](/images/banner.gif)

---

## Getting Started

Import the library in your client side.

### CDN

```html
<script src="https://unpkg.com/hx-prep@1.0.0"></script>
```

### Bundle

To bundle in an npm-style build system with ES modules, you will have to add `htmx` to the `document` like so:

```
npm i hx-drag
```

```javascript
// index.js
import "./htmx";
import "hx-prep";
```

```javascript
// htmx.js
import htmx from "htmx.org";
window.htmx = htmx; // to support hx-drag
export default htmx;
```

### CSS Styling

You must include these styles in your global style sheet for correct rendering during load failure after skeleton insertion, and ensuring you don't corrupt your htmx history logs.
```css
.hx-prep { cursor: progress; }
.hx-prep, .hx-prep-skeleton, .hx-prep-origin { display: contents }
.hx-prep:has(.hx-prep-skeleton) .hx-prep-origin { display: none; }
/* OR */
@import url("https://unpkg.com/hx-prep@1.0.0/style.css");
```

These classes ensure that the original data is still visible when the skeleton is removed for history storing.

### Enable

```html
<body hx-ext="hx-prep">...</body>
```

---

## HTML Attributes

All html attributes can have the `data-` prefix if required by your framework.

### `hx-prep`

The url for the skeleton that can be used for any requests from this element.

`hx-prep` will currently override all `htmx` request for an element with a defined `hx-prep` attributes.
This includes form submissions and post request among others.

To customize a skeleton on a per-element/page basis, we recommend using [`hx-prep-rule`s](#hx-prep-rule) to customize them on the fly rather than having to load multiple different skeletons a head of time.

### `hx-prep-rule`

Replacement rules that should be applied to the skeleton when inserted to make the skeleton unique to the element triggering it.

The first part of a prep-rule specifies which `hx-prep-slot` is being modified, you can then access static elements off it using the `.` operator to be able to change a nested property such as a style's property. The value for each rule must used `"` quotes, and be parsable by `JSON.parse`.

Each rule must be separated by a `;` and any whitespace detectable by `.trim()` is usable around the `=` and `;` operators.

```html
<a
  href="/slow-page"
  hx-prep="/skeleton"
  hx-prep-rule='title.innerText = "Slow Page!"; title.style.color = "blue"'
>link</a>
```

### `hx-prep-slot`

Instead of using a html id, or query selector to access an element in `hx-prep-rule`, we define our own attribute to allow for extra safety and precision when multiple skeletons may be present on a single page.

Skeleton
```html
<div hx-prep-slot="body"></div>
```

Rule to alter inner text:
```html
<a hx-prep-rule='body.innerText = "hello world!"'>
```

---

## Http Headers

### Request: `HX-Prep`

When a request is sent to the server of which the client will attempt to infill a skeleton, this http header will be present stating the pathname of the skeleton being used.

### Request: `HX-Prep-Status`

This header describes if `hx-prep` has already successfully mounted the skeleton, or is in the process of mounting it while this request is in flight.

---

## Examples

See [https://hx-prep.ajanibilby.com/example](https://hx-prep.ajanibilby.com/example)