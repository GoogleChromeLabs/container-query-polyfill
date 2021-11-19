/**
 * Copyright 2021 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

interface SizeQuery {
  type: ContainerConditionType.SizeQuery;
  measurement: Measurement;
  threshold: number;
}

interface ContainerConditionConjunction {
  type: ContainerConditionType.ContainerConditionConjunction;
  left: ContainerCondition;
  right: ContainerCondition;
}

interface ContainerConditionDisjunction {
  type: ContainerConditionType.ContainerConditionDisjunction;
  left: ContainerCondition;
  right: ContainerCondition;
}

interface ContainerConditionNegation {
  type: ContainerConditionType.ContainerConditionNegation;
  right: ContainerCondition;
}

enum ContainerConditionType {
  SizeQuery,
  ContainerConditionConjunction,
  ContainerConditionDisjunction,
  ContainerConditionNegation,
}

type ContainerCondition =
  | SizeQuery
  | ContainerConditionConjunction
  | ContainerConditionDisjunction
  | ContainerConditionNegation;

interface ContainerQueryDescriptor {
  name?: string;
  condition: ContainerCondition;
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

function isQueryFullfilled_internal(
  condition: ContainerCondition,
  borderBox: ResizeObserverSize
): boolean {
  switch (condition.type) {
    case ContainerConditionType.ContainerConditionConjunction:
      return (
        isQueryFullfilled_internal(condition.left, borderBox) &&
        isQueryFullfilled_internal(condition.right, borderBox)
      );
    case ContainerConditionType.ContainerConditionDisjunction:
      return (
        isQueryFullfilled_internal(condition.left, borderBox) ||
        isQueryFullfilled_internal(condition.right, borderBox)
      );
    case ContainerConditionType.ContainerConditionNegation:
      return !isQueryFullfilled_internal(condition.right, borderBox);
    case ContainerConditionType.SizeQuery:
      return comparators.get(condition.measurement)!(
        borderBox,
        condition.threshold
      );
    default:
      throw Error("wtf?");
  }
}

function isQueryFullfilled(
  condition: ContainerCondition,
  entry: ResizeObserverEntry
): boolean {
  let borderBox;
  if ("borderBoxSize" in entry) {
    // At the time of writing, the array will always be length one in Chrome.
    // In Firefox, it won’t be an array, but a single object.
    borderBox = entry.borderBoxSize?.[0] ?? entry.borderBoxSize;
  } else {
    // Safari doesn’t have borderBoxSize at all, but only offers `contentRect`,
    // so we have to do some maths ourselves.
    const computed = getComputedStyle(entry.target);
    borderBox = {
      // FIXME: This will if you are not in tblr writing mode
      blockSize: entry.contentRect.height,
      inlineSize: entry.contentRect.width,
    };
    // Cut off the "px" suffix from the computed styles.
    borderBox.blockSize +=
      parseInt(computed.paddingBlockStart.slice(0, -2)) +
      parseInt(computed.paddingBlockEnd.slice(0, -2));
    borderBox.inlineSize +=
      parseInt(computed.paddingInlineStart.slice(0, -2)) +
      parseInt(computed.paddingInlineEnd.slice(0, -2));
  }
  return isQueryFullfilled_internal(condition, borderBox);
}

function findParentContainer(el: Element, name?: string): Element | null {
  while (el) {
    el = el.parentElement;
    if (!containerNames.has(el)) continue;
    if (name) {
      const containerName = containerNames.get(el)!;
      if (!containerName.includes(name)) continue;
    }
    return el;
  }
  return null;
}

const containerNames: WeakMap<Element, string[]> = new WeakMap();
function registerContainer(el: Element, name: string) {
  containerRO.observe(el);
  if (!containerNames.has(el)) {
    containerNames.set(el, []);
  }
  containerNames.get(el)!.push(name);
}
const queries: Array<ContainerQueryDescriptor> = [];
function registerContainerQuery(cqd: ContainerQueryDescriptor) {
  queries.push(cqd);
}
const containerRO = new ResizeObserver((entries) => {
  const changedContainers: Map<Element, ResizeObserverEntry> = new Map(
    entries.map((entry) => [entry.target, entry])
  );
  for (const query of queries) {
    for (const { selector } of query.rules) {
      const els = document.querySelectorAll(selector);
      for (const el of els) {
        const container = findParentContainer(el, query.name);
        if (!container) continue;
        if (!changedContainers.has(container)) continue;
        const entry = changedContainers.get(container);
        el.classList.toggle(
          query.className,
          isQueryFullfilled(query.condition, entry)
        );
      }
    }
  }
});

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
  name?: string;
}

export function transpileStyleSheet(sheetSrc: string, name?: string): string {
  const p: AdhocParser = {
    sheetSrc,
    index: 0,
    name,
  };

  while (p.index < p.sheetSrc.length) {
    eatWhitespace(p);
    if (p.index >= p.sheetSrc.length) break;
    while (lookAhead("/*", p)) {
      eatComment(p);
      eatWhitespace(p);
    }
    if (lookAhead("@container", p)) {
      const { query, startIndex, endIndex } = parseContainerQuery(p);
      const replacement = stringifyContainerQuery(query);
      replacePart(startIndex, endIndex, replacement, p);
      registerContainerQuery(query);
    } else {
      const rule = parseRule(p);
      if (!rule) continue;
      handleContainerProps(rule, p);
    }
  }
  return p.sheetSrc;
}

function handleContainerProps(rule: Rule, p) {
  const hasLongHand = rule.block.contents.includes("container-");
  const hasShortHand = rule.block.contents.includes("container:");
  if (!hasLongHand && !hasShortHand) return;
  let containerName, containerType;
  if (hasLongHand) {
    containerName = /container-name: ([^;}]+)/.exec(rule.block.contents)?.[1];
    rule.block.contents = rule.block.contents.replace(
      "container-type",
      "contain"
    );
  }
  if (hasShortHand) {
    const containerShorthand = /container: ([^;}]+)/.exec(
      rule.block.contents
    )?.[1];
    [containerType, containerName] = containerShorthand
      .split("/")
      .map((v) => v.trim());
    rule.block.contents = rule.block.contents.replace(
      /container: ([^;}]+)/,
      `contain: ${containerType};`
    );
  }
  if (!containerName) {
    containerName = uid();
  }
  replacePart(
    rule.block.startIndex,
    rule.block.endIndex,
    rule.block.contents,
    p
  );
  watchedContainerSelectors.push({
    name: containerName,
    selector: rule.selector,
  });
  for (const el of document.querySelectorAll(rule.selector)) {
    registerContainer(el, containerName);
  }
}

function replacePart(
  start: number,
  end: number,
  replacement: string,
  p: AdhocParser
) {
  p.sheetSrc = p.sheetSrc.slice(0, start) + replacement + p.sheetSrc.slice(end);
  // If we are pointing past the end of the affected section, we need to
  // recalculate the string pointer. Pointing to something inside the section
  // that’s being replaced is undefined behavior. Sue me.
  if (p.index >= end) {
    const delta = p.index - end;
    p.index = start + replacement.length + delta;
  }
}

function eatComment(p: AdhocParser) {
  assertString(p, "/*");
  eatUntil("*/", p);
  assertString(p, "*/");
}

