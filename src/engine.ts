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
  evaluateContainerCondition,
  ContainerType,
  TreeContext,
  WritingAxis,
} from './evaluate.js';
import {
  CUSTOM_PROPERTY_NAME,
  CUSTOM_PROPERTY_TYPE,
  CUSTOM_UNIT_VARIABLE_CQB,
  CUSTOM_UNIT_VARIABLE_CQH,
  CUSTOM_UNIT_VARIABLE_CQI,
  CUSTOM_UNIT_VARIABLE_CQW,
  DATA_ATTRIBUTE_CHILD,
  DATA_ATTRIBUTE_SELF,
  INTERNAL_KEYWORD_PREFIX,
  PER_RUN_UID,
} from './constants.js';
import {ContainerQueryDescriptor, transpileStyleSheet} from './transform.js';
import {isContainerStandaloneKeyword} from './parser.js';
import {memoizeAndReuse, Reference} from './memo.js';

interface PhysicalSize {
  width: number;
  height: number;
}

const enum QueryContainerFlags {
  None = 0,

  /**
   * Whether the container's condition evaluated to true.
   */
  Condition = 1 << 0,

  /**
   * Whether the container's rules should be applied.
   *
   * Note: this is subtly different from `condition`, as it
   * takes into account any parent containers and conditions too.
   */
  Container = 1 << 1,
}

const enum DisplayFlags {
  // On if the `display` property is anything but `none`
  Enabled = 1 << 0,

  // On if the `display` property is valid for size containment.
  // https://drafts.csswg.org/css-contain-2/#containment-size
  EligibleForSizeContainment = 1 << 1,
}

type ContainerConditionEntry = [
  Reference<ContainerQueryDescriptor>,
  QueryContainerFlags
];

type LayoutState = {
  parentState: Reference<LayoutState> | null;
  conditions: ContainerConditionEntry[];
  context: TreeContext;
  displayFlags: DisplayFlags;
  isQueryContainer: boolean;
};

const INSTANCE_SYMBOL: unique symbol = Symbol('CQ_INSTANCE');
const STYLESHEET_SYMBOL: unique symbol = Symbol('CQ_STYLESHEET');
const SUPPORTS_SMALL_VIEWPORT_UNITS = CSS.supports('width: 1svh');
const VERTICAL_WRITING_MODES = new Set([
  'vertical-lr',
  'vertical-rl',
  'sideways-rl',
  'sideways-lr',
  'tb',
  'tb-lr',
  'tb-rl',
]);

const WIDTH_BORDER_BOX_PROPERTIES: string[] = [
  'padding-left',
  'padding-right',
  'border-left-width',
  'border-right-width',
];

const HEIGHT_BORDER_BOX_PROPERTIES: string[] = [
  'padding-top',
  'padding-bottom',
  'border-top-width',
  'border-bottom-width',
];

/**
 * For matching:
 *
 * display: [ table | ruby ]
 * display: [ block | inline | ... ] [ table | ruby ]
 * display: table-[ row | cell | ... ]
 * display: ruby-[ base | text | ... ]
 * display: inline-table
 *
 * https://drafts.csswg.org/css-display-3/#the-display-properties
 */
const TABLE_OR_RUBY_DISPLAY_TYPE = /(\w*(\s|-))?(table|ruby)(-\w*)?/;

if (IS_WPT_BUILD) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).CQ_SYMBOL = INSTANCE_SYMBOL;
}

interface ViewportChangeContext {
  viewportChanged(size: PhysicalSize): void;
}

interface StyleSheetContext {
  registerStyleSheet(options: {
    source: string;
    url?: URL;
    signal?: AbortSignal;
  }): Promise<StyleSheetInstance>;
}

interface StyleSheetInstance {
  source: string;
  dispose(): void;
  refresh(): void;
}

interface ElementLayoutData {
  containerType: ContainerType;
  containerNames: Set<string>;
  writingAxis: WritingAxis;
  displayFlags: DisplayFlags;
}

