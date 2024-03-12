/**
 * Copyright 2022 Google Inc. All Rights Reserved.
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
  CUSTOM_PROPERTY_NAME,
  CUSTOM_PROPERTY_SHORTHAND,
  CUSTOM_PROPERTY_TYPE,
  CUSTOM_UNIT_VARIABLE_CQB,
  CUSTOM_UNIT_VARIABLE_CQH,
  CUSTOM_UNIT_VARIABLE_CQI,
  CUSTOM_UNIT_VARIABLE_CQW,
  DATA_ATTRIBUTE_CHILD,
  DATA_ATTRIBUTE_SELF,
} from './constants.js';
import {
  parseContainerShorthand,
  consumeContainerNameProperty,
  consumeContainerTypeProperty,
  parseContainerRule,
  ContainerRule,
} from './parser.js';
import {customVar, func, delim, decl, ident} from './utils/ast.js';
import {
  AtRuleNode,
  BlockNode,
  BlockType,
  createNodeParser,
  DeclarationNode,
  DimensionToken,
  Node,
  parseComponentValue,
  parseDeclaration,
  parseStylesheet,
  PARSE_ERROR,
  QualifiedRuleNode,
  RuleListBlock,
  serialize,
  serializeBlock,
  tokenize,
  Type,
} from './utils/css.js';
import {
  GenericExpressionNode,
  GenericExpressionType,
  parseMediaCondition,
  transformMediaConditionToTokens,
} from './utils/parse-media-query.js';

export interface ContainerQueryDescriptor {
  rule: ContainerRule;
  uid: string;
  selector: string | null;
  parent: ContainerQueryDescriptor | null;
}

export interface TranspilationResult {
  source: string;
  descriptors: ContainerQueryDescriptor[];
}

interface InvalidSelector {
  actual: string;
  expected: string;
}

interface TransformContext {
  descriptors: ContainerQueryDescriptor[];
  parent: ContainerQueryDescriptor | null;
  transformStyleRule: (rule: QualifiedRuleNode) => QualifiedRuleNode;
}

let CONTAINER_ID = 0;
const CUSTOM_UNIT_MAP: Record<string, string> = {
  cqw: CUSTOM_UNIT_VARIABLE_CQW,
  cqh: CUSTOM_UNIT_VARIABLE_CQH,
  cqi: CUSTOM_UNIT_VARIABLE_CQI,
  cqb: CUSTOM_UNIT_VARIABLE_CQB,
};

const SUPPORTS_WHERE_PSEUDO_CLASS = CSS.supports('selector(:where(div))');
const NO_WHERE_SELECTOR = ':not(.container-query-polyfill)';
const NO_WHERE_SELECTOR_TOKENS = parseComponentValue(
  Array.from(tokenize(NO_WHERE_SELECTOR))
);

const DUMMY_ELEMENT = document.createElement('div');

// https://www.w3.org/TR/selectors-4/#single-colon-pseudos
const SINGLE_COLON_PSEUDO_ELEMENTS = new Set([
  'before',
  'after',
  'first-line',
  'first-letter',
]);

function isWherePseudoClassSupported(): boolean {
  try {
    // Cannot rely on CSS.supports('selector(:where(div))')
    // since it's not supported on Safari iOS < 14.5
    document.querySelector(':where(div)');
    return true;
  } catch (error) {
    return false;
  }
}

function transformContainerDimensions(node: DimensionToken): Node {
  const name = node.unit;
  const variable = CUSTOM_UNIT_MAP[name];
  if (variable != null) {
    return generateCalcExpression(node, customVar(variable));
  } else if (name === 'cqmin' || name === 'cqmax') {
    return generateCalcExpression(
      node,
      func(node.unit.slice(2), [
        customVar(CUSTOM_UNIT_VARIABLE_CQI),
        {type: Type.CommaToken},
        customVar(CUSTOM_UNIT_VARIABLE_CQB),
      ])
    );
  }
  return node;
}

function generateCalcExpression(node: DimensionToken, unit: Node): Node {
  return func('calc', [
    {type: Type.NumberToken, flag: node.flag, value: node.value},
    delim('*'),
    unit,
  ]);
}

function transformContainerUnits(nodes: ReadonlyArray<Node>): Node[] {
  return nodes.map(node => {
    switch (node.type) {
      case Type.DimensionToken:
        return transformContainerDimensions(node);

      case Type.FunctionNode:
        return {
          ...node,
          value: transformContainerUnits(node.value),
        };
    }
    return node;
  });
}

function transformPropertyDeclaration(node: DeclarationNode): DeclarationNode {
  switch (node.name) {
    case 'container': {
      const result = parseContainerShorthand(node.value);
      return result ? {...node, name: CUSTOM_PROPERTY_SHORTHAND} : node;
    }

    case 'container-name': {
      const result = consumeContainerNameProperty(
        createNodeParser(node.value),
        true
      );
      return result ? {...node, name: CUSTOM_PROPERTY_NAME} : node;
    }

    case 'container-type': {
      const result = consumeContainerTypeProperty(
        createNodeParser(node.value),
        true
      );
      return result != null ? {...node, name: CUSTOM_PROPERTY_TYPE} : node;
    }
  }
  return {
    ...node,
    value: transformContainerUnits(node.value),
  };
}

export function transformDeclarationBlock(
  node: BlockNode,
  transformAtRule?: (node: AtRuleNode) => AtRuleNode
): BlockNode {
  const declarations: Array<AtRuleNode | DeclarationNode> = [];
  let containerNames: string[] | null = null;
  let containerTypes: string[] | null = null;

  for (const declaration of node.value.value) {
    switch (declaration.type) {
      case Type.AtRuleNode:
        {
          const newAtRule = transformAtRule
            ? transformAtRule(declaration)
            : declaration;
          if (newAtRule) {
            declarations.push(newAtRule);
          }
        }
        break;

      case Type.DeclarationNode:
        {
          const newDeclaration = transformPropertyDeclaration(declaration);
          switch (newDeclaration.name) {
            case CUSTOM_PROPERTY_SHORTHAND: {
              const result = parseContainerShorthand(declaration.value);
              if (result !== PARSE_ERROR) {
                containerNames = result[0];
                containerTypes = result[1];
              }
              break;
            }

            case CUSTOM_PROPERTY_NAME: {
              const result = consumeContainerNameProperty(
                createNodeParser(declaration.value),
                true
              );
              if (result !== PARSE_ERROR) {
                containerNames = result;
              }
              break;
            }

            case CUSTOM_PROPERTY_TYPE: {
              const result = consumeContainerTypeProperty(
                createNodeParser(declaration.value),
                true
              );
              if (result !== PARSE_ERROR) {
                containerTypes = result;
              }
              break;
            }

            default:
              declarations.push(newDeclaration);
              break;
          }
        }
        break;
    }
  }

  if (containerNames && containerNames.length > 0) {
    declarations.push(
      decl(CUSTOM_PROPERTY_NAME, [ident(containerNames.join(' '))])
    );
  }

  if (containerTypes && containerTypes.length > 0) {
    declarations.push(
      decl(CUSTOM_PROPERTY_TYPE, [ident(containerTypes.join(' '))])
    );
  }

  return {
    ...node,
    value: {
      type: BlockType.DeclarationList,
      value: declarations,
    },
  };
}

export function transpileStyleSheet(
  sheetSrc: string,
  srcUrl?: string
): TranspilationResult {
  try {
    const tokens = Array.from(tokenize(sheetSrc));
    if (srcUrl) {
      // Ensure any URLs are absolute
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token.type === Type.URLToken) {
          token.value = new URL(token.value, srcUrl).toString();
        } else if (
          token.type === Type.FunctionToken &&
          token.value.toLowerCase() === 'url'
        ) {
          const nextToken = i + 1 < tokens.length ? tokens[i + 1] : null;
          if (nextToken && nextToken.type === Type.StringToken) {
            nextToken.value = new URL(nextToken.value, srcUrl).toString();
          }
        }
      }
    }

    const context: TransformContext = {
      descriptors: [],
      parent: null,
      transformStyleRule: rule => rule,
    };
    const rules = transformStylesheet(parseStylesheet(tokens, true), context);
    return {
      source: serializeBlock(rules),
      descriptors: context.descriptors,
    };
  } catch (e) {
    console.warn('An error occurred while transpiling stylesheet: ' + e);
    return {source: sheetSrc, descriptors: []};
  }
}

function transformStylesheet(
  node: RuleListBlock,
  context: TransformContext
): RuleListBlock {
  return {
    ...node,
    value: node.value.map(rule => {
      switch (rule.type) {
        case Type.AtRuleNode:
          return transformAtRule(rule, context);

        case Type.QualifiedRuleNode:
          return transformStyleRule(rule, context);

        default:
          return rule;
      }
    }),
  };
}

function isEndOfSelector(n1: Node): boolean {
  return n1.type === Type.EOFToken || n1.type === Type.CommaToken;
}

function isPseudoElementStart(n1: Node, n2: Node): boolean {
  return (
    isEndOfSelector(n1) ||
    (n1.type === Type.ColonToken &&
      (n2.type === Type.ColonToken ||
        (n2.type === Type.IdentToken &&
          SINGLE_COLON_PSEUDO_ELEMENTS.has(n2.value.toLowerCase()))))
  );
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
  containerUID: string,
  invalidSelectorCallback: (invalidSelector: InvalidSelector) => void
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
    const rawTargetSelector = nodes.slice(selectorStartIndex, pseudoStartIndex);
    const targetSelector =
      rawTargetSelector.length > 0
        ? trimTrailingWhitespace(rawTargetSelector)
        : [delim('*')];

    // Consume pseudo part
    while (!isEndOfSelector(parser.at(1))) {
      parser.consume(1);
    }

    if (IS_WPT_BUILD) {
      if (!isWherePseudoClassSupported()) {
        targetSelector.push(...NO_WHERE_SELECTOR_TOKENS);
      }
    }

    const pseudoPart = nodes.slice(
      pseudoStartIndex,
      Math.max(0, parser.index + 1)
    );
    const isSelfSelector = pseudoPart.length > 0;

    let targetSelectorForStyle = targetSelector;
    let styleSelectorSuffix: Node[] = [
      {
        type: Type.BlockNode,
        source: {type: Type.LeftSquareBracketToken},
        value: {
          type: BlockType.SimpleBlock,
          value: [
            ident(isSelfSelector ? DATA_ATTRIBUTE_SELF : DATA_ATTRIBUTE_CHILD),
            delim('~'),
            delim('='),
            {type: Type.StringToken, value: containerUID},
          ],
        },
      },
    ];

    if (!isWherePseudoClassSupported()) {
      const actual = targetSelector.map(serialize).join('');
      if (!actual.endsWith(NO_WHERE_SELECTOR)) {
        invalidSelectorCallback({
          actual,
          expected: actual + NO_WHERE_SELECTOR,
        });
      } else {
        targetSelectorForStyle = parseComponentValue(
          Array.from(
            tokenize(
              actual.substring(0, actual.length - NO_WHERE_SELECTOR.length)
            )
          )
        );
      }
    } else {
      styleSelectorSuffix = [delim(':'), func('where', styleSelectorSuffix)];
    }

    elementSelector.push(...targetSelector);
    styleSelector.push(...targetSelectorForStyle);
    styleSelector.push(...styleSelectorSuffix);
    styleSelector.push(...pseudoPart);

    // Consume the end of the selector
    parser.consume(1);
  }
}

function transformMediaAtRule(
  node: AtRuleNode,
  context: TransformContext
): AtRuleNode {
  return {
    ...node,
    value: node.value
      ? {
          ...node.value,
          value: transformStylesheet(
            parseStylesheet(node.value.value.value),
            context
          ),
        }
      : null,
  };
}

function transformKeyframesAtRule(
  node: AtRuleNode,
  context: TransformContext
): AtRuleNode {
  let value: BlockNode | null = null;
  if (node.value) {
    value = {
      ...node.value,
      value: {
        type: BlockType.RuleList,
        value: parseStylesheet(node.value.value.value).value.map(rule => {
          switch (rule.type) {
            case Type.QualifiedRuleNode:
              return transformKeyframeRule(rule, context);

            case Type.AtRuleNode:
              return transformAtRule(rule, context);
          }
        }),
      },
    };
  }

  return {
    ...node,
    value,
  };
}

function transformDeclarationBlockWithContext(
  node: BlockNode,
  context: TransformContext
) {
  return transformDeclarationBlock(node, node =>
    transformAtRule(node, context)
  );
}

function transformKeyframeRule(
  node: QualifiedRuleNode,
  context: TransformContext
): QualifiedRuleNode {
  return {
    ...node,
    value: transformDeclarationBlockWithContext(node.value, context),
  };
}

function transformSupportsExpression(
  node: GenericExpressionNode
): GenericExpressionNode {
  if (node.type === GenericExpressionType.Negate) {
    return {
      ...node,
      value: transformSupportsExpression(node.value),
    };
  } else if (
    node.type === GenericExpressionType.Conjunction ||
    node.type === GenericExpressionType.Disjunction
  ) {
    return {
      ...node,
      left: transformSupportsExpression(node.left),
      right: transformSupportsExpression(node.right),
    };
  } else if (
    node.type === GenericExpressionType.Literal &&
    node.value.type === Type.BlockNode
  ) {
    const declaration = parseDeclaration(node.value.value.value);
    if (declaration !== PARSE_ERROR) {
      return {
        ...node,
        value: {
          ...node.value,
          value: {
            type: BlockType.SimpleBlock,
            value: [transformPropertyDeclaration(declaration)],
          },
        },
      };
    }
  }
  return node;
}

function transformSupportsAtRule(
  node: AtRuleNode,
  context: TransformContext
): AtRuleNode {
  let condition = parseMediaCondition(node.prelude);
  condition =
    condition !== PARSE_ERROR
      ? transformSupportsExpression(condition)
      : PARSE_ERROR;

  return {
    ...node,
    prelude:
      condition !== PARSE_ERROR
        ? transformMediaConditionToTokens(condition)
        : node.prelude,
    value: node.value
      ? {
          ...node.value,
          value: transformStylesheet(
            parseStylesheet(node.value.value.value),
            context
          ),
        }
      : null,
  };
}

function transformContainerAtRule(
  node: AtRuleNode,
  context: TransformContext
): AtRuleNode {
  if (node.value) {
    const rule = parseContainerRule(node.prelude);
    if (rule !== PARSE_ERROR) {
      const descriptor: ContainerQueryDescriptor = {
        rule,
        selector: null,
        parent: context.parent,
        uid: `c${CONTAINER_ID++}`,
      };
      const elementSelectors = new Set<string>();
      const invalidSelectors: Array<InvalidSelector> = [];
      const transformedRules = transformStylesheet(
        parseStylesheet(node.value.value.value),
        {
          descriptors: context.descriptors,
          parent: descriptor,
          transformStyleRule: rule => {
            const [elementSelector, styleSelector] = transformSelector(
              rule.prelude,
              descriptor.uid,
              invalidSelector => {
                invalidSelectors.push(invalidSelector);
              }
            );

            if (invalidSelectors.length > 0) {
              return rule;
            }

            const elementSelectorText = elementSelector.map(serialize).join('');
            try {
              DUMMY_ELEMENT.matches(elementSelectorText);
              elementSelectors.add(elementSelectorText);
            } catch {
              // If `matches` throws, we won't use the selector when testing elements.
            }

            return {
              ...rule,
              prelude: styleSelector,
            };
          },
        }
      ).value;

      if (invalidSelectors.length > 0) {
        const selectors = new Set<string>();
        const lines: Array<string> = [];

        let largestLength = 0;
        for (const {actual} of invalidSelectors) {
          largestLength = Math.max(largestLength, actual.length);
        }
        const spaces = Array.from({length: largestLength}, () => ' ').join('');

        for (const {actual, expected} of invalidSelectors) {
          if (!selectors.has(actual)) {
            lines.push(
              `${actual}${spaces.substring(
                0,
                largestLength - actual.length
              )} => ${expected}`
            );
            selectors.add(actual);
          }
        }

        console.warn(
          `The :where() pseudo-class is not supported by this browser. ` +
            `To use the Container Query Polyfill, you must modify the ` +
            `selectors under your @container rules:\n\n${lines.join('\n')}`
        );
      }

      if (elementSelectors.size > 0) {
        descriptor.selector = Array.from(elementSelectors).join(', ');
      }
      context.descriptors.push(descriptor);

      return {
        type: Type.AtRuleNode,
        name: 'media',
        prelude: [ident('all')],
        value: {
          ...node.value,
          value: {
            type: BlockType.RuleList,
            value: transformedRules,
          },
        },
      };
    }
  }

  return node;
}

function transformLayerAtRule(
  node: AtRuleNode,
  context: TransformContext
): AtRuleNode {
  return {
    ...node,
    value: node.value
      ? {
          ...node.value,
          value: transformStylesheet(
            parseStylesheet(node.value.value.value),
            context
          ),
        }
      : null,
  };
}

function transformAtRule(
  node: AtRuleNode,
  context: TransformContext
): AtRuleNode {
  switch (node.name.toLocaleLowerCase()) {
    case 'media':
      return transformMediaAtRule(node, context);

    case 'keyframes':
      return transformKeyframesAtRule(node, context);

    case 'supports':
      return transformSupportsAtRule(node, context);

    case 'container':
      return transformContainerAtRule(node, context);

    case 'layer':
      return transformLayerAtRule(node, context);
  }
  return node;
}

function transformStyleRule(
  node: QualifiedRuleNode,
  context: TransformContext
): QualifiedRuleNode {
  return context.transformStyleRule({
    ...node,
    value: transformDeclarationBlockWithContext(node.value, context),
  });
}
