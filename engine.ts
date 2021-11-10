interface ContainerQueryDescriptor {
  name?: string;
  breakPoint: BreakPoint;
  className: string;
  rules: Rule[];
}

function uid(): string {
  return Array.from({ length: 16 }, () =>
    Math.floor(Math.random() * 256).toString(16)
  ).join("");
}

enum Measurement {
  MinWidth,
  MaxWidth,
  MinHeight,
  MaxHeight,
}

// TODO: Fix for logical props
type Comparator = (v: ResizeObserverSize, threshold: number) => boolean;
const comparators: Map<Measurement, Comparator> = new Map([
  [Measurement.MaxHeight, (v, t) => v.blockSize <= t],
  [Measurement.MinHeight, (v, t) => v.blockSize >= t],
  [Measurement.MaxWidth, (v, t) => v.inlineSize <= t],
  [Measurement.MinWidth, (v, t) => v.inlineSize >= t],
]);

interface BreakPoint {
  measurement: Measurement;
  threshold: number;
}

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

// function findClosestContainer(el: Element, name?: string): Element | undefined {
//   // Start at parent, and walk the tree upwards.
//   while(el) {
//     el = el.parentElement;
//     // If ascendant is not a container, keep walking
//     if(!containers.has(el)) continue;
//     // Ascendant is a container!
//     // If no name was given, return the first container we can find.
//     if(!name) return el;
//     // Otherwise, check it’s the container with the right name.
//     const containerNames = containers.get(el)!
//     if(containerNames.includes(name)) return el;
//   }
//   // If we reach the root, no container was found.
//   return undefined;
// }

function isAncestor(potentialAncestor: Element, descendant: Element): boolean {
  while (descendant) {
    // We explicitly start at the parent of `descendant`.
    descendant = descendant.parentElement;
    if (descendant === potentialAncestor) return true;
  }
  return false;
}

const containers: WeakMap<Element, string[]> = new WeakMap();
function registerContainer(el: Element, name: string) {
  containerRO.observe(el);
  if (!containers.has(el)) {
    containers.set(el, []);
  }
  containers.get(el)!.push(name);
}
const queries: Array<ContainerQueryDescriptor> = [];
function registerContainerQuery(cqd: ContainerQueryDescriptor) {
  queries.push(cqd);
}
const containerRO = new ResizeObserver((entries) => {
  for (const entry of entries) {
    const container = entry.target;
    for (const query of queries) {
      for (const { selector } of query.rules) {
        const els = document.querySelectorAll(selector);
        for (const el of els) {
          if (!isAncestor(container, el)) continue;
          // *If* the container query had a name, check that we have the container
          // with that name.
          if (query.name) {
            const containerNames = containers.get(container)!;
            if (!containerNames.includes(query.name)) continue;
          }
          container.classList.toggle(
            query.className,
            isQueryFullfilled(query.breakPoint, entry)
          );
        }
      }
    }
  }
});

// function registerContainerQuery(
//   cq: ContainerQueryDescriptor,
//   rules: Rule[],
//   {name = ""} = {}
// ) {
//   if (!queries.has(el)) {
//     queries.set(el, []);
//   }
//   queries.get(el)!.push({
//     className,
//     name,
//     breakPoint,
//   });
//   containerRO.observe(el);
// }

interface WatchedSelector {
  selector: string;
  name: string;
}
const watchedContainerSelectors: WatchedSelector[] = [];
const containerMO = new MutationObserver((entries) => {
  for (const entry of entries) {
    for (const node of entry.removedNodes) {
      if (!(node instanceof HTMLElement)) continue;
      containerRO.unobserve(node);
    }

    for (const node of entry.addedNodes) {
      if (!(node instanceof HTMLElement)) continue;
      for (const watchedContainerSelector of watchedContainerSelectors) {
        if (node.matches(watchedContainerSelector.selector)) {
          registerContainer(node, watchedContainerSelector.name);
        }
      }
    }
  }
});
containerMO.observe(document.documentElement, {
  childList: true,
  subtree: true,
});

interface AdhocParser {
  sheetSrc: string;
  index: number;
}

