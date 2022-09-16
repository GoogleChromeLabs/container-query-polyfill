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

export class Reference<T> {
  value: T;

  constructor(value: T) {
    this.value = value;
  }
}

export type MemoizableValue =
  | number
  | string
  | boolean
  | symbol
  | null
  | Reference<unknown>
  | MemoizableValue[]
  | {[key: number | string | symbol]: MemoizableValue};

export function memoizeAndReuse<
  TArgs extends MemoizableValue[],
  TResult extends MemoizableValue
>(fn: (...args: TArgs) => TResult) {
  type Result = [TArgs, TResult];
  let previousResult: Result | null = null;

  return (...args: TArgs) => {
    if (previousResult == null || !areEqual(previousResult[0], args)) {
      const currentResult = fn(...args);
      if (
        previousResult == null ||
        !areEqual(previousResult[1], currentResult)
      ) {
        previousResult = [args, currentResult];
      }
    }
    return previousResult[1];
  };
}

function areEqual(lhs: MemoizableValue, rhs: MemoizableValue) {
  if (lhs === rhs) {
    return true;
  }

  if (typeof lhs === typeof rhs) {
    if (lhs !== null && rhs !== null && typeof lhs === 'object') {
      if (Array.isArray(lhs)) {
        if (!Array.isArray(rhs) || rhs.length !== lhs.length) {
          return false;
        }

        for (let i = 0, length = lhs.length; i < length; i++) {
          if (!areEqual(lhs[i], rhs[i])) {
            return false;
          }
        }

        return true;
      } else if (lhs instanceof Reference) {
        if (!(rhs instanceof Reference) || lhs.value !== rhs.value) {
          return false;
        }
        return true;
      } else {
        const leftKeys = Object.keys(lhs);
        if (leftKeys.length !== Object.keys(rhs).length) {
          return false;
        }

        for (let i = 0, length = leftKeys.length; i < length; i++) {
          const key = leftKeys[i];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (!areEqual(lhs[key], (rhs as any)[key])) {
            return false;
          }
        }

        return true;
      }
    }
  }

  return false;
}
