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
  consumeWhitespace,
  createNodeParser,
  Node,
  Parser,
  Type,
} from './css.js';

export const enum ComparisonOperator {
  EQUAL = 1,
  GREATER_THAN,
  GREATER_THAN_EQUAL,
  LESS_THAN,
  LESS_THAN_EQUAL,
}

export const enum FeatureType {
  Boolean = 1,
  Range,
}

export interface BooleanFeatureNode {
  type: FeatureType.Boolean;
  feature: string;
}

export type Bound = [ComparisonOperator, ReadonlyArray<Node>];

export interface RangeFeatureNode {
  type: FeatureType.Range;
  feature: string;
  bounds: [Bound, Bound] | [Bound, null] | [null, Bound];
}

const enum Delim {
  GREATER_THAN = '>',
  LESS_THAN = '<',
  EQUAL = '=',
}

function tryConsumeEqualsDelim(parser: Parser<Node>): boolean {
  const next = parser.at(1);
  if (next.type !== Type.DelimToken || next.value !== Delim.EQUAL) {
    return false;
  }
  parser.consume(1);
  return true;
}

function consumeUntilOperatorDelim(
  parser: Parser<Node>,
  includeColon: boolean
): Node[] {
  const nodes: Node[] = [];

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const next = parser.at(1);

    if (
      next.type === Type.EOFToken ||
      (includeColon && next.type === Type.ColonToken) ||
      (next.type === Type.DelimToken &&
        (next.value === Delim.GREATER_THAN ||
          next.value === Delim.LESS_THAN ||
          next.value === Delim.EQUAL))
    ) {
      break;
    }

    nodes.push(parser.consume(1));
  }

  return nodes;
}

function consumeComparisonOperator(
  parser: Parser<Node>
): ComparisonOperator | null {
  consumeWhitespace(parser);

  const node = parser.consume(1);
  if (node.type !== Type.DelimToken) {
    return null;
  }

  if (node.value === Delim.GREATER_THAN) {
    return tryConsumeEqualsDelim(parser)
      ? ComparisonOperator.GREATER_THAN_EQUAL
      : ComparisonOperator.GREATER_THAN;
  } else if (node.value === Delim.LESS_THAN) {
    return tryConsumeEqualsDelim(parser)
      ? ComparisonOperator.LESS_THAN_EQUAL
      : ComparisonOperator.LESS_THAN;
  } else if (node.value === Delim.EQUAL) {
    return ComparisonOperator.EQUAL;
  } else {
    return null;
  }
}

function isLessThan(operator: ComparisonOperator): boolean {
  return (
    operator === ComparisonOperator.LESS_THAN ||
    operator === ComparisonOperator.LESS_THAN_EQUAL
  );
}

function isGreaterThan(operator: ComparisonOperator): boolean {
  return (
    operator === ComparisonOperator.GREATER_THAN ||
    operator === ComparisonOperator.GREATER_THAN_EQUAL
  );
}

function consumeStandaloneIdent(parser: Parser<Node>): string | null {
  consumeWhitespace(parser);
  const node = parser.consume(1);
  consumeWhitespace(parser);

  return node.type !== Type.IdentToken || parser.at(1).type !== Type.EOFToken
    ? null
    : node.value;
}

function tryGetFeatureName(
  chunk: ReadonlyArray<Node>,
  features: ReadonlySet<string>,
  transform?: (value: string) => string
): string | null {
  const maybeIdent = consumeStandaloneIdent(createNodeParser(chunk));
  let feature = maybeIdent ? maybeIdent.toLowerCase() : null;

  if (feature === null) {
    return null;
  }

  feature = transform ? transform(feature) : feature;
  return features.has(feature) ? feature : null;
}

export function consumeMediaFeature(
  parser: Parser<Node>,
  features: ReadonlySet<string>
): BooleanFeatureNode | RangeFeatureNode | null {
  const firstChunk = consumeUntilOperatorDelim(parser, true);
  const next = parser.at(1);

  if (next.type === Type.EOFToken) {
    const feature = tryGetFeatureName(firstChunk, features);
    return feature && features.has(feature)
      ? {type: FeatureType.Boolean, feature}
      : null;
  } else if (next.type === Type.ColonToken) {
    parser.consume(1);
    const value = consumeUntilOperatorDelim(parser, false);

    let operator = ComparisonOperator.EQUAL;
    const feature = tryGetFeatureName(firstChunk, features, rawFeature => {
      if (rawFeature.startsWith('min-')) {
        operator = ComparisonOperator.GREATER_THAN_EQUAL;
        return rawFeature.substring(4);
      } else if (rawFeature.startsWith('max-')) {
        operator = ComparisonOperator.LESS_THAN_EQUAL;
        return rawFeature.substring(4);
      }
      return rawFeature;
    });

    return feature
      ? {
          type: FeatureType.Range,
          feature,
          bounds: [null, [operator, value]],
        }
      : null;
  }

  const firstOperator = consumeComparisonOperator(parser);
  if (firstOperator === null) {
    return null;
  }

  const secondChunk = consumeUntilOperatorDelim(parser, false);
  if (parser.at(1).type === Type.EOFToken) {
    const maybeFirstChunkFeature = tryGetFeatureName(firstChunk, features);
    if (maybeFirstChunkFeature) {
      return {
        type: FeatureType.Range,
        feature: maybeFirstChunkFeature,
        bounds: [null, [firstOperator, secondChunk]],
      };
    }

    const maybeSecondChunkFeature = tryGetFeatureName(secondChunk, features);
    if (maybeSecondChunkFeature !== null) {
      return {
        type: FeatureType.Range,
        feature: maybeSecondChunkFeature,
        bounds: [[firstOperator, firstChunk], null],
      };
    }

    return null;
  }

  const secondOperator = consumeComparisonOperator(parser);
  if (
    secondOperator === null ||
    !(
      (isGreaterThan(firstOperator) && isGreaterThan(secondOperator)) ||
      (isLessThan(firstOperator) && isLessThan(secondOperator))
    )
  ) {
    return null;
  }

  const thirdChunk = consumeUntilOperatorDelim(parser, false);
  const maybeFeature = tryGetFeatureName(secondChunk, features);

  return maybeFeature
    ? {
        type: FeatureType.Range,
        feature: maybeFeature,
        bounds: [
          [firstOperator, firstChunk],
          [secondOperator, thirdChunk],
        ],
      }
    : null;
}