export function transpileStyleSheet(sheetSrc: string): string {
  const p: AdhocParser = {
    sheetSrc,
    index: 0,
  };

  while (true) {
    eatWhitespace(p);
    if (p.index >= p.sheetSrc.length) break;
    const nextIdent = peekIdentifier(p);
    if (nextIdent.startsWith("/*")) {
      eatComment(p);
    } else if (nextIdent === "@container") {
      const { query, startIndex, endIndex } = parseContainerQuery(p);
      const replacement = stringifyContainerQuery(query);
      replacePart(startIndex, endIndex, replacement, p);
      registerContainerQuery(query);
    } else {
      const rule = parseRule(p);
      if (rule.block.contents.includes("container-")) {
        const name =
          /container-name: ([^;]+);/.exec(rule.block.contents)?.[1] ?? uid();
        const newBlock = rule.block.contents.replace(
          "container-type",
          "containment"
        );
        replacePart(rule.block.startIndex, rule.block.endIndex, newBlock, p);
        watchedContainerSelectors.push({
          name,
          selector: rule.selector,
        });
        for (const el of document.querySelectorAll(rule.selector)) {
          registerContainer(el, name);
        }
      }
    }
  }
  return p.sheetSrc;
}

function replacePart(
  start: number,
  end: number,
  replacement: string,
  p: AdhocParser
) {
  p.sheetSrc = p.sheetSrc.slice(0, start) + replacement + p.sheetSrc.slice(end);
  // If we are pointing past the end of the affected section, we need to recalculate
  // the string pointer. Pointing to something inside the section that’s being replaced
  // is undefined behavior. Sue me.
  if (p.index >= end) {
    const delta = p.index - end;
    p.index = start + replacement.length + delta;
  }
}

function eatComment(p: AdhocParser) {
  assertString(p, "/*");
  eatUntil("*/", p);
}

function eatUntil(s: string, p: AdhocParser): string {
  const startIndex = p.index;
  while (!lookAhead(s, p)) {
    p.index++;
  }
  return p.sheetSrc.slice(startIndex, p.index);
}

function lookAhead(s: string, p: AdhocParser): boolean {
  return p.sheetSrc.substr(p.index, s.length) == s;
}

interface Rule {
  selector: string;
  block: Block;
  startIndex: number;
  endIndex: number;
}

interface Block {
  contents: string;
  startIndex: number;
  endIndex: number;
}

function parseRule(p: AdhocParser): Rule {
  const startIndex = p.index;
  const selector = eatUntil("{", p);
  const block = eatBlock(p);
  const endIndex = p.index;
  return {
    selector,
    block,
    startIndex,
    endIndex,
  };
}

function peekIdentifier(p: AdhocParser) {
  identMatcher.lastIndex = p.index;
  const match = identMatcher.exec(p.sheetSrc);
  if (!match) {
    return "";
  }
  return match[0];
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

const identMatcher = /[\w\@_-]+/g;
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

function eatBlock(p: AdhocParser): Block {
  const startIndex = p.index;
  assertString(p, "{");
  let level = 1;
  while (level != 0) {
    if (p.sheetSrc[p.index] === "{") {
      level++;
    } else if (p.sheetSrc[p.index] === "}") {
      level--;
    }
    p.index++;
  }
  const endIndex = p.index;
  const contents = p.sheetSrc.slice(startIndex, endIndex);
  return { startIndex, endIndex, contents };
}

interface ParseResult {
  query: ContainerQueryDescriptor;
  startIndex: number;
  endIndex: number;
}

function parseContainerQuery(p: AdhocParser): ParseResult {
  const startIndex = p.index;
  assertString(p, "@container");
  eatWhitespace(p);
  let name: string = "";
  if (peek(p) !== "(") {
    name = parseIdentifier(p);
    eatWhitespace(p);
  }
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
  assertString(p, "{");
  eatWhitespace(p);
  const rules = [];
  while (peek(p) !== "}") {
    rules.push(parseRule(p));
    eatWhitespace(p);
  }
  assertString(p, "}");
  const endIndex = p.index;
  eatWhitespace(p);
  const className = `cq_${uid()}`;
  return {
    query: {
      breakPoint: {
        measurement,
        threshold,
      },
      className,
      name,
      rules,
    },
    startIndex,
    endIndex,
  };
}

function stringifyContainerQuery(query: ContainerQueryDescriptor): string {
  return query.rules
    .map(
      (rule) => `.${query.className} ${rule.selector} ${rule.block.contents}`
    )
    .join("\n");
}
