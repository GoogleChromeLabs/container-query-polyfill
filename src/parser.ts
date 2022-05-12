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
  ContainerType,
  ExpressionNode,
  ExpressionType,
  SizeFeature,
  Value,
  ValueType,
} from './evaluate';
import {
  consumeWhitespace,
  createNodeParser,
  Node,
  Parser,
  Type,
} from './utils/css';
import {consumeMediaFeature, FeatureType} from './utils/parse-media-feature';

export interface ContainerRule {
  names: string[];
  condition: ExpressionNode;
}

const SIZE_FEATURE_MAP: Record<string, SizeFeature> = {
  width: SizeFeature.Width,
  height: SizeFeature.Height,
  'inline-size': SizeFeature.InlineSize,
  'block-size': SizeFeature.BlockSize,
  'aspect-ratio': SizeFeature.AspectRatio,
  orientation: SizeFeature.Orientation,
};
const FEATURE_NAMES = new Set(Object.keys(SIZE_FEATURE_MAP));

const enum Keyword {
  NOT = 'not',
  AND = 'and',
  OR = 'or',
  NONE = 'none',

  // CSS-Wide Keywords
  INITIAL = 'initial',
  INHERIT = 'inherit',
  UNSET = 'unset',
}

function consumeMaybeSeparatedByDelim<A, B>(
  parser: Parser<Node>,
  delim: string,
  consumeA: () => A,
  consumeB: () => B
): [A, B | null] | null {
  const first = consumeA();
  if (first === null) {
    return null;
  }

  let res: [A, B | null] = [first, null];
  consumeWhitespace(parser);
  const next = parser.at(1);
  if (next.type === Type.DelimToken) {
    if (next.value !== delim) {
      return null;
    }

    parser.consume(1);
    consumeWhitespace(parser);
    const second = consumeB();
    consumeWhitespace(parser);

    if (second !== null) {
      res = [first, second];
    }
  }

  return parser.at(1).type === Type.EOFToken ? res : null;
}

function consumeNumber(parser: Parser<Node>): number | null {
  const node = parser.consume(1);
  return node.type === Type.NumberToken ? parseInt(node.value) : null;
}

function consumeNumberOrRatio(parser: Parser<Node>): Value | null {
  const result = consumeMaybeSeparatedByDelim(
    parser,
    '/',
    () => consumeNumber(parser),
    () => consumeNumber(parser)
  );
  if (result === null) {
    return null;
  }

  const numerator = result[0];
  const denominator = result[1] !== null ? result[1] : 1;

  return numerator !== null
    ? {type: ValueType.Number, value: numerator / denominator}
    : null;
}

function consumeValue(nodes: ReadonlyArray<Node>): ExpressionNode | null {
  const parser = createNodeParser(nodes);
  consumeWhitespace(parser);

  const node = parser.consume(1);
  let value: Value | null = null;

  switch (node.type) {
    case Type.NumberToken:
      parser.reconsume();
      value = consumeNumberOrRatio(parser);
      break;

    case Type.DimensionToken:
      value = {
        type: ValueType.Dimension,
        value: parseInt(node.value),
        unit: node.unit,
      } as Value;
      break;

    case Type.IdentToken:
      switch (node.value.toLowerCase()) {
        case 'landscape':
          value = {type: ValueType.Orientation, value: 'landscape'} as Value;
          break;

        case 'portrait':
          value = {type: ValueType.Orientation, value: 'portrait'} as Value;
          break;
      }
  }

  if (value === null) {
    return null;
  }

  consumeWhitespace(parser);
  if (parser.at(1).type !== Type.EOFToken) {
    return null;
  }
  return {type: ExpressionType.Value, value};
}

function parseSizeFeature(parser: Parser<Node>): ExpressionNode | null {
  const mediaFeature = consumeMediaFeature(parser, FEATURE_NAMES);
  if (mediaFeature === null) {
    return null;
  }

  if (mediaFeature.type === FeatureType.Boolean) {
    const feature = SIZE_FEATURE_MAP[mediaFeature.feature];
    return feature !== null ? {type: ExpressionType.Feature, feature} : null;
  } else {
    const feature = SIZE_FEATURE_MAP[mediaFeature.feature];
    if (feature === null) {
      return null;
    }

    const featureValue = {type: ExpressionType.Feature, feature};
    let left: ExpressionNode | null = null;

    if (mediaFeature.bounds[0] !== null) {
      const value = consumeValue(mediaFeature.bounds[0][1]);
      if (value === null) {
        return null;
      }
      left = {
        type: ExpressionType.Comparison,
        operator: mediaFeature.bounds[0][0],
        left: value,
        right: featureValue,
      } as ExpressionNode;
    }
    if (mediaFeature.bounds[1] !== null) {
      const value = consumeValue(mediaFeature.bounds[1][1]);
      if (value === null) {
        return null;
      }
      const right: ExpressionNode = {
        type: ExpressionType.Comparison,
        operator: mediaFeature.bounds[1][0],
        left: featureValue,
        right: value,
      } as ExpressionNode;
      left = left
        ? {
            type: ExpressionType.Conjunction,
            left,
            right,
          }
        : right;
    }

    return left;
  }
}

