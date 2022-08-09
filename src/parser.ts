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

import {INTERNAL_KEYWORD_PREFIX} from './constants.js';
import {
  ExpressionNode,
  ExpressionType,
  SizeFeature,
  Value,
  ValueType,
} from './evaluate.js';
import {
  consumeWhitespace,
  createNodeParser,
  isEOF,
  Node,
  Parser,
  ParseResult,
  PARSE_ERROR,
  Type,
} from './utils/css.js';
import {consumeMediaFeature, FeatureType} from './utils/parse-media-feature.js';
import {
  consumeMediaCondition,
  GenericExpressionNode,
  GenericExpressionType,
} from './utils/parse-media-query.js';

export interface ContainerRule {
  name: string | null;
  condition: ExpressionNode;
  features: Set<SizeFeature>;
}

export interface ContainerRuleContext {
  features: Set<SizeFeature>;
}

type ContainerNamesResult = string[];
type ContainerTypesResult = string[];

const SIZE_FEATURE_MAP: Record<string, SizeFeature> = {
  width: SizeFeature.Width,
  height: SizeFeature.Height,
  'inline-size': SizeFeature.InlineSize,
  'block-size': SizeFeature.BlockSize,
  'aspect-ratio': SizeFeature.AspectRatio,
  orientation: SizeFeature.Orientation,
};
const FEATURE_NAMES = new Set(Object.keys(SIZE_FEATURE_MAP));

const CONTAINER_INVALID_NAMES = new Set([
  'none',
  'and',
  'not',
  'or',
  'normal',
  'auto',
]);
const CONTAINER_STANDALONE_KEYWORD = new Set([
  'initial',
  'inherit',
  'revert',
  'revert-layer',
  'unset',
]);
const CONTAINER_TYPES = new Set(['size', 'inline-size']);

function consumeMaybeSeparatedByDelim<A, B>(
  parser: Parser<Node>,
  delim: string,
  consumeA: () => ParseResult<A>,
  consumeB: () => ParseResult<B>
): ParseResult<[A, B | null]> {
  const first = consumeA();
  if (first === PARSE_ERROR) {
    return PARSE_ERROR;
  }

  let res: [A, B | null] = [first, null];
  consumeWhitespace(parser);
  const next = parser.at(1);
  if (next.type === Type.DelimToken) {
    if (next.value !== delim) {
      return PARSE_ERROR;
    }

    parser.consume(1);
    consumeWhitespace(parser);
    const second = consumeB();
    consumeWhitespace(parser);

    if (second !== PARSE_ERROR) {
      res = [first, second];
    }
  }

  return isEOF(parser) ? res : PARSE_ERROR;
}

function consumeNumber(parser: Parser<Node>): ParseResult<number> {
  const node = parser.consume(1);
  return node.type === Type.NumberToken ? parseInt(node.value) : PARSE_ERROR;
}

function consumeNumberOrRatio(parser: Parser<Node>): ParseResult<Value> {
  const result = consumeMaybeSeparatedByDelim(
    parser,
    '/',
    () => consumeNumber(parser),
    () => consumeNumber(parser)
  );
  if (result === PARSE_ERROR) {
    return PARSE_ERROR;
  }

  const numerator = result[0];
  const denominator = result[1] !== null ? result[1] : 1;
  return {type: ValueType.Number, value: numerator / denominator};
}

function consumeValue(nodes: ReadonlyArray<Node>): ParseResult<ExpressionNode> {
  const parser = createNodeParser(nodes);
  consumeWhitespace(parser);

  const node = parser.consume(1);
  let value: ParseResult<Value> = PARSE_ERROR;

  switch (node.type) {
    case Type.NumberToken:
      parser.reconsume();
      value = consumeNumberOrRatio(parser);
      break;

    case Type.DimensionToken:
      value = {
        type: ValueType.Dimension,
        value: parseInt(node.value),
        unit: node.unit.toLowerCase(),
      } as Value;
      break;

    case Type.IdentToken: {
      const ident = node.value.toLowerCase();
      switch (ident) {
        case 'landscape':
        case 'portrait':
          value = {type: ValueType.Orientation, value: ident} as Value;
          break;
      }
    }
  }

  if (value === PARSE_ERROR) {
    return PARSE_ERROR;
  }

  return isEOF(parser) ? {type: ExpressionType.Value, value} : PARSE_ERROR;
}

