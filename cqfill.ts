interface ContainerQueryDescriptor {
  name: string;
  breakPoint: BreakPoint;
  className: string;
}

export enum Measurement {
  MinWidth,
  MaxWidth,
  MinHeight,
  MaxHeight,
}

interface BreakPoint {
  measurement: Measurement;
  threshold: number;
}

type Comparator = (v: ResizeObserverSize, threshold: number) => boolean;
// TODO: Fix for logical props
const comparators: Map<Measurement, Comparator> = new Map([
  [Measurement.MaxHeight, (v, t) => v.blockSize <= t],
  [Measurement.MinHeight, (v, t) => v.blockSize >= t],
  [Measurement.MaxWidth, (v, t) => v.inlineSize <= t],
  [Measurement.MinWidth, (v, t) => v.inlineSize >= t],
]);

function isQueryFullfilled(
  breakpoint: BreakPoint,
  entry: ResizeObserverEntry
): boolean {
  // At the time of writing, the array will always be length one.
  const borderBox = entry.borderBoxSize[0];
  return comparators.get(breakpoint.measurement)!(
    borderBox,
    breakpoint.threshold
  );
}

const queries: WeakMap<Element, ContainerQueryDescriptor[]> = new Map();
const globalObserver = new ResizeObserver((entries) => {
  for (const entry of entries) {
    const queryList = queries.get(entry.target);
    if (!queryList) continue;
    for (const query of queryList) {
      entry.target.classList.toggle(
        query.className,
        isQueryFullfilled(query.breakPoint, entry)
      );
    }
  }
});

function uid(): string {
  return Array.from({ length: 16 }, () =>
    Math.floor(Math.random() * 256).toString(16)
  ).join("");
}

export function containerQuery(
  el: Element,
  breakPoint: BreakPoint,
  className: string,
  name: string = uid()
) {
  if (!queries.has(el)) {
    queries.set(el, []);
  }
  queries.get(el)!.push({
    className,
    name,
    breakPoint,
  });
  globalObserver.observe(el);
}
