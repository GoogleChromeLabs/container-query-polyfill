interface ResizeObserver {
  disconnect(): void;
  observe(target: Element, options?: ResizeObserverOptions): void;
  unobserve(target: Element): void;
}

declare var ResizeObserver: {
  prototype: ResizeObserver;
  new (callback: ResizeObserverCallback): ResizeObserver;
};

interface ResizeObserverEntry {
  readonly borderBoxSize: ReadonlyArray<ResizeObserverSize>;
  readonly contentBoxSize: ReadonlyArray<ResizeObserverSize>;
  readonly contentRect: DOMRectReadOnly;
  readonly target: Element;
}

declare var ResizeObserverEntry: {
  prototype: ResizeObserverEntry;
  new (): ResizeObserverEntry;
};

interface ResizeObserverSize {
  readonly blockSize: number;
  readonly inlineSize: number;
}

declare var ResizeObserverSize: {
  prototype: ResizeObserverSize;
  new (): ResizeObserverSize;
};

interface ResizeObserverCallback {
  (entries: ResizeObserverEntry[], observer: ResizeObserver): void;
}
