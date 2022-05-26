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

import {
  parseDeclarationList,
  parseStylesheet,
  serialize,
  tokenize,
  AtRuleNode,
  QualifiedRuleNode,
  Type,
  Node,
  createNodeParser,
  NumberFlag,
} from './utils/css.js';
import {
  ContainerType,
  evaluateContainerCondition,
  ExpressionNode,
  WritingMode,
} from './evaluate.js';
import {
  parseContainerNameProperty,
  parseContainerRule,
  parseContainerShorthand,
  parseContainerTypeProperty,
} from './parser.js';

interface ContainerQueryDescriptor {
  names: Set<string>;
  condition: ExpressionNode;
  className: string;
  selector: string;
  activeElements: [Set<Element>, Set<Element>];
}

const enum QueryResult {
  FALSE = 0,
  UNKNOWN = 1,
  TRUE = 2,
}

interface Container {
  element: Element;
  styles: CSSStyleDeclaration;
  rawLayoutState: RawLayoutState;
  layoutState: LayoutState;
  conditions: WeakMap<ContainerQueryDescriptor, QueryResult>;
}

interface RawLayoutState {
  type: string;
  names: string;
  writingMode: string;
  fontSize: string;
  inlineSize: string;
  blockSize: string;
}

interface LayoutState {
  type: ContainerType;
  names: Set<string>;
  writingMode: WritingMode;
  fontSize: number;
  inlineSize: number;
  blockSize: number;
  rootFontSize: number;
}

const CUSTOM_PROPERTY_UID = uid();
const CUSTOM_PROPERTY_TYPE = `--cq-container-type-${CUSTOM_PROPERTY_UID}`;
const CUSTOM_PROPERTY_NAME = `--cq-container-name-${CUSTOM_PROPERTY_UID}`;

const ELEMENT_TO_CONTAINER: Map<Element, Container> = new Map();
const ELEMENTS_TO_ADD: Set<Element> = new Set();
const ELEMENTS_TO_REMOVE: Set<Element> = new Set();

const CONTAINER_QUERIES: Set<ContainerQueryDescriptor> = new Set();

function uid(): string {
  return Array.from({length: 16}, () =>
    Math.floor(Math.random() * 256).toString(16)
  ).join('');
}

function getWritingMode(value: string): WritingMode {
  const lowerValue = value.toLowerCase();
  if (lowerValue.startsWith('horizontal')) {
    return WritingMode.Horizontal;
  } else if (
    lowerValue.startsWith('vertical') ||
    lowerValue.startsWith('sideways')
  ) {
    return WritingMode.Vertical;
  } else {
    throw new Error('Unsupported writing mode ' + value);
  }
}

function parsePixelDimension(value: string): number {
  return parseInt(value.slice(0, -2));
}

