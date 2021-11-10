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

const cqMatcher = /@container/g;
export function parseStyleSheet(sheetSrc: string): string {
  while (true) {
    const match = cqMatcher.exec(sheetSrc);
    if (!match) break;
    const { query, substyles, startIndex, endIndex } = parseContainerQuery({
      sheetSrc,
      index: match.index,
    });
    sheetSrc =
      sheetSrc.slice(0, startIndex) +
      "/* INSERT CQ */" +
      sheetSrc.slice(endIndex);
  }
  return sheetSrc;
}

interface AdhocParser {
  sheetSrc: string;
  index: number;
}

function assertString(p: AdhocParser, s: string) {
  if (p.sheetSrc.substr(p.index, s.length) != s) {
    throw Error(`Did not find expected sequence ${s}`);
  }
  p.index += s.length;
}

const whitespaceMatcher = /\s*/g;
function eatWhitespace(p: AdhocParser) {
  // Start matching at the current position in the sheet src
  whitespaceMatcher.lastIndex = p.index;
  const match = whitespaceMatcher.exec(p.sheetSrc);
  if (match) {
    p.index += match[0].length;
  }
}

function peek(p: AdhocParser): string {
  return p.sheetSrc[p.index];
}

const identMatcher = /[a-zA-Z_-]+/g;
function parseIdentifier(p: AdhocParser): string {
  identMatcher.lastIndex = p.index;
  const match = identMatcher.exec(p.sheetSrc);
  if (!match) {
    throw Error("Expected an identifier");
  }
  p.index += match[0].length;
  return match[0];
}

// `min-width` => `MinWidth`
function undashify(s: string): string {
  const v = s
    .replace(/-(\w)/, (_, l) => l.toUpperCase())
    .replace(/^\w/, (v) => v.toUpperCase());
  return v;
}

function parseMeasurementName(p: AdhocParser): Measurement {
  const measurementName = undashify(parseIdentifier(p).toLowerCase());
  if (!(measurementName in Measurement)) {
    throw Error(`Unknown query ${measurementName}`);
  }
  // FIXME: lol
  return Measurement[measurementName as any] as any;
}

const numberMatcher = /[0-9.]*/g;
function parseThreshold(p: AdhocParser): number {
  numberMatcher.lastIndex = p.index;
  const match = numberMatcher.exec(p.sheetSrc);
  if (!match) {
    throw Error("Expected a number");
  }
  p.index += match[0].length;
  // TODO: Support other units?
  assertString(p, "px");
  const value = parseFloat(match[0]);
  if (Number.isNaN(value)) {
    throw Error(`${match[0]} is not a valid number`);
  }
  return value;
}

function skipBlock(p: AdhocParser): string {
  assertString(p, "{");
  const start = p.index;
  let level = 1;
  while (level != 0) {
    p.index++;
    if (p.sheetSrc[p.index] === "{") {
      level++;
    } else if (p.sheetSrc[p.index] === "}") {
      level--;
    }
  }
  const end = p.index - 1;
  const block = p.sheetSrc.slice(start, end);
  return block;
}

interface ParseResult {
  query: ContainerQueryDescriptor;
  substyles: string;
  startIndex: number;
  endIndex: number;
}

function parseContainerQuery(p: AdhocParser): ParseResult {
  const startIndex = p.index;
  assertString(p, "@container");
  eatWhitespace(p);
  let name: string;
  if (peek(p) !== "(") {
    name = parseIdentifier(p);
  } else {
    name = uid();
  }
  eatWhitespace(p);
  assertString(p, "(");
  eatWhitespace(p);
  const measurement = parseMeasurementName(p);
  eatWhitespace(p);
  assertString(p, ":");
  eatWhitespace(p);
  const threshold = parseThreshold(p);
  eatWhitespace(p);
  assertString(p, ")");
  eatWhitespace(p);
  const substyles = skipBlock(p);
  const endIndex = p.index;
  eatWhitespace(p);
  const className = uid();
  return {
    query: {
      breakPoint: {
        measurement,
        threshold,
      },
      className,
      name,
    },
    substyles,
    startIndex,
    endIndex,
  };
}
