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

import {ComparisonOperator} from './utils/parse-media-feature.js';

export const enum ExpressionType {
  Negate = 1,
  Conjunction,
  Disjunction,
  Comparison,
  Feature,
  Value,
}

export type ExpressionNode =
  | NegateExpressionNode
  | ConjunctionExpressionNode
  | DisjunctionExpressionNode
  | ComparisonExpressionNode
  | FeatureExpressionNode
  | ValueExpressionNode;

export interface NegateExpressionNode {
  type: ExpressionType.Negate;
  value: ExpressionNode;
}

export interface ConjunctionExpressionNode {
  type: ExpressionType.Conjunction;
  left: ExpressionNode;
  right: ExpressionNode;
}

export interface DisjunctionExpressionNode {
  type: ExpressionType.Disjunction;
  left: ExpressionNode;
  right: ExpressionNode;
}

export interface ComparisonExpressionNode {
  type: ExpressionType.Comparison;
  operator: ComparisonOperator;
  left: ExpressionNode;
  right: ExpressionNode;
}

export interface FeatureExpressionNode {
  type: ExpressionType.Feature;
  feature: SizeFeature;
}

export interface ValueExpressionNode {
  type: ExpressionType.Value;
  value: Value;
}

export const enum ValueType {
  Unknown = 1,
  Number,
  Dimension,
  Orientation,
  Boolean,
}

export type Value =
  | UnknownValue
  | NumberValue
  | DimensionValue
  | OrientationValue
  | BooleanValue;

export interface UnknownValue {
  type: ValueType.Unknown;
}

export interface NumberValue {
  type: ValueType.Number;
  value: number;
}

export interface DimensionValue {
  type: ValueType.Dimension;
  value: number;
  unit: string;
}

export interface OrientationValue {
  type: ValueType.Orientation;
  value: 'portrait' | 'landscape';
}

export interface BooleanValue {
  type: ValueType.Boolean;
  value: boolean;
}

export const enum SizeFeature {
  Width = 1,
  Height,
  InlineSize,
  BlockSize,
  AspectRatio,
  Orientation,
}

export const enum WritingMode {
  Horizontal = 1,
  Vertical,
}

export const enum ContainerType {
  Size = 1,
  InlineSize,
}

export interface QueryContext {
  type: ContainerType;
  inlineSize: number;
  blockSize: number;
  fontSize: number;
  rootFontSize: number;
  writingMode: WritingMode;
}

function evaluateFeatureValue(
  feature: SizeFeature,
  context: QueryContext
): Value {
  const inlineSize = context.inlineSize;
  const blockSize =
    context.type === ContainerType.Size ? context.blockSize : null;

  const width =
    context.writingMode === WritingMode.Horizontal ? inlineSize : blockSize;
  const height =
    context.writingMode === WritingMode.Horizontal ? blockSize : inlineSize;

  switch (feature) {
    case SizeFeature.Width:
      return width !== null
        ? {type: ValueType.Dimension, value: width, unit: 'px'}
        : {type: ValueType.Unknown};

    case SizeFeature.InlineSize:
      return {type: ValueType.Dimension, value: inlineSize, unit: 'px'};

    case SizeFeature.Height:
      return height !== null
        ? {type: ValueType.Dimension, value: height, unit: 'px'}
        : {type: ValueType.Unknown};

    case SizeFeature.BlockSize:
      return blockSize !== null
        ? {type: ValueType.Dimension, value: blockSize, unit: 'px'}
        : {type: ValueType.Unknown};

    case SizeFeature.AspectRatio:
      return blockSize !== null
        ? {
            type: ValueType.Number,
            value: inlineSize / blockSize,
          }
        : {type: ValueType.Unknown};

    case SizeFeature.Orientation:
      return blockSize !== null
        ? {
            type: ValueType.Orientation,
            value: blockSize >= inlineSize ? 'portrait' : 'landscape',
          }
        : {type: ValueType.Unknown};
  }
}

function evaluateExpressionToValue(
  node: ExpressionNode,
  context: QueryContext
): Value {
  switch (node.type) {
    case ExpressionType.Negate:
    case ExpressionType.Conjunction:
    case ExpressionType.Disjunction:
    case ExpressionType.Comparison:
      return evaluateExpressionToBoolean(node, context);

    case ExpressionType.Feature:
      return evaluateFeatureValue(node.feature, context);

    case ExpressionType.Value:
      // TODO: Correctly evaluate e.g. Dimension values
      return node.value;
  }
}

function compareNumericValue(
  lhs: number,
  rhs: number,
  operator: ComparisonOperator
): Value {
  switch (operator) {
    case ComparisonOperator.EQUAL:
      return {type: ValueType.Boolean, value: lhs === rhs};

    case ComparisonOperator.GREATER_THAN:
      return {type: ValueType.Boolean, value: lhs > rhs};

    case ComparisonOperator.GREATER_THAN_EQUAL:
      return {type: ValueType.Boolean, value: lhs >= rhs};

    case ComparisonOperator.LESS_THAN:
      return {type: ValueType.Boolean, value: lhs < rhs};

    case ComparisonOperator.LESS_THAN_EQUAL:
      return {type: ValueType.Boolean, value: lhs <= rhs};
  }
}