function parseQueryInParens(parser: Parser<Node>): ExpressionNode | null {
  const node = parser.consume(1);

  switch (node.type) {
    case Type.SimpleBlockNode: {
      if (node.source.type !== Type.LeftParenthesisToken) {
        return null;
      }

      const maybeContainerCondition = parseContainerCondition(
        createNodeParser(node.value),
        false,
        null
      );
      if (maybeContainerCondition) {
        return maybeContainerCondition;
      }

      const maybeSizeFeature = parseSizeFeature(createNodeParser(node.value));
      if (maybeSizeFeature) {
        return maybeSizeFeature;
      }

      return {type: ExpressionType.Value, value: {type: ValueType.Unknown}};
    }

    case Type.FunctionNode:
      return {type: ExpressionType.Value, value: {type: ValueType.Unknown}};

    default:
      return null;
  }
}

function parseContainerCondition(
  parser: Parser<Node>,
  topLevel: boolean,
  andOr: Keyword.AND | Keyword.OR | null
): ExpressionNode | null {
  consumeWhitespace(parser);

  let negated = false;
  let next: Node = parser.at(1);

  if (
    topLevel &&
    next.type !== Type.FunctionNode &&
    (next.type !== Type.SimpleBlockNode ||
      next.source.type !== Type.LeftParenthesisToken)
  ) {
    // TODO: WPT currently assumes the top level of a condition
    // is a function or enclosed in parens. Fix this when clarified.
    return null;
  }

  if (next.type === Type.IdentToken) {
    if (next.value.toLowerCase() !== Keyword.NOT) {
      return null;
    }
    parser.consume(1);
    consumeWhitespace(parser);
    negated = true;
  }

  let left = parseQueryInParens(parser);
  if (left === null) {
    return null;
  }
  left = negated
    ? {
        type: ExpressionType.Negate,
        value: left,
      }
    : left;

  consumeWhitespace(parser);
  next = parser.at(1);

  if (topLevel && next.type !== Type.EOFToken) {
    // TODO: WPT currently assumes the top level of a condition
    // is a function or enclosed in parens. Fix this when clarified.
    return null;
  }

  const nextAndOr =
    next.type === Type.IdentToken ? next.value.toLowerCase() : null;

  if (nextAndOr !== null) {
    parser.consume(1);
    consumeWhitespace(parser);

    if (
      (nextAndOr !== Keyword.AND && nextAndOr !== Keyword.OR) ||
      (andOr !== null && nextAndOr !== andOr)
    ) {
      return null;
    }

    const right = parseContainerCondition(parser, false, nextAndOr);
    if (right === null) {
      return null;
    }

    return {
      type:
        nextAndOr === Keyword.AND
          ? ExpressionType.Conjunction
          : ExpressionType.Disjunction,
      left,
      right,
    } as ExpressionNode;
  }

  return parser.at(1).type === Type.EOFToken ? left : null;
}

function consumeContainerNames(
  parser: Parser<Node>,
  expectEof: boolean
): string[] | null {
  const names: string[] = [];

  // eslint-disable-next-line no-constant-condition
  while (true) {
    consumeWhitespace(parser);
    const next = parser.at(1);

    if (next.type !== Type.IdentToken) {
      break;
    }

    const name = next.value.toLowerCase();
    switch (name) {
      case Keyword.NOT:
      case Keyword.AND:
      case Keyword.OR:
      case Keyword.NONE:
      case Keyword.INITIAL:
      case Keyword.INHERIT:
      case Keyword.UNSET:
        return null;

      default:
        break;
    }

    parser.consume(1);
    names.push(name);

    // TODO: The spec allows for multiple names but WPT does not.
    // This function should be updated after that is clarified.
    break;
  }

  return expectEof && parser.at(1).type !== Type.EOFToken ? null : names;
}

function consumeContainerType(parser: Parser<Node>): ContainerType | null {
  consumeWhitespace(parser);
  const node = parser.consume(1);
  consumeWhitespace(parser);

  if (node.type !== Type.IdentToken || parser.at(1).type !== Type.EOFToken) {
    return null;
  }

  switch (node.value.toLowerCase()) {
    case 'size':
      return ContainerType.Size;

    case 'inline-size':
      return ContainerType.InlineSize;

    default:
      return null;
  }
}

export function parseContainerNameProperty(
  nodes: ReadonlyArray<Node>
): string[] | null {
  return consumeContainerNames(createNodeParser(nodes), true);
}

export function parseContainerTypeProperty(
  nodes: ReadonlyArray<Node>
): ContainerType | null {
  return consumeContainerType(createNodeParser(nodes));
}

export function parseContainerShorthand(
  nodes: ReadonlyArray<Node>
): [string[] | null, ContainerType | null] | null {
  const parser = createNodeParser(nodes);
  const result = consumeMaybeSeparatedByDelim(
    parser,
    '/',
    () => consumeContainerNames(parser, false),
    () => consumeContainerType(parser)
  );

  return result === null || result[0] === null ? null : result;
}

export function parseContainerRule(
  nodes: ReadonlyArray<Node>
): ContainerRule | null {
  const parser = createNodeParser(nodes);
  const names = consumeContainerNames(parser, false);

  const condition = parseContainerCondition(parser, true, null);
  return names !== null && condition !== null ? {names, condition} : null;
}