interface ElementSizeData {
  width: number;
  height: number;
  fontSize: number;
}

interface LayoutStateProvider {
  (parentState: LayoutState): LayoutState;
}

export function initializePolyfill(updateCallback: () => void) {
  interface Instance {
    connect(): void;
    disconnect(): void;
    update(parentState: LayoutState): void;
    resize(): void;
    mutate(): void;
  }

  function getInstance(node: Node): Instance | null {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const controller = (node as any)[INSTANCE_SYMBOL];
    return controller ? controller : null;
  }

  const documentElement = document.documentElement;
  if (getInstance(documentElement)) {
    return;
  }

  const dummyElement = document.createElement(`cq-polyfill-${PER_RUN_UID}`);
  const globalStyleElement = document.createElement('style');
  const mutationObserver = new MutationObserver(mutations => {
    for (const entry of mutations) {
      for (const node of entry.removedNodes) {
        const instance = getInstance(node);
        // Note: We'll recurse into the nodes inside disconnect.
        instance?.disconnect();
      }

      if (
        entry.target.nodeType !== Node.DOCUMENT_NODE &&
        entry.target.nodeType !== Node.DOCUMENT_FRAGMENT_NODE &&
        entry.target.parentNode === null
      ) {
        continue;
      }
      if (
        entry.type === 'attributes' &&
        entry.attributeName &&
        (entry.attributeName === DATA_ATTRIBUTE_SELF ||
          entry.attributeName === DATA_ATTRIBUTE_CHILD ||
          (entry.target instanceof Element &&
            entry.target.getAttribute(entry.attributeName) === entry.oldValue))
      ) {
        continue;
      }

      // Note: We'll recurse into the nodes inside mutate.
      getOrCreateInstance(entry.target).mutate();
      scheduleUpdate();
    }
  });
  mutationObserver.observe(documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeOldValue: true,
  });

  const resizeObserver = new ResizeObserver(entries => {
    for (const entry of entries) {
      const instance = getOrCreateInstance(entry.target);
      instance.resize();
    }
    getOrCreateInstance(documentElement).update(computeRootState());
    updateCallback();
  });

  const rootController = new NodeController(documentElement);
  async function registerStyleSheet(
    node: HTMLStyleElement | HTMLLinkElement,
    {
      source,
      url,
      signal,
    }: {
      source: string;
      url?: URL;
      signal?: AbortSignal;
    }
  ) {
    const result = transpileStyleSheet(
      source,
      url ? url.toString() : undefined
    );
    let dispose = () => {
      /* noop */
    };
    let refresh = () => {
      /* noop */
    };

    const documentInstance = getOrCreateInstance(documentElement);
    let didSetDescriptors = false;

    if (!signal?.aborted) {
      refresh = () => {
        if (!didSetDescriptors) {
          const {sheet} = node;

          if (sheet != null) {
            setDescriptorsForStyleSheet(sheet, result.descriptors);
            didSetDescriptors = true;

            dispose = () => {
              setDescriptorsForStyleSheet(sheet);
              documentInstance.mutate();
              scheduleUpdate();
            };

            documentInstance.mutate();
            scheduleUpdate();
          }
        }
      };
    }

    return {
      source: result.source,
      dispose,
      refresh,
    };
  }

  const fallbackContainerUnits: {cqw: number | null; cqh: number | null} = {
    cqw: null,
    cqh: null,
  };
  function viewportChanged({width, height}: PhysicalSize) {
    fallbackContainerUnits.cqw = width;
    fallbackContainerUnits.cqh = height;
  }

  function updateAttributes(node: Node, state: LayoutState, attribute: string) {
    if (node instanceof Element && state) {
      let attributes = '';
      for (const [queryRef, result] of state.conditions) {
        const query = queryRef.value;
        if (query.selector != null) {
          const isValidCondition =
            result != null &&
            (result & QueryContainerFlags.Container) ===
              QueryContainerFlags.Container;
          if (isValidCondition && node.matches(query.selector)) {
            if (attributes.length > 0) {
              attributes += ' ';
            }
            attributes += query.uid;
          }
        }
      }

      if (attributes.length > 0) {
        node.setAttribute(attribute, attributes);
      } else {
        node.removeAttribute(attribute);
      }
    }
  }

  function scheduleUpdate() {
    resizeObserver.unobserve(documentElement);
    resizeObserver.observe(documentElement);
  }

  const computeRootConditions = () => {
    const rootQueryDescriptors: ContainerConditionEntry[] = [];
    for (const styleSheet of document.styleSheets) {
      for (const query of getDescriptorsForStyleSheet(styleSheet)) {
        rootQueryDescriptors.push([
          new Reference(query),
          QueryContainerFlags.None,
        ]);
      }
    }
    return rootQueryDescriptors;
  };

  const rootStyles = window.getComputedStyle(documentElement);
  const computeRootState = () => {
    const readProperty = (name: string) => rootStyles.getPropertyValue(name);
    const layoutData = computeLayoutData(readProperty);
    const sizeData = computeSizeData(readProperty);

    return {
      parentState: null,
      conditions: computeRootConditions(),
      context: {
        ...fallbackContainerUnits,
        fontSize: sizeData.fontSize,
        rootFontSize: sizeData.fontSize,
        writingAxis: layoutData.writingAxis,
      },
      displayFlags: layoutData.displayFlags,
      isQueryContainer: false,
    };
  };

  const defaultStateProvider: LayoutStateProvider = parentState => parentState;

  function getOrCreateInstance(node: Node): Instance {
    let instance = getInstance(node);
    if (!instance) {
      let innerController: NodeController<Node>;
      let stateProvider: LayoutStateProvider | null = null;
      let alwaysObserveSize = false;

      if (node === documentElement) {
        innerController = rootController;
        stateProvider = defaultStateProvider;
      } else if (node === dummyElement) {
        alwaysObserveSize = true;
        innerController = new DummyElementController(dummyElement, {
          viewportChanged,
        });
      } else if (node === globalStyleElement) {
        innerController = new GlobalStyleElementController(globalStyleElement);
      } else if (node instanceof HTMLLinkElement) {
        innerController = new LinkElementController(node, {
          registerStyleSheet: options =>
            registerStyleSheet(node, {
              ...options,
            }),
        });
      } else if (node instanceof HTMLStyleElement) {
        innerController = new StyleElementController(node, {
          registerStyleSheet: options =>
            registerStyleSheet(node, {
              ...options,
            }),
        });
      } else {
        innerController = new NodeController(node);
      }

      let cacheKey = Symbol();
      if (stateProvider == null && node instanceof Element) {
        const computeState = createStateComputer(node);
        stateProvider = parentState => computeState(parentState, cacheKey);
      }

      const innerStateProvider = stateProvider
        ? stateProvider
        : defaultStateProvider;

      let previousLayoutState: LayoutState | null = null;
      const maybeComputeState: (
        parentState: LayoutState
      ) => [LayoutState, boolean] = parentState => {
        const currentLayoutState = previousLayoutState;
        const nextLayoutState = innerStateProvider(parentState);

        previousLayoutState = nextLayoutState;
        return [
          previousLayoutState,
          previousLayoutState !== currentLayoutState,
        ];
      };

      const inlineStyles =
        node instanceof HTMLElement || node instanceof SVGElement
          ? node.style
          : null;
      let isObservingSize = false;

      instance = {
        connect() {
          for (
            let child = node.firstChild;
            child != null;
            child = child.nextSibling
          ) {
            // Ensure all children are created and connected first.
            getOrCreateInstance(child);
          }
          innerController.connected();
        },

        disconnect() {
          if (node instanceof Element) {
            resizeObserver.unobserve(node);
            node.removeAttribute(DATA_ATTRIBUTE_SELF);
            node.removeAttribute(DATA_ATTRIBUTE_CHILD);
          }
          if (inlineStyles) {
            inlineStyles.removeProperty(CUSTOM_UNIT_VARIABLE_CQI);
            inlineStyles.removeProperty(CUSTOM_UNIT_VARIABLE_CQB);
            inlineStyles.removeProperty(CUSTOM_UNIT_VARIABLE_CQW);
            inlineStyles.removeProperty(CUSTOM_UNIT_VARIABLE_CQH);
          }
          for (
            let child = node.firstChild;
            child != null;
            child = child.nextSibling
          ) {
            const instance = getInstance(child);
            instance?.disconnect();
          }
          innerController.disconnected();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          delete (node as any)[INSTANCE_SYMBOL];
        },

        update(parentState: LayoutState) {
          const [currentState, stateChanged] = maybeComputeState(parentState);

          if (stateChanged) {
            updateAttributes(node, parentState, DATA_ATTRIBUTE_CHILD);
            updateAttributes(node, currentState, DATA_ATTRIBUTE_SELF);

            if (node instanceof Element) {
              const shouldObserveSize =
                alwaysObserveSize || currentState.isQueryContainer;
              if (shouldObserveSize && !isObservingSize) {
                resizeObserver.observe(node);
                isObservingSize = true;
              } else if (!shouldObserveSize && isObservingSize) {
                resizeObserver.unobserve(node);
                isObservingSize = false;
              }
            }

            if (inlineStyles) {
              const context = currentState.context;
              const writingAxis = context.writingAxis;

              let cqi: string | null = null;
              let cqb: string | null = null;
              let cqw: string | null = null;
              let cqh: string | null = null;

              if (
                writingAxis !== parentState.context.writingAxis ||
                currentState.isQueryContainer
              ) {
                cqi = `var(${
                  writingAxis === WritingAxis.Horizontal
                    ? CUSTOM_UNIT_VARIABLE_CQW
                    : CUSTOM_UNIT_VARIABLE_CQH
                })`;
                cqb = `var(${
                  writingAxis === WritingAxis.Vertical
                    ? CUSTOM_UNIT_VARIABLE_CQW
                    : CUSTOM_UNIT_VARIABLE_CQH
                })`;
              }

              if (!parentState || currentState.isQueryContainer) {
                if (context.cqw) {
                  cqw = context.cqw + 'px';
                }
                if (context.cqh) {
                  cqh = context.cqh + 'px';
                }
              }

              setProperty(inlineStyles, CUSTOM_UNIT_VARIABLE_CQI, cqi);
              setProperty(inlineStyles, CUSTOM_UNIT_VARIABLE_CQB, cqb);
              setProperty(inlineStyles, CUSTOM_UNIT_VARIABLE_CQW, cqw);
              setProperty(inlineStyles, CUSTOM_UNIT_VARIABLE_CQH, cqh);
            }
            innerController.updated();
          }

          for (
            let child = node.firstChild;
            child != null;
            child = child.nextSibling
          ) {
            getOrCreateInstance(child).update(currentState);
          }
        },

        resize() {
          cacheKey = Symbol();
        },

        mutate() {
          cacheKey = Symbol();
          for (
            let child = node.firstChild;
            child != null;
            child = child.nextSibling
          ) {
            getOrCreateInstance(child).mutate();
          }
        },
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (node as any)[INSTANCE_SYMBOL] = instance;
      instance.connect();
    }
    return instance;
  }

  documentElement.prepend(globalStyleElement, dummyElement);
  getOrCreateInstance(documentElement);
  scheduleUpdate();
}

