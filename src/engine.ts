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

const enum Comparator {
  LESS_THAN,
  LESS_OR_EQUAL,
  GREATER_THAN,
  GREATER_OR_EQUAL,
}

interface SizeQuery {
  type: ContainerConditionType.SizeQuery;
  feature: string;
  comparator: Comparator;
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

function translateToLogicalProp(feature: string): string {
  switch (feature.toLowerCase()) {
    case "inlinesize":
      return "inlineSize";
    case "blocksize":
      return "blockSize";
    case "width":
      return "inlineSize";
    case "height":
      return "blockSize";
    default:
      throw Error(`Unknown feature name ${feature} in container query`);
  }
}

function isSizeQueryFulfilled(
  condition: SizeQuery,
  borderBox: ResizeObserverSize
): boolean {
  const value = borderBox[translateToLogicalProp(condition.feature)];
  switch (condition.comparator) {
    case Comparator.GREATER_OR_EQUAL:
      return value >= condition.threshold;
    case Comparator.GREATER_THAN:
      return value > condition.threshold;
    case Comparator.LESS_OR_EQUAL:
      return value <= condition.threshold;
    case Comparator.LESS_THAN:
      return value < condition.threshold;
  }
}

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
      return isSizeQueryFulfilled(condition, borderBox);
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
        // Check if the node itself is a container, and if so, start watching it.
        if (node.matches(watchedContainerSelector.selector)) {
          registerContainer(node, watchedContainerSelector.name);
        }
        // If the node was added with children, the children will NOT get their own
        // MO events, so we need to check the children manually.
        for (const container of node.querySelectorAll(
          watchedContainerSelector.selector
        )) {
          registerContainer(container, watchedContainerSelector.name);
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

// Loosely inspired by
// https://drafts.csswg.org/css-syntax/#parser-diagrams
export function transpileStyleSheet(sheetSrc: string, srcUrl?: string): string {
  const p: AdhocParser = {
    sheetSrc,
    index: 0,
    name: srcUrl,
  };

  while (p.index < p.sheetSrc.length) {
    eatWhitespace(p);
    if (p.index >= p.sheetSrc.length) break;
    if (lookAhead("/*", p)) {
      while (lookAhead("/*", p)) {
        eatComment(p);
        eatWhitespace(p);
      }
      continue;
    }
    if (lookAhead("@container", p)) {
      const { query, startIndex, endIndex } = parseContainerQuery(p);
      const replacement = stringifyContainerQuery(query);
      replacePart(startIndex, endIndex, replacement, p);
      registerContainerQuery(query);
    } else {
      const rule = parseQualifiedRule(p);
      if (!rule) continue;
      handleContainerProps(rule, p);
    }
  }

  // If this sheet has no srcURL (like from a <style> tag), we are
  // done. Otherwise, we have to find `url()` functions and resolve
  // relative and path-absolute URLs to absolute URLs.
  if (!srcUrl) {
    return p.sheetSrc;
  }

  p.sheetSrc = p.sheetSrc.replace(
    /url\(["']*([^)"']+)["']*\)/g,
    (match, url) => {
      return `url(${new URL(url, srcUrl)})`;
    }
  );
  return p.sheetSrc;
}

function handleContainerProps(rule: Rule, p) {
  const hasLongHand = rule.block.contents.includes("container-");
  const hasShortHand = rule.block.contents.includes("container:");
  if (!hasLongHand && !hasShortHand) return;
  let containerName, containerType;
  if (hasLongHand) {
    containerName = /container-name\s*:([^;}]+)/
      .exec(rule.block.contents)?.[1]
      .trim();
    rule.block.contents = rule.block.contents.replace(
      "container-type",
      "contain"
    );
  }
  if (hasShortHand) {
    const containerShorthand = /container\s*:([^;}]+)/.exec(
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
  eatUntil("{", p);
  if (startIndex === p.index) {
    throw Error("Empty selector");
  }
  return p.sheetSrc.slice(startIndex, p.index);
}

function parseQualifiedRule(p: AdhocParser): Rule | undefined {
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

function parseMeasurementName(p: AdhocParser): string {
  return parseIdentifier(p).toLowerCase();
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

function parseLegacySizeQuery(p: AdhocParser): SizeQuery {
  const measurement = parseMeasurementName(p);
  eatWhitespace(p);
  assertString(p, ":");
  eatWhitespace(p);
  const threshold = parseThreshold(p);
  eatWhitespace(p);
  assertString(p, ")");
  eatWhitespace(p);
  let comparator;
  if (measurement.startsWith("min-")) {
    comparator = Comparator.GREATER_OR_EQUAL;
  } else if (measurement.startsWith("max-")) {
    comparator = Comparator.LESS_OR_EQUAL;
  } else {
    throw Error(`Unknown legacy container query ${measurement}`);
  }
  return {
    type: ContainerConditionType.SizeQuery,
    feature: translateToLogicalProp(measurement.slice(4)),
    comparator,
    threshold,
  };
}

function parseComparator(p: AdhocParser): Comparator {
  if (lookAhead(">=", p)) {
    assertString(p, ">=");
    return Comparator.GREATER_OR_EQUAL;
  }
  if (lookAhead(">", p)) {
    assertString(p, ">");
    return Comparator.GREATER_THAN;
  }
  if (lookAhead("<=", p)) {
    assertString(p, "<=");
    return Comparator.LESS_OR_EQUAL;
  }
  if (lookAhead("<", p)) {
    assertString(p, "<");
    return Comparator.LESS_THAN;
  }
  throw Error(`Unknown comparator`);
}

function parseSizeQuery(p: AdhocParser): ContainerCondition {
  assertString(p, "(");
  if (lookAhead("(", p)) {
    const cond = parseContainerCondition(p);
    assertString(p, ")");
    return cond;
  }
  eatWhitespace(p);
  if (lookAhead("min-", p) || lookAhead("max-", p)) {
    return parseLegacySizeQuery(p);
  }
  const feature = parseIdentifier(p).toLowerCase();
  eatWhitespace(p);
  const comparator = parseComparator(p);
  eatWhitespace(p);
  const threshold = parseThreshold(p);
  eatWhitespace(p);
  assertString(p, ")");
  eatWhitespace(p);
  return {
    type: ContainerConditionType.SizeQuery,
    feature,
    comparator,
    threshold,
  };
}

function parseSizeOrStyleQuery(p: AdhocParser): ContainerCondition {
  eatWhitespace(p);
  if (lookAhead("(", p)) return parseSizeQuery(p);
  else if (lookAhead("size", p)) {
    assertString(p, "size");
    eatWhitespace(p);
    return parseSizeQuery(p);
  } else if (lookAhead("style", p)) {
    throw Error(`Style query not implement yet`);
  } else {
    throw Error(`Unknown container query type`);
  }
}

function parseNegatedContainerCondition(p: AdhocParser): ContainerCondition {
  if (lookAhead("not", p)) {
    assertString(p, "not");
    eatWhitespace(p);
    return {
      type: ContainerConditionType.ContainerConditionNegation,
      right: parseSizeOrStyleQuery(p),
    };
  }
  return parseSizeOrStyleQuery(p);
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
  if (peek(p) !== "(" && !lookAhead("size", p) && !lookAhead("style", p)) {
    name = parseIdentifier(p);
    eatWhitespace(p);
  }
  const condition = parseContainerCondition(p);
  eatWhitespace(p);
  assertString(p, "{");
  eatWhitespace(p);
  const rules = [];
  while (peek(p) !== "}") {
    rules.push(parseQualifiedRule(p));
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