function parseSizeFeature(
  parser: Parser<Node>,
  context: ContainerRuleContext
): ParseResult<ExpressionNode> {
  const mediaFeature = consumeMediaFeature(parser, FEATURE_NAMES);
  if (mediaFeature === PARSE_ERROR) {
    return PARSE_ERROR;
  }

  const feature = SIZE_FEATURE_MAP[mediaFeature.feature];
  if (feature == null) {
    return PARSE_ERROR;
  }
  // TODO: This is super wasteful, consider just using bits.
  context.features.add(feature);

  if (mediaFeature.type === FeatureType.Boolean) {
    return {type: ExpressionType.Feature, feature};
  } else {
    const featureValue = {type: ExpressionType.Feature, feature};
    let left: ParseResult<ExpressionNode> = PARSE_ERROR;

    if (mediaFeature.bounds[0] !== null) {
      const value = consumeValue(mediaFeature.bounds[0][1]);
      if (value === PARSE_ERROR) {
        return PARSE_ERROR;
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
      if (value === PARSE_ERROR) {
        return PARSE_ERROR;
      }
      const right: ExpressionNode = {
        type: ExpressionType.Comparison,
        operator: mediaFeature.bounds[1][0],
        left: featureValue,
        right: value,
      } as ExpressionNode;
      left =
        left !== PARSE_ERROR
          ? ({
              type: ExpressionType.Conjunction,
              left,
              right,
            } as ExpressionNode)
          : right;
    }

    return left;
  }
}

function isValidContainerName(name: string) {
  name = name.toLowerCase();
  return (
    !isContainerStandaloneKeyword(name) && !CONTAINER_INVALID_NAMES.has(name)
  );
}

function consumeZeroOrMoreIdents(
  parser: Parser<Node>,
  fn: (ident: string) => boolean
): string[] {
  const idents: string[] = [];

  // eslint-disable-next-line no-constant-condition
  while (true) {
    consumeWhitespace(parser);
    const next = parser.at(1);

    if (next.type !== Type.IdentToken || !fn(next.value)) {
      return idents;
    }

    parser.consume(1);
    idents.push(next.value);
  }
}

function consumeContainerNames(parser: Parser<Node>): ContainerNamesResult {
  const names: ContainerNamesResult = [];

  // eslint-disable-next-line no-constant-condition
  while (true) {
    consumeWhitespace(parser);
    const next = parser.at(1);

    if (next.type !== Type.IdentToken) {
      break;
    }

    const name = next.value;
    if (!isValidContainerName(name)) {
      break;
    }

    parser.consume(1);
    names.push(name);
  }

  return names;
}

export function isContainerStandaloneKeyword(name: string): boolean {
  return CONTAINER_STANDALONE_KEYWORD.has(name);
}

function transformInternalKeywords(idents: string[]): string[] {
  /**
   * Keywords like `inherit` have specific semantics when used in
   * a declaration, that don't necessary match the semantics we want.
   *
   * To solve this, we just append our own prefix to it when serializing
   * it out to CSS.
   */
  return idents.map(ident => INTERNAL_KEYWORD_PREFIX + ident);
}

function consumeContainerStandaloneKeyword(
  parser: Parser<Node>
): ParseResult<string[]> {
  const keywords = consumeZeroOrMoreIdents(parser, ident =>
    isContainerStandaloneKeyword(ident)
  );
  return keywords.length === 1
    ? transformInternalKeywords(keywords)
    : PARSE_ERROR;
}

function consumeContainerTypes(
  parser: Parser<Node>
): ParseResult<ContainerTypesResult> {
  const keywords = consumeZeroOrMoreIdents(parser, type => type === 'normal');
  if (keywords.length === 1) {
    return transformInternalKeywords(keywords);
  } else if (keywords.length !== 0) {
    return PARSE_ERROR;
  }

  const types = consumeZeroOrMoreIdents(parser, type =>
    CONTAINER_TYPES.has(type)
  );
  return types.length > 0 && isEOF(parser) ? types : PARSE_ERROR;
}

export function consumeContainerNameProperty(
  parser: Parser<Node>,
  standalone: boolean
): ParseResult<ContainerNamesResult> {
  const keywords = consumeZeroOrMoreIdents(parser, type => type === 'none');
  if (keywords.length === 1) {
    return transformInternalKeywords(keywords);
  } else if (keywords.length !== 0) {
    return PARSE_ERROR;
  }

  if (standalone) {
    const maybeKeywords = consumeContainerStandaloneKeyword(parser);
    if (maybeKeywords !== PARSE_ERROR) {
      return maybeKeywords;
    }
  }

  const names = consumeContainerNames(parser);
  return names.length > 0 && (!standalone || isEOF(parser))
    ? names
    : PARSE_ERROR;
}

export function consumeContainerTypeProperty(
  parser: Parser<Node>,
  standalone: boolean
): ParseResult<ContainerTypesResult> {
  if (standalone) {
    const maybeKeywords = consumeContainerStandaloneKeyword(parser);
    if (maybeKeywords !== PARSE_ERROR) {
      return maybeKeywords;
    }
  }

  return consumeContainerTypes(parser);
}

export function parseContainerShorthand(
  nodes: ReadonlyArray<Node>
): ParseResult<[ContainerNamesResult, ContainerTypesResult]> {
  const parser = createNodeParser(nodes);

  const keywords = consumeContainerStandaloneKeyword(parser);
  if (keywords !== PARSE_ERROR) {
    return [keywords, keywords];
  }

  const result = consumeMaybeSeparatedByDelim(
    parser,
    '/',
    () => consumeContainerNameProperty(parser, false),
    () => consumeContainerTypeProperty(parser, false)
  );

  return result !== PARSE_ERROR && isEOF(parser)
    ? [result[0], result[1] || []]
    : PARSE_ERROR;
}

export function parseContainerRule(
  nodes: ReadonlyArray<Node>
): ParseResult<ContainerRule> {
  const parser = createNodeParser(nodes);
  const names = consumeContainerNames(parser);

  if (!names || names.length > 1) {
    return PARSE_ERROR;
  }

  const rawCondition = consumeMediaCondition(parser);
  if (rawCondition === PARSE_ERROR) {
    return PARSE_ERROR;
  }

  const context = {features: new Set<SizeFeature>()};
  const condition = transformExpression(rawCondition, context);
  return isEOF(parser)
    ? {
        name: names.length > 0 ? names[0] : null,
        condition,
        features: context.features,
      }
    : PARSE_ERROR;
}

function transformExpression(
  node: GenericExpressionNode,
  context: ContainerRuleContext
): ExpressionNode {
  switch (node.type) {
    case GenericExpressionType.Negate:
      return {
        type: ExpressionType.Negate,
        value: transformExpression(node.value, context),
      };

    case GenericExpressionType.Conjunction:
    case GenericExpressionType.Disjunction:
      return {
        type:
          node.type === GenericExpressionType.Conjunction
            ? ExpressionType.Conjunction
            : ExpressionType.Disjunction,
        left: transformExpression(node.left, context),
        right: transformExpression(node.right, context),
      };

    case GenericExpressionType.Literal: {
      if (node.value.type === Type.BlockNode) {
        const expression = parseSizeFeature(
          createNodeParser(node.value.value.value),
          context
        );
        if (expression !== PARSE_ERROR) {
          return expression;
        }
      }
      return {type: ExpressionType.Value, value: {type: ValueType.Unknown}};
    }
  }
}