function advance(p: AdhocParser) {
  p.index++;
  if (p.index > p.sheetSrc.length) {
    throw parseError(p, "Advanced beyond the end");
  }
}

function eatUntil(s: string, p: AdhocParser): string {
  const startIndex = p.index;
  while (!lookAhead(s, p)) {
    advance(p);
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

function parseSelector(p: AdhocParser): string | undefined {
  let startIndex = p.index;
  while (/[\sa-zA-Z0-9:_\.,()#\[\]='"+~*-]/.test(p.sheetSrc[p.index])) {
    advance(p);
  }
  if (!lookAhead("{", p)) {
    eatUntil("\n", p);
    eatWhitespace(p);
    return;
  }
  return p.sheetSrc.slice(startIndex, p.index);
}

function parseRule(p: AdhocParser): Rule | undefined {
  const startIndex = p.index;
  const selector = parseSelector(p);
  if (!selector) return;
  const block = eatBlock(p);
  const endIndex = p.index;
  return {
    selector,
    block,
    startIndex,
    endIndex,
  };
}

function fileName(p: AdhocParser): string {
  if (p.name) {
    return p.name;
  }
  return "<anonymous file>";
}

function parseError(p: AdhocParser, msg: string): Error {
  return Error(`(${fileName(p)}): ${msg}`);
}

function assertString(p: AdhocParser, s: string) {
  if (p.sheetSrc.substr(p.index, s.length) != s) {
    throw parseError(p, `Did not find expected sequence ${s}`);
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

const identMatcher = /[\w\\\@_-]+/g;
function parseIdentifier(p: AdhocParser): string {
  identMatcher.lastIndex = p.index;
  const match = identMatcher.exec(p.sheetSrc);
  if (!match) {
    throw parseError(p, "Expected an identifier");
  }
  p.index += match[0].length;
  return match[0];
}

// This function does stuff like `min-width` => `MinWidth`
function undashify(s: string): string {
  const v = s
    .replace(/-(\w)/, (_, l) => l.toUpperCase())
    .replace(/^\w/, (v) => v.toUpperCase());
  return v;
}

function parseMeasurementName(p: AdhocParser): Measurement {
  const measurementName = undashify(parseIdentifier(p).toLowerCase());
  if (!(measurementName in Measurement)) {
    throw parseError(p, `Unknown query ${measurementName}`);
  }
  // FIXME: lol
  return Measurement[measurementName as any] as any;
}

const numberMatcher = /[0-9.]*/g;
function parseThreshold(p: AdhocParser): number {
  numberMatcher.lastIndex = p.index;
  const match = numberMatcher.exec(p.sheetSrc);
  if (!match) {
    throw parseError(p, "Expected a number");
  }
  p.index += match[0].length;
  // TODO: Support other units?
  assertString(p, "px");
  const value = parseFloat(match[0]);
  if (Number.isNaN(value)) {
    throw parseError(p, `${match[0]} is not a valid number`);
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
    advance(p);
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

function parseSizeQuery(p: AdhocParser): ContainerCondition {
  assertString(p, "(");
  if (lookAhead("(", p)) {
    const cond = parseContainerCondition(p);
    assertString(p, ")");
    return cond;
  }
  const measurement = parseMeasurementName(p);
  eatWhitespace(p);
  assertString(p, ":");
  eatWhitespace(p);
  const threshold = parseThreshold(p);
  eatWhitespace(p);
  assertString(p, ")");
  eatWhitespace(p);
  return {
    type: ContainerConditionType.SizeQuery,
    measurement,
    threshold,
  };
}

function parseNegatedContainerCondition(p: AdhocParser): ContainerCondition {
  if (lookAhead("not", p)) {
    assertString(p, "not");
    eatWhitespace(p);
    return {
      type: ContainerConditionType.ContainerConditionNegation,
      right: parseSizeQuery(p),
    };
  }
  return parseSizeQuery(p);
}
function parseContainerCondition(p: AdhocParser): ContainerCondition {
  let left = parseNegatedContainerCondition(p);

  while (true) {
    if (lookAhead("and", p)) {
      assertString(p, "and");
      eatWhitespace(p);
      const right = parseNegatedContainerCondition(p);
      eatWhitespace(p);
      left = {
        type: ContainerConditionType.ContainerConditionConjunction,
        left,
        right,
      };
    } else if (lookAhead("or", p)) {
      assertString(p, "or");
      eatWhitespace(p);
      const right = parseNegatedContainerCondition(p);
      eatWhitespace(p);
      left = {
        type: ContainerConditionType.ContainerConditionDisjunction,
        left,
        right,
      };
    } else {
      break;
    }
  }
  return left;
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
  const condition = parseContainerCondition(p);
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
      condition,
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
      (rule) =>
        `:is(${rule.selector}).${query.className} ${rule.block.contents}`
    )
    .join("\n");
}
