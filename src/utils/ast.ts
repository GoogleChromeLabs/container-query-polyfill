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

import {DeclarationNode, Node, Type} from './css';

export function ws(): Node {
  return {type: Type.WhitespaceToken};
}

export function delim(value: string): Node {
  return {type: Type.DelimToken, value};
}

export function decl(name: string, value: Node[]): DeclarationNode {
  return {
    type: Type.DeclarationNode,
    name,
    value,
    important: false,
  };
}

export function ident(value: string): Node {
  return {type: Type.IdentToken, value};
}

export function func(name: string, value: Node[]): Node {
  return {type: Type.FunctionNode, name, value};
}

export function customVar(name: string) {
  return func('var', [ident(name)]);
}
