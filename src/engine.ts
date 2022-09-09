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

interface LayoutState {
  conditions: Map<string, QueryContainerFlags>;
  context: TreeContext;
  displayFlags: DisplayFlags;
  isQueryContainer: boolean;
}

type QueryDescriptorArray = Iterable<ContainerQueryDescriptor>;

const INSTANCE_SYMBOL: unique symbol = Symbol('CQ_INSTANCE');
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

interface ParsedLayoutData {
  width: number;
  height: number;
  writingAxis: WritingAxis;
  fontSize: number;
  displayFlags: DisplayFlags;
}

interface LayoutStateContext {
  getParentState(): LayoutState;
  getQueryDescriptors(): Iterable<ContainerQueryDescriptor>;
}

export function initializePolyfill() {
  interface Instance {
    depth: number;
    state: LayoutStateManager;

    connect(): void;
    disconnect(): void;
    resize(): void;
    parentResize(): void;
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

  const cachedStyleSheetOwners: Node[] = [];
  let cachedQueryDescriptors: ContainerQueryDescriptor[] | null = null;

  const dummyElement = document.createElement(`cq-polyfill-${PER_RUN_UID}`);
  const globalStyleElement = document.createElement('style');
  const mutationObserver = new MutationObserver(mutations => {
    for (const entry of mutations) {
      cachedQueryDescriptors = null;

      for (const node of entry.removedNodes) {
        const instance = getInstance(node);
        // Note: We'll recurse into the nodes during the disconnect.
        instance?.disconnect();
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

      // Note: We'll recurse into any added nodes during the mutation.
      const instance = getOrCreateInstance(entry.target);
      instance.mutate();
    }
  });
  mutationObserver.observe(documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeOldValue: true,
  });

  const originalAttachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function(options) {
    const shadow = originalAttachShadow.apply(this, [options]);
    mutationObserver.observe(shadow, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeOldValue: true,
    });
    return shadow;
  }

  const pendingMutations: Array<() => void> = [];
  let shouldQueueMutations = false;
  function queueMutation(callback: () => void) {
    if (shouldQueueMutations) {
      pendingMutations.push(callback);
    } else {
      callback();
    }
  }

  const pendingResize: Set<Node> = new Set();
  const resizeObserver = new ResizeObserver(entries => {
    try {
      shouldQueueMutations = true;
      entries
        .map(entry => {
          const node = entry.target;
          pendingResize.add(node);
          return getOrCreateInstance(node);
        })
        .sort((a, b) => a.depth - b.depth)
        .forEach(instance => instance.resize());
    } finally {
      pendingResize.clear();
      shouldQueueMutations = false;
      pendingMutations.forEach(callback => callback());
      pendingMutations.length = 0;
    }
  });

  function forceUpdate(el: Element) {
    resizeObserver.unobserve(el);
    resizeObserver.observe(el);
  }

  const rootController = new NodeController(documentElement);
  const queryDescriptorMap: Map<Node, QueryDescriptorArray> = new Map();
  async function registerStyleSheet(
    node: Node,
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

    if (!signal?.aborted) {
      queryDescriptorMap.set(node instanceof ShadowRoot ? node.host : node, result.descriptors);
      dispose = () => queryDescriptorMap.delete(node);
      cachedQueryDescriptors = null;
    }

    cachedStyleSheetOwners.push(node);

    return {
      source: result.source,
      dispose,
      refresh() {
        forceUpdate(documentElement);
      },
    };
  }

  function getQueryDescriptors() {
    if (!cachedQueryDescriptors) {
      cachedQueryDescriptors = [];
      for (const owner of cachedStyleSheetOwners) {
        const ownerNode = owner instanceof ShadowRoot ? owner.host : owner;
        if (ownerNode instanceof Element) {
          const queryDescriptors = queryDescriptorMap.get(ownerNode);
          if (queryDescriptors) {
            cachedQueryDescriptors.push(...queryDescriptors);
          }
        }
      }
    }
    return cachedQueryDescriptors;
  }

  const fallbackContainerUnits: {cqw: number | null; cqh: number | null} = {
    cqw: null,
    cqh: null,
  };
  function viewportChanged({width, height}: PhysicalSize) {
    fallbackContainerUnits.cqw = width;
    fallbackContainerUnits.cqh = height;
  }

  function updateAttributes(
    node: Node,
    state: LayoutStateManager | null,
    attribute: string
  ) {
    if (node instanceof Element && state) {
      const attributes = state.computeAttributesForElement(node);
      queueMutation(() => {
        if (attributes.length > 0) {
          node.setAttribute(attribute, attributes);
        } else {
          node.removeAttribute(attribute);
        }
      });
    }
  }

  function getOrCreateInstance(node: Node): Instance {
    let instance = getInstance(node);
    if (!instance) {
      let innerController: NodeController<Node>;
      let parentState: LayoutStateManager | null = null;
      let state: LayoutStateManager;
      let depth = 0;

      if (node === documentElement) {
        innerController = rootController;
        state = new LayoutStateManager(documentElement, {
          getParentState() {
            const context = state.getLayoutData();
            return {
              conditions: new Map(),
              context: {
                ...fallbackContainerUnits,
                fontSize: context.fontSize,
                rootFontSize: context.fontSize,
                writingAxis: context.writingAxis,
              },
              displayFlags: context.displayFlags,
              isQueryContainer: false,
            };
          },
          getQueryDescriptors,
        });
      } else {
        const parentNode = node.parentNode;
        const parentController = parentNode ? getInstance(parentNode) : (node as ShadowRoot).host ? getInstance((node as ShadowRoot).host) : null;

        if (!parentController) {
          throw new Error('Expected node to have parent');
        }

        parentState = parentController.state;
        state =
          node instanceof Element
            ? new LayoutStateManager(node, {
                getParentState() {
                  return parentController.state.get();
                },
                getQueryDescriptors,
              })
            : parentState;
        depth = parentController.depth + 1;

        if (node === dummyElement) {
          innerController = new DummyElementController(dummyElement, {
            viewportChanged,
          });
        } else if (node === globalStyleElement) {
          innerController = new GlobalStyleElementController(
            globalStyleElement
          );
        } else if (node instanceof HTMLLinkElement) {
          innerController = new LinkElementController(node, {
            registerStyleSheet: options =>
              registerStyleSheet(node, {
                ...options,
              }),
          });
        } else if (node instanceof ShadowRoot) {
          innerController = new ShadowStyleSheetController(node, {
            registerStyleSheet: options => {
              return registerStyleSheet(node, {
                ...options,
              })
            }
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
      }

      const scheduleUpdate =
        node instanceof Element
          ? () => forceUpdate(node)
          : () => {
              /* NOOP */
            };
      const inlineStyles =
        node instanceof HTMLElement || node instanceof SVGElement
          ? node.style
          : null;

      instance = {
        depth,
        state,

        connect() {
          if (node instanceof Element) {
            resizeObserver.observe(node);
          }
          for (const child of node.childNodes) {
            // Ensure all children are created and connected first.
            getOrCreateInstance(child);
          }
          innerController.connected();
          scheduleUpdate();
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
          for (const child of node.childNodes) {
            const instance = getInstance(child);
            instance?.disconnect();
          }
          innerController.disconnected();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          delete (node as any)[INSTANCE_SYMBOL];
        },

        resize() {
          state.invalidate();
          updateAttributes(node, state, DATA_ATTRIBUTE_SELF);

          if (inlineStyles) {
            const currentState = state.get();
            const context = currentState.context;
            const writingAxis = context.writingAxis;

            queueMutation(() => {
              if (
                !parentState ||
                writingAxis !== parentState.get().context.writingAxis ||
                currentState.isQueryContainer
              ) {
                inlineStyles.setProperty(
                  CUSTOM_UNIT_VARIABLE_CQI,
                  `var(${
                    writingAxis === WritingAxis.Horizontal
                      ? CUSTOM_UNIT_VARIABLE_CQW
                      : CUSTOM_UNIT_VARIABLE_CQH
                  })`
                );
                inlineStyles.setProperty(
                  CUSTOM_UNIT_VARIABLE_CQB,
                  `var(${
                    writingAxis === WritingAxis.Vertical
                      ? CUSTOM_UNIT_VARIABLE_CQW
                      : CUSTOM_UNIT_VARIABLE_CQH
                  })`
                );
              } else {
                inlineStyles.removeProperty(CUSTOM_UNIT_VARIABLE_CQI);
                inlineStyles.removeProperty(CUSTOM_UNIT_VARIABLE_CQB);
              }

              if (!parentState || currentState.isQueryContainer) {
                if (context.cqw) {
                  inlineStyles.setProperty(
                    CUSTOM_UNIT_VARIABLE_CQW,
                    context.cqw + 'px'
                  );
                }
                if (context.cqh) {
                  inlineStyles.setProperty(
                    CUSTOM_UNIT_VARIABLE_CQH,
                    context.cqh + 'px'
                  );
                }
              } else {
                inlineStyles.removeProperty(CUSTOM_UNIT_VARIABLE_CQW);
                inlineStyles.removeProperty(CUSTOM_UNIT_VARIABLE_CQH);
              }
            });
          }

          innerController.resized(state);
          for (const child of node.childNodes) {
            const instance = getOrCreateInstance(child);
            instance.parentResize();
          }
        },

        parentResize() {
          state.invalidate();
          updateAttributes(node, parentState, DATA_ATTRIBUTE_CHILD);
          scheduleUpdate();

          if (!pendingResize.has(node)) {
            for (const child of node.childNodes) {
              const instance = getOrCreateInstance(child);
              instance.parentResize();
            }
          }
        },

        mutate() {
          state.invalidate();
          scheduleUpdate();

          for (const child of node.childNodes) {
            getOrCreateInstance(child);
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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  resized(layoutState: LayoutStateManager) {
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

class ShadowStyleSheetController extends NodeController<ShadowRoot> {
  private context: StyleSheetContext;
  private controller: AbortController | null = null;
  private styleSheet: StyleSheetInstance | null = null;

  constructor(node: ShadowRoot, context: StyleSheetContext) {
    super(node);
    this.context = context;
  }

  connected(): void {
    // cast any to access constructor.styles
    const host = this.node.host as any;
    const cssText = host.constructor?.styles?.cssText;
    if (cssText) {
      this.controller = tryAbortableFunction(async signal => {
        const styleSheet = (this.styleSheet =
          await this.context.registerStyleSheet({
            source: cssText,
            signal,
          }));
        // typescript compilation bug cast any
        const adoptStyleSheet = (this.node as any).adoptedStyleSheets[0] as any;
        adoptStyleSheet.replaceSync(styleSheet.source);
        // set container type on host if CSS selector matches
        for (const rule of adoptStyleSheet.cssRules) {
          if ((rule as any).style) {
            const value = rule.style.getPropertyValue(CUSTOM_PROPERTY_TYPE).trim();
            if (value) {
              const selector: string = rule.selectorText.replace(':host', host.localName);
              // handle parentheses on :host([attribute])
              const mutatedSelector = !selector.includes(':') ? selector.replace('(', '').replace(')', '') : selector;
              // if match apply rule
              if (host.matches(mutatedSelector)) {
                host.style.setProperty(CUSTOM_PROPERTY_TYPE, value);
                break;
              }
            }
          }
        }
        styleSheet.refresh();
      });
    }
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
      typeof (window as any).CSSLayerBlockRule === 'undefined'
        ? style
        : `@layer cq-polyfill-${PER_RUN_UID} { ${style} }`;
  }
}

class DummyElementController extends NodeController<HTMLElement> {
  private context: ViewportChangeContext;

  constructor(node: HTMLElement, context: ViewportChangeContext) {
    super(node);
    this.context = context;
  }

  connected(): void {
    this.node.style.cssText =
      'position: fixed; top: 0; left: 0; visibility: hidden; ' +
      (SUPPORTS_SMALL_VIEWPORT_UNITS
        ? 'width: 1svw; height: 1svh;'
        : 'width: 1%; height: 1%;');
  }

  resized(layoutState: LayoutStateManager): void {
    const data = layoutState.getLayoutData();
    this.context.viewportChanged({
      width: data.width,
      height: data.height,
    });
  }
}

class LayoutStateManager {
  private cachedState: LayoutState | null = null;
  private cachedLayoutData: ParsedLayoutData | null = null;
  private context: LayoutStateContext;
  private styles: CSSStyleDeclaration;
  private element: Element;

  constructor(element: Element, context: LayoutStateContext) {
    this.element = element;
    this.styles = window.getComputedStyle(element);
    this.context = context;
  }

  invalidate(): void {
    this.cachedState = null;
    this.cachedLayoutData = null;
  }

  computeAttributesForElement(el: Element): string {
    const conditions = this.get().conditions;
    let attributes = '';

    for (const query of this.context.getQueryDescriptors()) {
      if (query.selector != null) {
        const result = conditions.get(query.uid);
        if (
          result != null &&
          (result & QueryContainerFlags.Container) ===
            QueryContainerFlags.Container &&
          el.matches(query.selector)
        ) {
          attributes += query.uid + ' ';
        }
      }
    }

    return attributes;
  }

  getLayoutData(): ParsedLayoutData {
    let data = this.cachedLayoutData;
    if (!data) {
      const styles = this.styles;
      const isBorderBox =
        styles.getPropertyValue('box-sizing') === 'border-box';

      const getDimension = (property: string) =>
        parseFloat(styles.getPropertyValue(property));
      const sumProperties = (properties: string[]) =>
        properties.reduce(
          (current, property) => current + getDimension(property),
          0
        );

      this.cachedLayoutData = data = {
        writingAxis: computeWritingAxis(
          styles.getPropertyValue('writing-mode')
        ),
        fontSize: parseFloat(styles.getPropertyValue('font-size')),
        width:
          getDimension('width') -
          (isBorderBox ? sumProperties(WIDTH_BORDER_BOX_PROPERTIES) : 0),
        height:
          getDimension('height') -
          (isBorderBox ? sumProperties(HEIGHT_BORDER_BOX_PROPERTIES) : 0),
        displayFlags: computeDisplayFlags(
          styles.getPropertyValue('display').trim()
        ),
      };
    }
    return data;
  }

  get(): LayoutState {
    let state = this.cachedState;
    if (!state) {
      const {context: layoutContext, styles} = this;
      const data = this.getLayoutData();
      const parentState = layoutContext.getParentState();
      const {context: parentContext, conditions: parentConditions} =
        parentState;

      let displayFlags = data.displayFlags;
      if ((parentState.displayFlags & DisplayFlags.Enabled) === 0) {
        displayFlags = 0;
      }

      let conditions = parentConditions;
      let isQueryContainer = false;

      const context: TreeContext = {
        ...parentContext,
        fontSize: data.fontSize,
        writingAxis: data.writingAxis,
      };
      const containerType = (() => {
        let propValue;
        if (this.element.parentNode instanceof ShadowRoot) {
          const host = this.element.parentNode.host;
          propValue = window.getComputedStyle(host).getPropertyValue(CUSTOM_PROPERTY_TYPE).trim();
        }
        if (!propValue) {
          propValue = styles.getPropertyValue(CUSTOM_PROPERTY_TYPE).trim();
        }
        return computeContainerType(
          propValue
      )})();
      if (containerType > 0) {
        conditions = new Map();
        isQueryContainer = true;

        const isValidContainer =
          (displayFlags & DisplayFlags.EligibleForSizeContainment) ===
          DisplayFlags.EligibleForSizeContainment;

        if (isValidContainer) {
          const sizeFeatures = computeSizeFeatures(containerType, data);
          const queryContext = {
            sizeFeatures,
            treeContext: context,
          };
          const containerNames = computeContainerNames(
            styles.getPropertyValue(CUSTOM_PROPERTY_NAME)
          );

          const computeQueryCondition = (query: ContainerQueryDescriptor) => {
            const {rule} = query;
            const name = rule.name;
            const result =
              name == null || containerNames.has(name)
                ? evaluateContainerCondition(rule, queryContext)
                : null;

            if (result == null) {
              const condition = parentConditions.get(query.uid) ?? 0;
              return (
                (condition && QueryContainerFlags.Condition) ===
                QueryContainerFlags.Condition
              );
            }

            return result === true;
          };

          const computeQueryState = (
            conditions: Map<string, QueryContainerFlags>,
            query: ContainerQueryDescriptor
          ): QueryContainerFlags => {
            let state = conditions.get(query.uid);
            if (state == null) {
              const condition = computeQueryCondition(query);
              const container =
                condition === true &&
                (query.parent == null ||
                  (computeQueryState(conditions, query.parent) &
                    QueryContainerFlags.Condition) ===
                    QueryContainerFlags.Condition);

              state =
                (condition ? QueryContainerFlags.Condition : 0) |
                (container ? QueryContainerFlags.Container : 0);
              conditions.set(query.uid, state);
            }

            return state;
          };

          for (const query of layoutContext.getQueryDescriptors()) {
            computeQueryState(conditions, query);
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
      this.cachedState = state = {
        conditions,
        context,
        displayFlags,
        isQueryContainer,
      };
    }
    return state;
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

function computeSizeFeatures(type: ContainerType, data: ParsedLayoutData) {
  type Axis = {value?: number};
  const horizontalAxis: Axis = {
    value: data.width,
  };
  const verticalAxis: Axis = {
    value: data.height,
  };

  let inlineAxis = horizontalAxis;
  let blockAxis = verticalAxis;

  if (data.writingAxis === WritingAxis.Vertical) {
    const tmp = inlineAxis;
    inlineAxis = blockAxis;
    blockAxis = tmp;
  }

  if ((type & ContainerType.BlockSize) !== ContainerType.BlockSize) {
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
