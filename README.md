# Container Query Polyfill

A tiny polyfill for [CSS Container Queries][mdn], weighing about 1.6kB brotli’d. It transpiles CSS code on the client-side and implements Container Query functionality using [ResizeObserver] and [MutationObserver].

## Usage

Ideally, the polyfill is only loaded if the browser doesn’t support Container Queries natively. In a modern setup with a bundler that uses ES modules, the following snippet should work:

```js
const supportsContainerQueries = "container" in document.documentElement.style;
if (!supportsContainerQueries) {
  import("container-query-polyfill");
}
```

If you are in a legacy setup (or just want to prototype quickly), there’s also an IIFE version that you can include using a `<script>` tag:

```html
<script src="https://unpkg.com/container-query-polyfill/cqfill.iife.min.js"></script>
```

## Browser support

The polyfill relies on [ResizeObserver], [MutationObserver] and [`:is()`][is selector]. Therefore, it should work in all modern browsers, specifically Chrome/Edge 88+, Firefox 78+ and Safari 14+.

## Limitations

My aim is to make the polyfill work correctly for the _majority_ of use-cases, but cut corners where possible to keep the polyfill simple(-ish), small and efficient. The limitations arising from these tradeoffs are listed below.

(These decisions _can_ be revisited if they pose a significant hurdle and there is a good way to implement them. Please open an issue!)

- Only a subset of queries are supported for now. Specifically, only `min-width`, `max-width`, `min-height` and `max-height` are supported. Additionally, the polyfill _does_ support `and`, `or` or `not`.
- Container Queries will not work when nested inside a Media Query. For now, the polyfill only supports top-level CQs.
- Container query thresholds can only be specified using pixels.
- Due to the nature of CORS, the polyfill only attempts to handle same-origin and inline stylesheets. Cross-origin stylesheets are ignored, regardless of CORS headers.
- Don’t do weird interspersed comments, okay? Like `@container /* here’s a comment! */ (min-width: 1px) { ... }`. Just don’t.
- CQs inside ShadowDOM are not supported yet.

## Building & Testing

This project uses [esbuild] to bundle the project, which is automatically installed via npm. To build the polyfill, run:

```
npm run build
```

To run the tests, run

```
npm run serve
```

and open your browser at `http://127.0.0.1:8081/tests`.

---

License Apache-2.0

[mdn]: https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Container_Queries
[resizeobserver]: https://caniuse.com/resizeobserver
[mutationobserver]: https://caniuse.com/mutationobserver
[esbuild]: https://esbuild.github.io/
[is selector]: https://caniuse.com/css-matches-pseudo
