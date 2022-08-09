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

import {ident, ws} from './ast.js';
import {
  consumeWhitespace,
  createNodeParser,
  isEOF,
  Node,
  Parser,
  ParseResult,
  Type,
  PARSE_ERROR,
} from './css.js';

export const enum GenericExpressionType {
  Negate = 1,
  Conjunction,
  Disjunction,
  Literal,
}

export type GenericExpressionNode =
  | GenericNegateExpressionNode
  | GenericConjunctionExpressionNode
  | GenericDisjunctionExpressionNode
  | GenericLiteralExpressionNode;

export interface GenericNegateExpressionNode {
  type: GenericExpressionType.Negate;
  value: GenericExpressionNode;
}

export interface GenericConjunctionExpressionNode {
  type: GenericExpressionType.Conjunction;
  left: GenericExpressionNode;
  right: GenericExpressionNode;
}

export interface GenericDisjunctionExpressionNode {
  type: GenericExpressionType.Disjunction;
  left: GenericExpressionNode;
  right: GenericExpressionNode;
}

export interface GenericLiteralExpressionNode {
  type: GenericExpressionType.Literal;
  value: Node;
}

function parseQueryCondition(
  parser: Parser<Node>,
  andOr: 'and' | 'or' | null
): ParseResult<GenericExpressionNode> {
  consumeWhitespace(parser);

  let negated = false;
  let next: Node = parser.at(1);

  if (next.type === Type.IdentToken) {
    if (next.value.toLowerCase() !== 'not') {
      return PARSE_ERROR;
    }
    parser.consume(1);
    consumeWhitespace(parser);
    negated = true;
  }

  let left = parseQueryInParens(parser);
  if (left === PARSE_ERROR) {
    return PARSE_ERROR;
  }
  left = negated
    ? {
        type: GenericExpressionType.Negate,
        value: left,
      }
    : left;

  consumeWhitespace(parser);
  next = parser.at(1);

  const nextAndOr =
    next.type === Type.IdentToken ? next.value.toLowerCase() : null;

  if (nextAndOr !== null) {
    parser.consume(1);
    consumeWhitespace(parser);

    if (
      (nextAndOr !== 'and' && nextAndOr !== 'or') ||
      (andOr !== null && nextAndOr !== andOr)
    ) {
      return PARSE_ERROR;
    }

    const right = parseQueryCondition(parser, nextAndOr);
    if (right === PARSE_ERROR) {
      return PARSE_ERROR;
    }

    return {
      type:
        nextAndOr === 'and'
          ? GenericExpressionType.Conjunction
          : GenericExpressionType.Disjunction,
      left,
      right,
    } as GenericExpressionNode;
  }

  return isEOF(parser) ? left : PARSE_ERROR;
}

function parseQueryInParens(
  parser: Parser<Node>
): ParseResult<GenericExpressionNode> {
  const node = parser.consume(1);

  switch (node.type) {
    case Type.BlockNode: {
      if (node.source.type !== Type.LeftParenthesisToken) {
        return PARSE_ERROR;
      }

      const maybeQueryCondition = parseQueryCondition(
        createNodeParser(node.value.value),
        null
      );
      if (maybeQueryCondition !== PARSE_ERROR) {
        return maybeQueryCondition;
      }

      return {type: GenericExpressionType.Literal, value: node};
    }

    case Type.FunctionNode:
      return {type: GenericExpressionType.Literal, value: node};

    default:
      return PARSE_ERROR;
  }
}

export function consumeMediaCondition(
  parser: Parser<Node>
): ParseResult<GenericExpressionNode> {
  return parseQueryCondition(parser, null);
}

export function consumeMediaConditionInParens(
  parser: Parser<Node>
): ParseResult<GenericExpressionNode> {
  return parseQueryInParens(parser);
}

export function parseMediaCondition(
  nodes: ReadonlyArray<Node>
): ParseResult<GenericExpressionNode> {
  return consumeMediaCondition(createNodeParser(nodes));
}

export function transformMediaConditionToTokens(
  node: GenericExpressionNode
): Node[] {
  switch (node.type) {
    case GenericExpressionType.Negate:
      return [
        ident('not'),
        ws(),
        ...transformMediaConditionToTokens(node.value),
      ];

    case GenericExpressionType.Conjunction:
    case GenericExpressionType.Disjunction:
      return [
        ...transformMediaConditionToTokens(node.left),
        ws(),
        ident(node.type === GenericExpressionType.Conjunction ? 'and' : 'or'),
        ws(),
        ...transformMediaConditionToTokens(node.right),
      ];

    case GenericExpressionType.Literal:
      return [node.value];
  }
}
