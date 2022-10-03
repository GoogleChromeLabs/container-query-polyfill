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

import {readFile, writeFile} from 'fs/promises';
import {dirname, join} from 'path';
import {fileURLToPath} from 'url';
import {
  BrowserDefinition,
  DataType,
  TestDescriptor,
  TestResultData,
} from './wpt';

interface TestMap {
  [key: string]: SubtestMap | undefined;
}

interface SubtestMap {
  [key: string]: BrowserResults | undefined;
}

interface BrowserMap {
  [name: string]: BrowserVersionMap;
}

interface BrowserVersionMap {
  [version: string]: TestResultData;
}

interface BrowserResults {
  passing: BrowserVersion[];
  failing: BrowserVersion[];
}

type BrowserVersion = [string, string];

function getTargetForDescriptor(
  testMap: TestMap,
  descriptor: TestDescriptor,
  createIfNeeded: boolean
) {
  const testToSubtest = (testMap[descriptor.test] =
    testMap[descriptor.test] || {});
  const subtestToTarget = (testToSubtest[descriptor.subtest] =
    testToSubtest[descriptor.subtest] ||
    (createIfNeeded ? {passing: [], failing: []} : undefined));

  testMap[descriptor.test] = testToSubtest;
  testToSubtest[descriptor.subtest] = subtestToTarget;

  return subtestToTarget;
}

function getPathForFile(filename: string) {
  return join(dirname(fileURLToPath(import.meta.url)), filename);
}

async function loadJSON<T>(filename: string): Promise<T> {
  return JSON.parse(
    (await readFile(getPathForFile(filename))).toString('utf-8')
  ) as T;
}

function createBrowserMapFromTestMap(testMap: TestMap) {
  const browserMap: BrowserMap = {};
  function addResult(
    test: TestDescriptor,
    browser: BrowserVersion,
    passing: boolean
  ) {
    const [name, version] = browser;
    const versionMap = (browserMap[name] = browserMap[name] || {});
    const results = (versionMap[version] = versionMap[version] || [[], []]);

    if (passing) {
      results[0].push(test);
    } else {
      results[1].push(test);
    }
  }

  for (const testName in testMap) {
    const test = testMap[testName];
    for (const subtestName in test) {
      const subtest = test[subtestName];
      if (!subtest) {
        continue;
      }

      const descriptor = {test: testName, subtest: subtestName};
      for (const browser of subtest.passing) {
        addResult(descriptor, browser, true);
      }

      for (const browser of subtest.failing) {
        addResult(descriptor, browser, false);
      }
    }
  }

  return browserMap;
}

function createBrowserMapFromResults(results: BrowserDefinition[]): BrowserMap {
  const browserMap: BrowserMap = {};
  for (const browserDefinition of results) {
    const browser: BrowserVersionMap = {};
    browserMap[browserDefinition.name] = browser;

    for (const versionDefinition of browserDefinition.versions) {
      if (versionDefinition.data.type === DataType.Result) {
        browser[versionDefinition.name] = versionDefinition.data.result;
      }
    }
  }
  return browserMap;
}

function createTestMapFromBrowserMap(browserMap: BrowserMap): TestMap {
  const testMap: TestMap = {};
  for (const browser in browserMap) {
    for (const version in browserMap[browser]) {
      const [passed, failed] = browserMap[browser][version];

      for (const result of passed) {
        const target = getTargetForDescriptor(testMap, result, true);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        target!.passing.push([browser, version]);
      }

      for (const result of failed) {
        const target = getTargetForDescriptor(testMap, result, true);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        target!.failing.push([browser, version]);
      }
    }
  }

  return testMap;
}

function getBrowserName(browser: string, version: string) {
  return `${browser} ${version}`;
}

function mergeBrowserMaps(lhs: BrowserMap, rhs: BrowserMap): Set<string> {
  const missingBrowsers: Set<string> = new Set();
  for (const browserName in lhs) {
    const rightBrowser = rhs[browserName] || {};
    rhs[browserName] = rightBrowser;

    for (const versionName in lhs[browserName]) {
      const rightData = rhs[browserName][versionName];
      const leftData = lhs[browserName][versionName];

      if (!rightData && leftData) {
        rhs[browserName][versionName] = leftData;
        missingBrowsers.add(getBrowserName(browserName, versionName));
      }
    }
  }

  return missingBrowsers;
}