function evaluateDimensionToPixels(
  dimension: DimensionValue,
  context: QueryContext
): number | null {
  switch (dimension.unit) {
    case 'px':
      return dimension.value;

    case 'rem':
      return dimension.value * context.rootFontSize;

    case 'em':
      return dimension.value * context.fontSize;

    default:
      return null;
  }
}

function compareDimensions(
  lhs: DimensionValue,
  rhs: DimensionValue,
  operator: ComparisonOperator,
  context: QueryContext
): Value {
  const left = evaluateDimensionToPixels(lhs, context);
  const right = evaluateDimensionToPixels(rhs, context);

  return left === null || right === null
    ? {type: ValueType.Unknown}
    : compareNumericValue(left, right, operator);
}

function compareOrientations(
  lhs: OrientationValue,
  rhs: OrientationValue,
  operator: ComparisonOperator
): Value {
  return operator === ComparisonOperator.EQUAL
    ? {type: ValueType.Boolean, value: lhs.value === rhs.value}
    : {type: ValueType.Unknown};
}

function compareBooleans(
  lhs: BooleanValue,
  rhs: BooleanValue,
  operator: ComparisonOperator
): Value {
  return operator === ComparisonOperator.EQUAL
    ? {type: ValueType.Boolean, value: lhs.value === rhs.value}
    : {type: ValueType.Unknown};
}

function evaluateComparisonExpression(
  node: ComparisonExpressionNode,
  context: QueryContext
): Value {
  const left = evaluateExpressionToValue(node.left, context);
  const right = evaluateExpressionToValue(node.right, context);

  const type = right.type;
  if (
    left.type === ValueType.Unknown ||
    type === ValueType.Unknown ||
    left.type !== type
  ) {
    return {type: ValueType.Unknown};
  }

  const operator = node.operator;
  switch (type) {
    case ValueType.Number:
      return compareNumericValue(
        (left as NumberValue).value,
        right.value,
        operator
      );

    case ValueType.Dimension:
      return compareDimensions(
        left as DimensionValue,
        right,
        operator,
        context
      );

    case ValueType.Orientation:
      return compareOrientations(left as OrientationValue, right, operator);

    case ValueType.Boolean:
      return compareBooleans(left as BooleanValue, right, operator);
  }
}

function evaluateConjunctionExpression(
  node: ConjunctionExpressionNode,
  context: QueryContext
): Value {
  const left = evaluateExpressionToBoolean(node.left, context);
  const right = evaluateExpressionToBoolean(node.right, context);

  const leftValue = left.type === ValueType.Boolean ? left.value : null;
  const rightValue = right.type === ValueType.Boolean ? right.value : null;

  return leftValue === null && rightValue === null
    ? {type: ValueType.Unknown}
    : {
        type: ValueType.Boolean,
        value: leftValue === true && rightValue === true,
      };
}

function evaluateDisjunctionExpression(
  node: DisjunctionExpressionNode,
  context: QueryContext
): Value {
  const left = evaluateExpressionToBoolean(node.left, context);
  const right = evaluateExpressionToBoolean(node.right, context);

  const leftValue = left.type === ValueType.Boolean ? left.value : null;
  const rightValue = right.type === ValueType.Boolean ? right.value : null;

  return leftValue === null && rightValue === null
    ? {type: ValueType.Unknown}
    : {
        type: ValueType.Boolean,
        value: leftValue === true || rightValue === true,
      };
}

function evaluateExpressionToBoolean(
  node: ExpressionNode,
  context: QueryContext
): Value {
  switch (node.type) {
    case ExpressionType.Comparison:
      return evaluateComparisonExpression(node, context);

    case ExpressionType.Conjunction:
      return evaluateConjunctionExpression(node, context);

    case ExpressionType.Disjunction:
      return evaluateDisjunctionExpression(node, context);

    case ExpressionType.Negate: {
      const result = evaluateExpressionToBoolean(node.value, context);
      return result.type === ValueType.Boolean
        ? {type: ValueType.Boolean, value: !result.value}
        : {type: ValueType.Unknown};
    }

    case ExpressionType.Feature: {
      const result = evaluateExpressionToValue(node, context);
      return result.type !== ValueType.Unknown
        ? {type: ValueType.Boolean, value: true}
        : {type: ValueType.Unknown};
    }

    case ExpressionType.Value:
      return {type: ValueType.Unknown};
  }
}

export function evaluateContainerCondition(
  condition: ExpressionNode,
  context: QueryContext
): boolean {
  const result = evaluateExpressionToBoolean(condition, context);
  return result.type === ValueType.Boolean && result.value === true;
}