class NodeController<T extends Node> {
  protected node: T;

  constructor(node: T) {
    this.node = node;
  }

  connected() {
    // Handler implemented by subclasses
  }

  disconnected() {
    // Handler implemented by subclasses
  }

  updated() {
    // Handler implemented by subclasses
  }
}

class LinkElementController extends NodeController<HTMLLinkElement> {
  private context: StyleSheetContext;
  private controller: AbortController | null = null;
  private styleSheet: StyleSheetInstance | null = null;

  constructor(node: HTMLLinkElement, context: StyleSheetContext) {
    super(node);
    this.context = context;
  }

  connected(): void {
    const node = this.node;
    if (node.rel === 'stylesheet') {
      const url = new URL(node.href, document.baseURI);
      if (url.origin === location.origin) {
        this.controller = tryAbortableFunction(async signal => {
          const response = await fetch(url.toString(), {signal});
          const source = await response.text();

          const styleSheet = (this.styleSheet =
            await this.context.registerStyleSheet({source, url, signal}));
          const blob = new Blob([styleSheet.source], {
            type: 'text/css',
          });

          /**
           * Even though it's a data URL, it may take several frames
           * before the stylesheet is loaded. Additionally, the `onload`
           * event isn't triggered on elements that have already loaded.
           *
           * Therefore, we use a dummy image to detect the right time
           * to refresh.
           */
          const img = new Image();
          img.onload = img.onerror = styleSheet.refresh;
          img.src = node.href = URL.createObjectURL(blob);
        });
      }
    }
  }

  disconnected(): void {
    this.controller?.abort();
    this.controller = null;

    this.styleSheet?.dispose();
    this.styleSheet = null;
  }
}

class StyleElementController extends NodeController<HTMLStyleElement> {
  private context: StyleSheetContext;
  private controller: AbortController | null = null;
  private styleSheet: StyleSheetInstance | null = null;

  constructor(node: HTMLStyleElement, context: StyleSheetContext) {
    super(node);
    this.context = context;
  }

  connected(): void {
    this.controller = tryAbortableFunction(async signal => {
      const node = this.node;
      const styleSheet = (this.styleSheet =
        await this.context.registerStyleSheet({
          source: node.innerHTML,
          signal,
        }));
      node.innerHTML = styleSheet.source;
      styleSheet.refresh();
    });
  }

  disconnected(): void {
    this.controller?.abort();
    this.controller = null;

    this.styleSheet?.dispose();
    this.styleSheet = null;
  }
}

class GlobalStyleElementController extends NodeController<HTMLStyleElement> {
  connected(): void {
    const style = `* { ${CUSTOM_PROPERTY_TYPE}: cq-normal; ${CUSTOM_PROPERTY_NAME}: cq-none; }`;
    this.node.innerHTML =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      typeof (window as any).CSSLayerBlockRule === 'undefined'
        ? style
        : `@layer cq-polyfill-${PER_RUN_UID} { ${style} }`;
  }
}