const previousTestMap = await loadJSON<TestMap>('baseline.json');
const previousResults = createBrowserMapFromTestMap(previousTestMap);

const currentResults = createBrowserMapFromResults(
  await loadJSON('results.json')
);
const missingBrowsers = mergeBrowserMaps(previousResults, currentResults);
const currentTestMap = createTestMapFromBrowserMap(currentResults);

const allTestNames = new Set(
  [...Object.keys(previousTestMap), ...Object.keys(currentTestMap)].sort()
);
const summaryLines: string[] = [];

let hasRegressions = false;
for (const test of allTestNames) {
  const currentSubtests = currentTestMap[test];
  const previousSubtests = previousTestMap[test];
  const allSubtestNames = new Set(
    [
      ...(currentSubtests ? Object.keys(currentSubtests) : []),
      ...(previousSubtests ? Object.keys(previousSubtests) : []),
    ].sort()
  );
  const testSummary: string[] = [];

  if (!currentSubtests) {
    summaryLines.push('This test was removed.');
  } else {
    const subtestSummary: string[] = [];

    for (const subtest of allSubtestNames) {
      const descriptor = {test, subtest};
      const before = getTargetForDescriptor(previousTestMap, descriptor, false);
      const after = getTargetForDescriptor(currentTestMap, descriptor, false);

      const passingBefore = new Set(
        (before?.passing || []).map(browser =>
          getBrowserName(browser[0], browser[1])
        )
      );
      const passingAfter = new Set(
        (after?.passing || []).map(browser =>
          getBrowserName(browser[0], browser[1])
        )
      );
      const allBrowsers = new Set(
        [...passingBefore.keys(), ...passingAfter.keys()].sort()
      );
      let summary: string | null = null;

      if (!after) {
        summary = '(removed)';
      } else {
        const diffLines: string[] = [];
        for (const browser of allBrowsers) {
          const isPassing = passingAfter.has(browser);
          const wasPassing = passingBefore.has(browser);

          if (isPassing === wasPassing) {
            continue;
          }

          if (wasPassing && !isPassing) {
            hasRegressions = true;
          }

          const prefix = isPassing ? '+' : '-';
          diffLines.push(`${prefix} ${browser}`);
        }

        if (diffLines.length > 0) {
          summary = `
\`\`\`diff
${diffLines.join('\n')}
\`\`\`
                `;
        }
      }

      if (summary) {
        subtestSummary.push(`
<tr>
<td><pre>${subtest}</pre></td>
<td>

${summary}

</td>
</tr>
            `);
      }
    }

    if (subtestSummary.length > 0) {
      testSummary.push(`
${subtestSummary.join('\n')}
        `);
    }
  }

  if (testSummary.length > 0) {
    summaryLines.push(`
<table>
<tr>
<th colspan=3>${test}</th>
</tr>

${testSummary.join('\n')}
</table>
    `);
  }
}

const commentLines: string[] = [];
let changed = hasRegressions;

if (process.env.SCHEDULED_BASELINE_DIFF) {
  changed = changed || summaryLines.length > 0;
  commentLines.push(
    'The [Web Platform Test](https://web-platform-tests.org/) results have changed from the expected baseline. You may accept these changes by merging this pull request.'
  );
}

if (missingBrowsers.size > 0) {
  if (!process.env.SCHEDULED_BASELINE_DIFF) {
    changed = true;
  }
  commentLines.push(
    '',
    `
> **Warning**
> The test run was missing data for the following browsers:
>
${Array.from(missingBrowsers)
  .map(browser => `>   * ${browser}`)
  .join('\n')}
>
> The test results for these browsers couldn't be confirmed.
    `
  );
}

const results =
  summaryLines.length > 0 ? summaryLines : ['No changes detected.'];
commentLines.push('', '# Test Results', ...results);

await writeFile(getPathForFile('pr.txt'), commentLines.join('\n'));
await writeFile(
  getPathForFile('baseline.json'),
  JSON.stringify(currentTestMap)
);

process.stdout.write(changed ? 'changed' : 'unchanged');