function createOrUpdateContainer(
  el: Element,
  container: Container | null,
  rootFontSize: number
) {
  const styles = container?.styles ?? window.getComputedStyle(el);
  const tmpRawLayoutState = styles
    ? {
        type: styles.getPropertyValue(CUSTOM_PROPERTY_TYPE),
        names: styles.getPropertyValue(CUSTOM_PROPERTY_NAME),
        writingMode: styles.writingMode,
        fontSize: styles.fontSize,
        inlineSize: styles.inlineSize,
        blockSize: styles.blockSize,
      }
    : null;

  if (
    tmpRawLayoutState == null ||
    tmpRawLayoutState.type.length === 0 ||
    (container && ELEMENTS_TO_REMOVE.has(el))
  ) {
    ELEMENT_TO_CONTAINER.delete(el);
    return;
  }

  const rawLayoutState = tmpRawLayoutState;
  let layoutIsDirty = false;
  function compareAndCompute<K extends keyof (RawLayoutState | LayoutState)>(
    key: K,
    compute: (val: RawLayoutState[K]) => LayoutState[K]
  ): LayoutState[K] {
    const val = rawLayoutState[key];
    if (!container || val !== container.rawLayoutState[key]) {
      layoutIsDirty = true;
      return compute(val);
    } else {
      return container.layoutState[key];
    }
  }

  const type = compareAndCompute('type', s => parseInt(s) as ContainerType);
  const names = compareAndCompute(
    'names',
    s => new Set(s.length === 0 ? [] : s.split(' '))
  );
  const writingMode = compareAndCompute('writingMode', getWritingMode);
  const fontSize = compareAndCompute('fontSize', parsePixelDimension);
  const inlineSize = compareAndCompute('inlineSize', parsePixelDimension);
  const blockSize = compareAndCompute('blockSize', parsePixelDimension);

  let layoutState = container ? container.layoutState : null;
  let conditions = container ? container.conditions : null;
  let areConditionsDirty = false;
  const prevConditions = conditions;

  if (
    layoutIsDirty ||
    !conditions ||
    !layoutState ||
    layoutState.rootFontSize !== rootFontSize
  ) {
    layoutState = {
      type,
      names,
      writingMode,
      fontSize,
      inlineSize,
      blockSize,
      rootFontSize,
    };

    conditions = new WeakMap();
    for (const query of CONTAINER_QUERIES) {
      let filtered = false;
      for (const name of query.names) {
        if (!names.has(name)) {
          filtered = true;
          break;
        }
      }

      let match = QueryResult.UNKNOWN;
      if (!filtered) {
        match = evaluateContainerCondition(query.condition, {
          type,
          inlineSize,
          blockSize,
          fontSize,
          rootFontSize,
          writingMode,
        })
          ? QueryResult.TRUE
          : QueryResult.FALSE;
      }

      if (!prevConditions || prevConditions.get(query) !== match) {
        areConditionsDirty = true;
      }

      conditions.set(query, match);
    }
  }

  if (!container) {
    container = {
      element: el,
      styles,
      rawLayoutState,
      layoutState,
      conditions,
    };
    ELEMENT_TO_CONTAINER.set(el, container);
  } else {
    container.rawLayoutState = rawLayoutState;
    container.layoutState = layoutState;
    container.conditions = conditions;
  }

  return areConditionsDirty;
}

function onAnimationFrame() {
  requestAnimationFrame(onAnimationFrame);

  const rootStyles = window.getComputedStyle(document.documentElement);
  const rootFontSize = parsePixelDimension(rootStyles.fontSize);

  let dirty = ELEMENTS_TO_ADD.size > 0 || ELEMENTS_TO_REMOVE.size > 0;
  for (const [el, container] of ELEMENT_TO_CONTAINER) {
    dirty = createOrUpdateContainer(el, container, rootFontSize) || dirty;
  }
  for (const el of ELEMENTS_TO_ADD) {
    dirty = createOrUpdateContainer(el, null, rootFontSize) || dirty;
  }

  if (dirty) {
    const parentCache = new WeakMap<Element, Container | null>();

    for (const query of CONTAINER_QUERIES) {
      const [oldElems, newElems] = query.activeElements;
      const elems =
        query.selector.length > 0
          ? document.querySelectorAll(query.selector)
          : [];

      for (const el of elems) {
        let container = findParentContainer(el, parentCache);
        let result = QueryResult.UNKNOWN;

        while (container) {
          const localResult = container.conditions.get(query);
          if (localResult != null && localResult !== QueryResult.UNKNOWN) {
            result = localResult;
            break;
          }
          container = findParentContainer(
            container.element.parentElement,
            parentCache
          );
        }

        if (result) {
          el.classList.add(query.className);
          newElems.add(el);
          oldElems.delete(el);
        }
      }

      for (const el of oldElems) {
        el.classList.remove(query.className);
      }
      oldElems.clear();
      query.activeElements = [newElems, oldElems];
    }
  }

  ELEMENTS_TO_ADD.clear();
  ELEMENTS_TO_REMOVE.clear();
}

// Start at the end of the current task, as the
// next frame will be too late.
Promise.resolve().then(onAnimationFrame);

function findParentContainer(
  el: Element | null,
  cache: WeakMap<Element, Container | null>
): Container | null {
  if (!el) {
    return null;
  }

  let container = cache.get(el) || null;
  if (!container) {
    container = ELEMENT_TO_CONTAINER.get(el) || null;
  }
  if (!container) {
    container = findParentContainer(el.parentElement, cache);
  }

  cache.set(el, container);
  return container;
}

export function preinit() {
  // ...
}

export function init() {
  // ...
}

function forEachElement(el: globalThis.Node, fn: (el: Element) => void) {
  for (const childEl of el.childNodes) {
    forEachElement(childEl, fn);
  }

  if (el instanceof HTMLElement) {
    fn(el);
  }
}

const containerMO = new MutationObserver(entries => {
  for (const entry of entries) {
    for (const node of entry.removedNodes) {
      forEachElement(node, el => {
        ELEMENTS_TO_REMOVE.add(el);
      });
    }

    for (const node of entry.addedNodes) {
      forEachElement(node, el => {
        ELEMENTS_TO_ADD.add(el);
      });
    }

    if (entry.target instanceof HTMLElement) {
      ELEMENTS_TO_ADD.add(entry.target);
    }
  }
});

containerMO.observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
});

export function transpileStyleSheet(sheetSrc: string, srcUrl?: string): string {
  function transformStylesheet(nodes: Array<Node>): Array<Node> {
    const res: Node[] = [...nodes.map(transformRule)];

    return res;
  }

  function transformRule(node: Node): Node {
    switch (node.type) {
      case Type.AtRuleNode:
        return transformAtRule(node);

      case Type.QualifiedRuleNode:
        return transformQualifiedRule(node);

      default:
        return node;
    }
  }

  function isEndOfSelector(n1: Node): boolean {
    return n1.type === Type.EOFToken || n1.type === Type.CommaToken;
  }

  function isPseudoElementStart(n1: Node, n2: Node): boolean {
    if (isEndOfSelector(n1)) {
      return true;
    } else if (n1.type === Type.ColonToken) {
      if (n2.type === Type.ColonToken) {
        return true;
      } else if (n2.type === Type.IdentToken) {
        // https://www.w3.org/TR/selectors-4/#single-colon-pseudos
        switch (n2.value.toLowerCase()) {
          case 'before':
          case 'after':
          case 'first-line':
          case 'first-letter':
            return true;
        }
      }
    }
    return false;
  }

  function trimTrailingWhitespace(nodes: Node[]): Node[] {
    for (let i = nodes.length - 1; i >= 0; i--) {
      if (nodes[i].type !== Type.WhitespaceToken) {
        return nodes.slice(0, i + 1);
      }
    }
    return nodes;
  }

  function transformSelector(
    nodes: Node[],
    className: string
  ): [Node[], Node[]] {
    const parser = createNodeParser(nodes);
    const elementSelector: Node[] = [];
    const styleSelector: Node[] = [];

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (parser.at(1).type === Type.EOFToken) {
        return [elementSelector, styleSelector];
      }

      const selectorStartIndex = Math.max(0, parser.index);

      // Consume non-pseudo part
      while (!isPseudoElementStart(parser.at(1), parser.at(2))) {
        parser.consume(1);
      }

      const pseudoStartIndex = parser.index + 1;
      const rawTargetSelector = nodes.slice(
        selectorStartIndex,
        pseudoStartIndex
      );
      const targetSelector =
        rawTargetSelector.length > 0
          ? trimTrailingWhitespace(rawTargetSelector)
          : [
              {
                type: Type.DelimToken,
                value: '*',
              } as Node,
            ];

      // Consume pseudo part
      while (!isEndOfSelector(parser.at(1))) {
        parser.consume(1);
      }

      elementSelector.push(...targetSelector);
      styleSelector.push(...targetSelector);
      styleSelector.push(
        {type: Type.ColonToken},
        {
          type: Type.FunctionNode,
          name: 'where',
          value: [
            {type: Type.DelimToken, value: '.'},
            {type: Type.IdentToken, value: className},
          ],
        }
      );
      styleSelector.push(
        ...nodes.slice(pseudoStartIndex, Math.max(0, parser.index + 1))
      );

      // Consume the end of the selector
      parser.consume(1);
    }
  }

  function transformAtRule(node: AtRuleNode): AtRuleNode {
    const lowerCaseName = node.name.toLocaleLowerCase();

    if (lowerCaseName === 'container' && node.value) {
      const className = `cq_${uid()}`;
      const result = parseContainerRule(node.prelude);

      if (result) {
        const originalRules: Node[] = transformStylesheet(
          parseStylesheet(node.value.value)
        );
        const transformedRules: Node[] = [];
        const elementSelectors = new Set<string>();

        for (const rule of originalRules) {
          if (rule.type !== Type.QualifiedRuleNode) {
            continue;
          }

          const [elementSelector, styleSelector] = transformSelector(
            rule.prelude,
            className
          );

          transformedRules.push({
            ...rule,
            prelude: styleSelector,
          });
          elementSelectors.add(serialize(elementSelector));
        }

        CONTAINER_QUERIES.add({
          names: new Set(result.names),
          condition: result.condition,
          selector: Array.from(elementSelectors).join(', '),
          className,
          activeElements: [new Set(), new Set()],
        });

        return {
          type: Type.AtRuleNode,
          name: 'media',
          prelude: [
            {
              type: Type.IdentToken,
              value: 'all',
            },
          ],
          value: {
            ...node.value,
            value: [
              {
                type: Type.QualifiedRuleNode,
                prelude: [{type: Type.DelimToken, value: '*'}],
                value: {
                  type: Type.SimpleBlockNode,
                  source: {
                    type: Type.LeftCurlyBracketToken,
                  },
                  value: [
                    {
                      type: Type.DeclarationNode,
                      name: CUSTOM_PROPERTY_TYPE,
                      value: [
                        {
                          type: Type.IdentToken,
                          value: 'initial',
                        },
                      ],
                      important: false,
                    },
                    {
                      type: Type.DeclarationNode,
                      name: CUSTOM_PROPERTY_NAME,
                      value: [
                        {
                          type: Type.IdentToken,
                          value: 'initial',
                        },
                      ],
                      important: false,
                    },
                  ],
                },
              },
              ...transformedRules,
            ],
          },
        };
      }
    }

    return {
      type: Type.AtRuleNode,
      name: node.name,
      prelude: node.prelude,
      value: node.value
        ? {
            ...node.value,
            value: transformStylesheet(parseStylesheet(node.value.value)),
          }
        : null,
    };
  }

  function transformQualifiedRule(node: QualifiedRuleNode): Node {
    const originalDeclarations = parseDeclarationList(node.value.value);
    const declarations: Node[] = [];

    let containerNames: string[] | null = null;
    let containerType: ContainerType | null = null;

    for (const declaration of originalDeclarations) {
      switch (declaration.type) {
        case Type.AtRuleNode:
          {
            const newAtRule = transformAtRule(declaration);
            if (newAtRule) {
              declarations.push(newAtRule);
            }
          }
          break;

        case Type.DeclarationNode:
          switch (declaration.name) {
            case 'container': {
              const result = parseContainerShorthand(declaration.value);
              if (result != null) {
                containerNames = result[0];
                containerType = result[1];
              }
              break;
            }

            case 'container-name': {
              const result = parseContainerNameProperty(declaration.value);
              if (result != null) {
                containerNames = result;
              }
              break;
            }

            case 'container-type': {
              const result = parseContainerTypeProperty(declaration.value);
              if (result != null) {
                containerType = result;
              }
              break;
            }

            default:
              declarations.push(declaration);
              break;
          }
          break;
      }
    }

    if (containerNames) {
      const containerNameNodes: Node[] = [];
      for (let i = 0; i < containerNames.length; i++) {
        containerNameNodes.push({
          type: Type.IdentToken,
          value: containerNames[i],
        });

        if (i + 1 < containerNames.length) {
          containerNameNodes.push({type: Type.WhitespaceToken});
        }
      }

      declarations.push({
        type: Type.DeclarationNode,
        name: CUSTOM_PROPERTY_NAME,
        value: containerNameNodes,
        important: false,
      });
    }

    if (containerType !== null) {
      declarations.push(
        {
          type: Type.DeclarationNode,
          name: 'contain',
          value: [
            {
              type: Type.IdentToken,
              value: 'size',
            },
          ],
          important: false,
        },
        {
          type: Type.DeclarationNode,
          name: CUSTOM_PROPERTY_TYPE,
          value: [
            {
              type: Type.NumberToken,
              value: `${containerType}`,
              flag: NumberFlag.INTEGER,
            },
          ],
          important: false,
        }
      );

      const selector = serialize(node.prelude).trim();
      for (const el of document.querySelectorAll(selector)) {
        ELEMENTS_TO_ADD.add(el);
      }
    }

    return {
      type: Type.QualifiedRuleNode,
      prelude: node.prelude,
      value: {
        ...node.value,
        value: declarations,
      },
    };
  }

  const tokens = Array.from(tokenize(sheetSrc));
  if (srcUrl) {
    // Ensure any URLs are absolute
    for (const token of tokens) {
      if (token.type === Type.URLToken) {
        token.value = new URL(token.value, srcUrl).toString();
      }
    }
  }

  return serialize(transformStylesheet(parseStylesheet(tokens)));
}