class DummyElementController extends NodeController<HTMLElement> {
  private context: ViewportChangeContext;
  private styles: CSSStyleDeclaration;

  constructor(node: HTMLElement, context: ViewportChangeContext) {
    super(node);
    this.context = context;
    this.styles = window.getComputedStyle(node);
  }

  connected(): void {
    this.node.style.cssText =
      'position: fixed; top: 0; left: 0; visibility: hidden; ' +
      (SUPPORTS_SMALL_VIEWPORT_UNITS
        ? 'width: 1svw; height: 1svh;'
        : 'width: 1%; height: 1%;');
  }

  updated(): void {
    const sizeData = computeSizeData(name =>
      this.styles.getPropertyValue(name)
    );
    this.context.viewportChanged({
      width: sizeData.width,
      height: sizeData.height,
    });
  }
}

function tryAbortableFunction(fn: (signal: AbortSignal) => Promise<void>) {
  const controller = new AbortController();
  fn(controller.signal).catch(err => {
    if (!(err instanceof DOMException && err.message === 'AbortError')) {
      throw err;
    }
  });

  return controller;
}

function computeSizeFeatures(
  layoutData: ElementLayoutData,
  sizeData: ElementSizeData
) {
  type Axis = {value?: number};
  const horizontalAxis: Axis = {
    value: sizeData.width,
  };
  const verticalAxis: Axis = {
    value: sizeData.height,
  };

  let inlineAxis = horizontalAxis;
  let blockAxis = verticalAxis;

  if (layoutData.writingAxis === WritingAxis.Vertical) {
    const tmp = inlineAxis;
    inlineAxis = blockAxis;
    blockAxis = tmp;
  }

  if (
    (layoutData.containerType & ContainerType.BlockSize) !==
    ContainerType.BlockSize
  ) {
    blockAxis.value = undefined;
  }

  return {
    width: horizontalAxis.value,
    height: verticalAxis.value,
    inlineSize: inlineAxis.value,
    blockSize: blockAxis.value,
  };
}

