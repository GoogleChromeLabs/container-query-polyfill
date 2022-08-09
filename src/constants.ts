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

export const PER_RUN_UID = Array.from({length: 4}, () =>
  Math.floor(Math.random() * 256).toString(16)
).join('');

export const INTERNAL_KEYWORD_PREFIX = 'cq-';
export const CUSTOM_PROPERTY_SHORTHAND = getCustomVariableName('container');
export const CUSTOM_PROPERTY_TYPE = getCustomVariableName('container-type');
export const CUSTOM_PROPERTY_NAME = getCustomVariableName('container-name');

export const DATA_ATTRIBUTE_SELF = `data-cqs-${PER_RUN_UID}`;
export const DATA_ATTRIBUTE_CHILD = `data-cqc-${PER_RUN_UID}`;

export const CUSTOM_UNIT_VARIABLE_CQW = getCustomVariableName('cqw');
export const CUSTOM_UNIT_VARIABLE_CQH = getCustomVariableName('cqh');
export const CUSTOM_UNIT_VARIABLE_CQI = getCustomVariableName('cqi');
export const CUSTOM_UNIT_VARIABLE_CQB = getCustomVariableName('cqb');

function getCustomVariableName(name: string): string {
  return `--cq-${name}-${PER_RUN_UID}`;
}
