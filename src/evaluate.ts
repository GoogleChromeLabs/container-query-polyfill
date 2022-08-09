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

import {ContainerRule} from './parser.js';
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

export const enum ContainerType {
  None = 0,
  InlineSize = 1 << 0,
  BlockSize = 1 << 1,
}

export interface SizeFeatures {
  width?: number;
  height?: number;
  blockSize?: number;
  inlineSize?: number;
}

export const enum WritingAxis {
  Horizontal = 0,
  Vertical,
}

export interface TreeContext {
  cqw: number | null;
  cqh: number | null;
  fontSize: number;
  rootFontSize: number;
  writingAxis: WritingAxis;
}

interface QueryContext {
  sizeFeatures: Map<SizeFeature, Value>;
  treeContext: TreeContext;
}

function precomputeFeatureValue(
  feature: SizeFeature,
  sizeFeatures: SizeFeatures
): Value {
  const width = sizeFeatures.width;
  const height = sizeFeatures.height;
  const inlineSize = sizeFeatures.inlineSize;
  const blockSize = sizeFeatures.blockSize;

  switch (feature) {
    case SizeFeature.Width:
      return width != null
        ? {type: ValueType.Dimension, value: width, unit: 'px'}
        : {type: ValueType.Unknown};

    case SizeFeature.InlineSize:
      return inlineSize != null
        ? {type: ValueType.Dimension, value: inlineSize, unit: 'px'}
        : {type: ValueType.Unknown};

    case SizeFeature.Height:
      return height != null
        ? {type: ValueType.Dimension, value: height, unit: 'px'}
        : {type: ValueType.Unknown};

    case SizeFeature.BlockSize:
      return blockSize != null
        ? {type: ValueType.Dimension, value: blockSize, unit: 'px'}
        : {type: ValueType.Unknown};

    case SizeFeature.AspectRatio:
      return width != null && height != null && height > 0
        ? {
            type: ValueType.Number,
            value: width / height,
          }
        : {type: ValueType.Unknown};

    case SizeFeature.Orientation:
      return width != null && height != null
        ? {
            type: ValueType.Orientation,
            value: height >= width ? 'portrait' : 'landscape',
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

    case ExpressionType.Feature: {
      const value = context.sizeFeatures.get(node.feature);
      return value == null ? {type: ValueType.Unknown} : value;
    }

    case ExpressionType.Value:
      return node.value;
  }
}

function toBooleanValue(value: boolean): Value {
  return {type: ValueType.Boolean, value};
}

function compareNumericValueInternal(
  lhs: number,
  rhs: number,
  operator: ComparisonOperator
) {
  switch (operator) {
    case ComparisonOperator.EQUAL:
      return lhs === rhs;

    case ComparisonOperator.GREATER_THAN:
      return lhs > rhs;

    case ComparisonOperator.GREATER_THAN_EQUAL:
      return lhs >= rhs;

    case ComparisonOperator.LESS_THAN:
      return lhs < rhs;

    case ComparisonOperator.LESS_THAN_EQUAL:
      return lhs <= rhs;
  }
}

function compareNumericValue(
  lhs: number,
  rhs: number,
  operator: ComparisonOperator
): Value {
  return toBooleanValue(compareNumericValueInternal(lhs, rhs, operator));
}

function transformNullableNumbers(
  lhs: number | null,
  rhs: number | null,
  transform: (lhs: number, rhs: number) => number
): number | null {
  if (lhs == null) {
    return rhs;
  } else if (rhs == null) {
    return lhs;
  } else {
    return transform(lhs, rhs);
  }
}

function getContainerRelativeLengthScale(
  unit: 'cqw' | 'cqh' | 'cqi' | 'cqb' | 'cqmin' | 'cqmax',
  treeContext: TreeContext
): number | null {
  switch (unit) {
    case 'cqw':
      return treeContext.cqw;

    case 'cqh':
      return treeContext.cqh;

    case 'cqi':
      return treeContext.writingAxis === WritingAxis.Horizontal
        ? treeContext.cqw
        : treeContext.cqh;

    case 'cqb':
      return treeContext.writingAxis === WritingAxis.Vertical
        ? treeContext.cqw
        : treeContext.cqh;

    case 'cqmin':
      return transformNullableNumbers(
        getContainerRelativeLengthScale('cqi', treeContext),
        getContainerRelativeLengthScale('cqb', treeContext),
        Math.min
      );

    case 'cqmax':
      return transformNullableNumbers(
        getContainerRelativeLengthScale('cqi', treeContext),
        getContainerRelativeLengthScale('cqb', treeContext),
        Math.max
      );
  }
}

function evaluateDimensionToPixels(
  dimension: DimensionValue,
  {treeContext}: QueryContext
): number | null {
  switch (dimension.unit) {
    case 'px':
      return dimension.value;

    case 'rem':
      return dimension.value * treeContext.rootFontSize;

    case 'em':
      return dimension.value * treeContext.fontSize;

    case 'cqw':
    case 'cqh':
    case 'cqi':
    case 'cqb':
    case 'cqmin':
    case 'cqmax':
      return transformNullableNumbers(
        dimension.value,
        getContainerRelativeLengthScale(dimension.unit, treeContext),
        (lhs, rhs) => lhs * rhs
      );
  }
  return null;
}

function coerceToPixelDimension(
  value: Value,
  context: QueryContext
): number | null {
  switch (value.type) {
    case ValueType.Number:
      // https://drafts.csswg.org/css-values-4/#lengths
      return value.value === 0 ? 0 : null;

    case ValueType.Dimension:
      return evaluateDimensionToPixels(value, context);
  }
  return null;
}

function compareValues<T, C extends {value: T}>(
  lhs: C,
  rhs: C,
  operator: ComparisonOperator
): Value {
  return operator === ComparisonOperator.EQUAL
    ? toBooleanValue(lhs.value === rhs.value)
    : {type: ValueType.Unknown};
}

function evaluateComparisonExpression(
  node: ComparisonExpressionNode,
  context: QueryContext
): Value {
  const left = evaluateExpressionToValue(node.left, context);
  const right = evaluateExpressionToValue(node.right, context);
  const operator = node.operator;

  if (
    (left.type === ValueType.Orientation &&
      right.type === ValueType.Orientation) ||
    (left.type === ValueType.Boolean && right.type === ValueType.Boolean)
  ) {
    return compareValues(left, right, operator);
  } else if (
    left.type === ValueType.Dimension ||
    right.type === ValueType.Dimension
  ) {
    const lhs = coerceToPixelDimension(left, context);
    const rhs = coerceToPixelDimension(right, context);

    if (lhs != null && rhs != null) {
      return compareNumericValue(lhs, rhs, operator);
    }
  } else if (
    left.type === ValueType.Number &&
    right.type === ValueType.Number
  ) {
    return compareNumericValue(left.value, right.value, operator);
  }

  return {type: ValueType.Unknown};
}

function evaluateConjunctionExpression(
  node: ConjunctionExpressionNode,
  context: QueryContext
): Value {
  const left = evaluateExpressionToBoolean(node.left, context);
  return !(left.type === ValueType.Boolean && left.value === true)
    ? left
    : evaluateExpressionToBoolean(node.right, context);
}

function evaluateDisjunctionExpression(
  node: DisjunctionExpressionNode,
  context: QueryContext
): Value {
  const left = evaluateExpressionToBoolean(node.left, context);
  return left.type === ValueType.Boolean && left.value === true
    ? left
    : evaluateExpressionToBoolean(node.right, context);
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

    case ExpressionType.Feature:
      return evaluateValueToBoolean(evaluateExpressionToValue(node, context));

    case ExpressionType.Value:
      return evaluateValueToBoolean(node.value);
  }
}

function evaluateValueToBoolean(value: Value): Value {
  switch (value.type) {
    case ValueType.Boolean:
      return value;

    case ValueType.Number:
    case ValueType.Dimension:
      return {type: ValueType.Boolean, value: value.value > 0};
  }
  return {type: ValueType.Unknown};
}

export function evaluateContainerCondition(
  rule: ContainerRule,
  context: {
    sizeFeatures: SizeFeatures;
    treeContext: TreeContext;
  }
): boolean | null {
  const sizeFeatures = new Map<SizeFeature, Value>();
  const sizeFeatureValues = context.sizeFeatures;

  for (const feature of rule.features) {
    const value = precomputeFeatureValue(feature, sizeFeatureValues);
    if (value.type === ValueType.Unknown) {
      return null;
    }
    sizeFeatures.set(feature, value);
  }

  const result = evaluateExpressionToBoolean(rule.condition, {
    sizeFeatures,
    treeContext: context.treeContext,
  });
  return result.type === ValueType.Boolean ? result.value : null;
}