function computeContainerType(containerType: string): ContainerType {
  let type = ContainerType.None;
  if (containerType.length === 0) {
    return type;
  }

  if (containerType.startsWith(INTERNAL_KEYWORD_PREFIX)) {
    containerType = containerType.substring(INTERNAL_KEYWORD_PREFIX.length);
    if (
      containerType === 'normal' ||
      isContainerStandaloneKeyword(containerType)
    ) {
      return type;
    }
  }

  const parts = containerType.split(' ');
  for (const part of parts) {
    switch (part) {
      case 'size':
        type = type | (ContainerType.InlineSize | ContainerType.BlockSize);
        break;

      case 'inline-size':
        type = type | ContainerType.InlineSize;
        break;

      default:
        return ContainerType.None;
    }
  }
  return type;
}

function computeDisplayFlags(displayType: string): DisplayFlags {
  let flags = 0;
  if (displayType !== 'none') {
    flags |= DisplayFlags.Enabled;

    if (
      displayType !== 'contents' &&
      displayType !== 'inline' &&
      !TABLE_OR_RUBY_DISPLAY_TYPE.test(displayType)
    ) {
      flags |= DisplayFlags.EligibleForSizeContainment;
    }
  }

  return flags;
}

function computeContainerNames(containerNames: string) {
  if (containerNames.startsWith(INTERNAL_KEYWORD_PREFIX)) {
    containerNames = containerNames.substring(INTERNAL_KEYWORD_PREFIX.length);
    if (
      containerNames === 'none' ||
      isContainerStandaloneKeyword(containerNames)
    ) {
      return new Set([]);
    }
  }

  return new Set(containerNames.length === 0 ? [] : containerNames.split(' '));
}

function computeWritingAxis(writingMode: string) {
  return VERTICAL_WRITING_MODES.has(writingMode)
    ? WritingAxis.Vertical
    : WritingAxis.Horizontal;
}

function computeDimension(read: (name: string) => string, name: string) {
  return parseFloat(read(name));
}

function computeDimensionSum(
  read: (name: string) => string,
  names: ReadonlyArray<string>
) {
  return names.reduce((value, name) => value + computeDimension(read, name), 0);
}

