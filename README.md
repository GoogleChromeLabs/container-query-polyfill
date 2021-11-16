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

The polyfill should work in all modern browsers. Chrome 88+, Firefox 78+ and Safari 14+.

## Limitations

To keep the polyfill performant, small and maintainable, I have make certain tradeoffs with full feature parity of the Container Query spec. I have listed these tradeoffs below.

(These decisions _can_ be revisited if they pose a significant hurdle and there is a good way to implement them. Please open an issue!)

- Container Queries will not work when nested inside a Media Query. For now, the polyfill only supports top-level CQs.
- Container query thresholds can only be specified using pixels.
- Due to the nature of CORS, the polyfill only attempts to handle same-origin and inline stylesheets. Cross-origin stylesheets are ignored, regardless of CORS headers.
- Don’t do weird interspersed comments, okay? Like `@container /* here’s a comment! */ (min-width: 1px) { ... }`. Just don’t.

---

License Apache-2.0

[mdn]: https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Container_Queries
[resizeobserver]: https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver
[mutationobserver]: https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver
