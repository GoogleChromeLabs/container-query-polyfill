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
} from './utils/css';
import {
  ContainerType,
  evaluateContainerCondition,
  ExpressionNode,
  WritingMode,
} from './evaluate';
import {
  parseContainerNameProperty,
  parseContainerRule,
  parseContainerShorthand,
  parseContainerTypeProperty,
} from './parser';

interface ContainerQueryDescriptor {
  name?: string;
  condition: ExpressionNode;
  className: string;
  rules: Rule[];
}

interface Rule {
  selector: string;
}

function uid(): string {
  return Array.from({length: 16}, () =>
    Math.floor(Math.random() * 256).toString(16)
  ).join('');
}

function getWritingMode(value: string): WritingMode | null {
  const lowerValue = value.toLowerCase();
  if (lowerValue.startsWith('horizontal')) {
    return WritingMode.Horizontal;
  } else if (
    lowerValue.startsWith('vertical') ||
    lowerValue.startsWith('sideways')
  ) {
    return WritingMode.Vertical;
  } else {
    return null;
  }
}

function isQueryFullfilled(
  condition: ExpressionNode,
  entry: ResizeObserverEntry
): boolean {
  const contentRect = entry.contentRect;
  const computed = getComputedStyle(entry.target);

  const writingMode = getWritingMode(computed.writingMode);
  if (writingMode === null) {
    return false;
  }

  return evaluateContainerCondition(condition, {
    width:
      contentRect.width +
      parseInt(computed.paddingLeft.slice(0, -2)) +
      parseInt(computed.paddingRight.slice(0, -2)),
    height:
      contentRect.height +
      parseInt(computed.paddingTop.slice(0, -2)) +
      parseInt(computed.paddingBottom.slice(0, -2)),
    writingMode,
  });
}

function findParentContainer(elem: Element, name?: string): Element | null {
  let el: Element | null = elem;
  while (el) {
    el = el.parentElement;
    const containerName = el ? containerNames.get(el) : null;
    if (!containerName) continue;
    if (name) {
      if (!containerName.includes(name)) continue;
    }
    return el;
  }
  return null;
}

let containerNames: WeakMap<Element, string[]>;
function registerContainer(el: Element, name: string) {
  containerRO.observe(el);
  let namesForElement = containerNames.get(el);
  if (!namesForElement) {
    namesForElement = [];
    containerNames.set(el, namesForElement);
  }
  namesForElement.push(name);
}
let queries: Array<ContainerQueryDescriptor>;
function registerContainerQuery(cqd: ContainerQueryDescriptor) {
  queries.push(cqd);
}
let containerRO: ResizeObserver;

interface WatchedSelector {
  selector: string;
  name: string;
}
let watchedContainerSelectors: WatchedSelector[];
let containerMO: MutationObserver;

export function preinit() {
  watchedContainerSelectors = [];
  containerNames = new WeakMap();
  queries = [];

  if (containerMO) {
    containerMO.disconnect();
  }
  if (containerRO) {
    containerRO.disconnect();
  }
}

export function init() {
  containerRO = new ResizeObserver(entries => {
    const changedContainers: Map<Element, ResizeObserverEntry> = new Map(
      entries.map(entry => [entry.target, entry])
    );
    for (const query of queries) {
      for (const {selector} of query.rules) {
        const els = document.querySelectorAll(selector);
        for (const el of els) {
          const container = findParentContainer(el, query.name);
          if (!container) continue;
          if (!changedContainers.has(container)) continue;
          const entry = changedContainers.get(container);
          if (!entry) continue;
          el.classList.toggle(
            query.className,
            isQueryFullfilled(query.condition, entry)
          );
        }
      }
    }
  });

  containerMO = new MutationObserver(entries => {
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
}

export function transpileStyleSheet(
  sheetSrc: string,
  srcUrl?: string
): [string[], string] {
  function transformStylesheet(nodes: Array<Node>): Array<Node> {
    return nodes.map(transformRule).filter(Boolean) as any;
  }

  function transformRule(node: Node): Node | null {
    switch (node.type) {
      case Type.AtRuleNode:
        return transformAtRule(node);

      case Type.QualifiedRuleNode:
        return transformQualifiedRule(node);

      default:
        return node;
    }
  }

  function transformContainerRules(
    nodes: Node[],
    className: string
  ): [QualifiedRuleNode[], QualifiedRuleNode[]] {
    const origRules: QualifiedRuleNode[] = [];
    const rules: QualifiedRuleNode[] = [];

    nodes.forEach(node => {
      if (node.type === Type.QualifiedRuleNode) {
        origRules.push(node);
        rules.push({
          ...node,
          prelude: [
            {type: Type.FunctionNode, name: ':is', value: node.prelude},
            {type: Type.DelimToken, value: '.'},
            {type: Type.IdentToken, value: className},
          ],
        });
      }
    });

    return [origRules, rules];
  }

  function transformAtRule(node: AtRuleNode): AtRuleNode | null {
    const lowerCaseName = node.name.toLocaleLowerCase();

    switch (lowerCaseName) {
      case 'container':
      case 'media':
        if (lowerCaseName === 'container' && node.value) {
          const className = `cq_${uid()}`;
          const result = parseContainerRule(node.prelude);

          if (!result) {
            return null;
          }

          const [rules, transformedRules] = transformContainerRules(
            transformStylesheet(parseStylesheet(node.value.value)),
            className
          );

          registerContainerQuery({
            name: result.names[0],
            condition: result.condition,
            rules: rules.map(rule => ({
              selector: serialize(rule.prelude),
            })),
            className,
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
              value: transformedRules,
            },
          };
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

    return node;
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

    if (containerType !== null) {
      declarations.push({
        type: Type.DeclarationNode,
        name: 'contain',
        value: [
          {
            type: Type.IdentToken,
            value: 'size',
          },
        ],
        important: false,
      });

      const containerName = containerNames ? containerNames[0] : uid();
      const selector = serialize(node.prelude).trim();
      watchedContainerSelectors.push({
        name: containerName,
        selector: selector,
      });
      for (const el of document.querySelectorAll(selector)) {
        registerContainer(el, containerName);
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

  const newSrc = serialize(transformStylesheet(parseStylesheet(tokens)));
  return [[], newSrc];
}