function createStateComputer(element: Element) {
  const styles = window.getComputedStyle(element);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return memoizeAndReuse((parentState: LayoutState, cacheKey: symbol) => {
    const {context: parentContext, conditions: parentConditions} = parentState;

    const readProperty = (name: string) => styles.getPropertyValue(name);
    const layoutData = computeLayoutData(readProperty);
    const context: TreeContext = {
      ...parentContext,
      writingAxis: layoutData.writingAxis,
    };

    let conditions = parentConditions;
    let isQueryContainer = false;
    let displayFlags = layoutData.displayFlags;
    if ((parentState.displayFlags & DisplayFlags.Enabled) === 0) {
      displayFlags = 0;
    }

    const {containerType, containerNames} = layoutData;
    if (containerType > 0) {
      const isValidContainer =
        containerType > 0 &&
        (displayFlags & DisplayFlags.EligibleForSizeContainment) ===
          DisplayFlags.EligibleForSizeContainment;
      const parentConditionMap = new Map(
        parentConditions.map(entry => [entry[0].value, entry[1]])
      );

      conditions = [];
      isQueryContainer = true;

      if (isValidContainer) {
        const sizeData = computeSizeData(readProperty);
        context.fontSize = sizeData.fontSize;

        const sizeFeatures = computeSizeFeatures(layoutData, sizeData);
        const queryContext = {
          sizeFeatures,
          treeContext: context,
        };

        const computeQueryCondition = (query: ContainerQueryDescriptor) => {
          const {rule} = query;
          const name = rule.name;
          const result =
            name == null || containerNames.has(name)
              ? evaluateContainerCondition(rule, queryContext)
              : null;

          if (result == null) {
            const condition =
              parentConditionMap.get(query) ?? QueryContainerFlags.None;
            return (
              (condition && QueryContainerFlags.Condition) ===
              QueryContainerFlags.Condition
            );
          }

          return result === true;
        };

        const computeQueryState = (
          conditionMap: Map<ContainerQueryDescriptor, QueryContainerFlags>,
          query: ContainerQueryDescriptor
        ): QueryContainerFlags => {
          let state = conditionMap.get(query);
          if (state == null) {
            const condition = computeQueryCondition(query);
            const container =
              condition === true &&
              (query.parent == null ||
                (computeQueryState(conditionMap, query.parent) &
                  QueryContainerFlags.Condition) ===
                  QueryContainerFlags.Condition);

            state =
              (condition ? QueryContainerFlags.Condition : 0) |
              (container ? QueryContainerFlags.Container : 0);
            conditionMap.set(query, state);
          }

          return state;
        };

        const newConditionMap: Map<
          ContainerQueryDescriptor,
          QueryContainerFlags
        > = new Map();
        for (const entry of parentConditions) {
          conditions.push([
            entry[0],
            computeQueryState(newConditionMap, entry[0].value),
          ]);
        }

        context.cqw =
          sizeFeatures.width != null
            ? sizeFeatures.width / 100
            : parentContext.cqw;
        context.cqh =
          sizeFeatures.height != null
            ? sizeFeatures.height / 100
            : parentContext.cqh;
      }
    }

    return {
      parentState: new Reference(parentState),
      conditions,
      context,
      displayFlags,
      isQueryContainer,
    };
  });
}

function computeSizeData(read: (name: string) => string): ElementSizeData {
  const isBorderBox = read('box-sizing') === 'border-box';

  let widthOffset = 0;
  let heightOffset = 0;
  if (isBorderBox) {
    widthOffset = computeDimensionSum(read, WIDTH_BORDER_BOX_PROPERTIES);
    heightOffset = computeDimensionSum(read, HEIGHT_BORDER_BOX_PROPERTIES);
  }

  return {
    fontSize: computeDimension(read, 'font-size'),
    width: computeDimension(read, 'width') - widthOffset,
    height: computeDimension(read, 'height') - heightOffset,
  };
}

function computeLayoutData(read: (name: string) => string): ElementLayoutData {
  return {
    containerType: computeContainerType(read(CUSTOM_PROPERTY_TYPE).trim()),
    containerNames: computeContainerNames(read(CUSTOM_PROPERTY_NAME).trim()),
    writingAxis: computeWritingAxis(read('writing-mode').trim()),
    displayFlags: computeDisplayFlags(read('display').trim()),
  };
}

function setProperty(
  styles: CSSStyleDeclaration,
  name: string,
  value: string | null
) {
  if (value != null) {
    if (value != styles.getPropertyValue(name)) {
      styles.setProperty(name, value);
    }
  } else {
    styles.removeProperty(name);
  }
}

function getDescriptorsForStyleSheet(
  styleSheet: CSSStyleSheet
): ContainerQueryDescriptor[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const value = (styleSheet as any)[STYLESHEET_SYMBOL];
  return value ?? [];
}

function setDescriptorsForStyleSheet(
  styleSheet: CSSStyleSheet,
  descriptors?: ContainerQueryDescriptor[]
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (styleSheet as any)[STYLESHEET_SYMBOL] = descriptors;
}
