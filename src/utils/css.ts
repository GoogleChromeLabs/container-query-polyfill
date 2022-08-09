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

export const enum HashFlag {
  UNRESTRICTED,
  ID,
}

export const enum NumberFlag {
  INTEGER,
  NUMBER,
}

export type Node =
  | EOFToken
  | WhitespaceToken
  | StringToken
  | BadStringToken
  | LeftParenthesisToken
  | RightParenthesisToken
  | CommaToken
  | ColonToken
  | SemicolonToken
  | LeftSquareBracketToken
  | RightSquareBracketToken
  | LeftCurlyBracketToken
  | RightCurlyBracketToken
  | DelimToken
  | HashToken
  | DimensionToken
  | PercentageToken
  | NumberToken
  | CDOToken
  | CDCToken
  | URLToken
  | BadURLToken
  | AtKeywordToken
  | FunctionToken
  | IdentToken
  | AtRuleNode
  | QualifiedRuleNode
  | FunctionNode
  | BlockNode
  | DeclarationNode;

export const enum Type {
  /* Token Types */
  EOFToken,
  WhitespaceToken,
  StringToken,
  BadStringToken,
  LeftParenthesisToken,
  RightParenthesisToken,
  CommaToken,
  ColonToken,
  SemicolonToken,
  LeftSquareBracketToken,
  RightSquareBracketToken,
  LeftCurlyBracketToken,
  RightCurlyBracketToken,
  DelimToken,
  HashToken,
  DimensionToken,
  PercentageToken,
  NumberToken,
  CDOToken,
  CDCToken,
  URLToken,
  BadURLToken,
  AtKeywordToken,
  FunctionToken,
  IdentToken,

  /* Node Types */
  AtRuleNode,
  QualifiedRuleNode,
  FunctionNode,
  BlockNode,
  DeclarationNode,
}

export interface EOFToken {
  type: Type.EOFToken;
}

export interface WhitespaceToken {
  type: Type.WhitespaceToken;
}

export interface StringToken {
  type: Type.StringToken;
  value: string;
}

export interface BadStringToken {
  type: Type.BadStringToken;
}

export interface LeftParenthesisToken {
  type: Type.LeftParenthesisToken;
}

export interface RightParenthesisToken {
  type: Type.RightParenthesisToken;
}

export interface CommaToken {
  type: Type.CommaToken;
}

export interface ColonToken {
  type: Type.ColonToken;
}

export interface SemicolonToken {
  type: Type.SemicolonToken;
}

export interface LeftSquareBracketToken {
  type: Type.LeftSquareBracketToken;
}

export interface RightSquareBracketToken {
  type: Type.RightSquareBracketToken;
}

export interface LeftCurlyBracketToken {
  type: Type.LeftCurlyBracketToken;
}

export interface RightCurlyBracketToken {
  type: Type.RightCurlyBracketToken;
}

export interface DelimToken {
  type: Type.DelimToken;
  value: string;
}

export interface HashToken {
  type: Type.HashToken;
  value: string;
  flag: HashFlag;
}

export interface DimensionToken {
  type: Type.DimensionToken;
  value: string;
  flag: NumberFlag;
  unit: string;
}

export interface PercentageToken {
  type: Type.PercentageToken;
  value: string;
}

export interface NumberToken {
  type: Type.NumberToken;
  value: string;
  flag: NumberFlag;
}

export interface CDOToken {
  type: Type.CDOToken;
}

export interface CDCToken {
  type: Type.CDCToken;
}

export interface URLToken {
  type: Type.URLToken;
  value: string;
}

export interface BadURLToken {
  type: Type.BadURLToken;
}

export interface AtKeywordToken {
  type: Type.AtKeywordToken;
  value: string;
}

export interface FunctionToken {
  type: Type.FunctionToken;
  value: string;
}

export interface IdentToken {
  type: Type.IdentToken;
  value: string;
}

export interface AtRuleNode {
  type: Type.AtRuleNode;
  name: string;
  prelude: Node[];
  value: BlockNode | null;
}

export interface QualifiedRuleNode {
  type: Type.QualifiedRuleNode;
  prelude: Node[];
  value: BlockNode;
}

export interface FunctionNode {
  type: Type.FunctionNode;
  name: string;
  value: Node[];
}

export interface BlockNode {
  type: Type.BlockNode;
  source: Node;
  value: Block;
}

export interface DeclarationNode {
  type: Type.DeclarationNode;
  name: string;
  value: Node[];
  important: boolean;
}

export const enum BlockType {
  SimpleBlock,
  StyleBlock,
  DeclarationList,
  RuleList,
}

export type Block =
  | SimpleBlock
  | StyleBlock
  | DeclarationListBlock
  | RuleListBlock;

export interface SimpleBlock {
  type: BlockType.SimpleBlock;
  value: Node[];
}

export interface StyleBlock {
  type: BlockType.StyleBlock;
  value: Array<AtRuleNode | QualifiedRuleNode | DeclarationNode>;
}

export interface DeclarationListBlock {
  type: BlockType.DeclarationList;
  value: Array<AtRuleNode | DeclarationNode>;
}

export interface RuleListBlock {
  type: BlockType.RuleList;
  value: Array<AtRuleNode | QualifiedRuleNode>;
}

export interface Parser<T> {
  value: T;
  errorIndices: number[];
  index: number;

  at(offset: number): T;
  consume(count: number): T;

  reconsume(): void;
  error(): void;
}

export const PARSE_ERROR: unique symbol = Symbol();
export type ParseResult<T> = NonNullable<T> | typeof PARSE_ERROR;

export const enum CodePoints {
  EOF = -1,

  NULL = 0x0000,
  BACKSPACE = 0x0008,
  CHARACTER_TABULATION = 0x0009,

  NEWLINE = 0x000a,
  LINE_TABULATION = 0x000b,
  FORM_FEED = 0x000c,
  CARRIAGE_RETURN = 0x000d,
  SHIFT_OUT = 0x000e,
  INFORMATION_SEPARATOR_ONE = 0x001f,

  SPACE = 0x0020,
  EXCLAMATION_MARK = 0x0021,
  QUOTATION_MARK = 0x0022,
  NUMBER_SIGN = 0x0023,
  PERCENTAGE_SIGN = 0x0025,
  APOSTROPHE = 0x0027,
  LEFT_PARENTHESIS = 0x0028,
  RIGHT_PARENTHESIS = 0x0029,
  PLUS_SIGN = 0x002b,
  COMMA = 0x002c,
  HYPHEN_MINUS = 0x002d,
  FULL_STOP = 0x002e,
  COLON = 0x003a,
  SEMICOLON = 0x003b,
  LESS_THAN_SIGN = 0x003c,
  GREATER_THAN_SIGN = 0x003e,
  COMMERCIAL_AT = 0x0040,
  LEFT_SQUARE_BRACKET = 0x005b,
  REVERSE_SOLIDUS = 0x005c,
  RIGHT_SQUARE_BRACKET = 0x005d,
  LOW_LINE = 0x005f,

  DIGIT_ZERO = 0x0030,
  DIGIT_NINE = 0x0039,

  LATIN_CAPITAL_LETTER_A = 0x0041,
  LATIN_CAPITAL_LETTER_E = 0x0045,
  LATIN_CAPITAL_LETTER_F = 0x0046,
  LATIN_CAPITAL_LETTER_Z = 0x005a,

  LATIN_SMALL_LETTER_A = 0x0061,
  LATIN_SMALL_LETTER_E = 0x0065,
  LATIN_SMALL_LETTER_F = 0x0066,
  LATIN_SMALL_LETTER_Z = 0x007a,

  LEFT_CURLY_BRACKET = 0x007b,
  RIGHT_CURLY_BRACKET = 0x007d,
  DELETE = 0x007f,

  CONTROL = 0x0080,

  ASTERISK = 0x002a,
  SOLIDUS = 0x002f,

  SURROGATE_START = 0xd800,
  SURROGATE_END = 0xdfff,

  REPLACEMENT_CHARACTER = 0xfffd,
  MAX = 0x10ffff,
}

type CodePoint = number;

function createParser<T>(nodes: ReadonlyArray<T>, sentinel: T): Parser<T> {
  const parser: Parser<T> = {
    value: sentinel,
    errorIndices: [],
    index: -1,

    at(offset) {
      const index = parser.index + offset;
      return index >= nodes.length ? sentinel : nodes[index];
    },

    consume(count: number) {
      parser.index += count;
      parser.value = parser.at(0);
      return parser.value;
    },

    reconsume() {
      parser.index -= 1;
    },

    error() {
      parser.errorIndices.push(parser.index);
    },
  };

  return parser;
}

export function createNodeParser(nodes: ReadonlyArray<Node>): Parser<Node> {
  return createParser(nodes, {type: Type.EOFToken});
}

/**
 * Returns a stream of tokens according to CSS Syntax Module Level 3
 * (https://www.w3.org/TR/css-syntax-3/)
 */
export function* tokenize(source: string): Generator<Node> {
  const codePoints: CodePoint[] = [];

  let prevCarriageReturn = false;
  for (const chr of source) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const code = chr.codePointAt(0)!;

    if (prevCarriageReturn && code !== CodePoints.NEWLINE) {
      prevCarriageReturn = false;
      codePoints.push(CodePoints.NEWLINE);
    }

    if (
      code === 0 ||
      (code >= CodePoints.SURROGATE_START && code <= CodePoints.SURROGATE_END)
    ) {
      codePoints.push(CodePoints.REPLACEMENT_CHARACTER);
    } else if (code === CodePoints.CARRIAGE_RETURN) {
      prevCarriageReturn = true;
    } else {
      codePoints.push(code);
    }
  }

  const parser = createParser(codePoints, CodePoints.EOF);
  const {at, consume, error, reconsume} = parser;

  function getCurrentString() {
    return String.fromCodePoint(parser.value);
  }

  function consumeDelimToken(): Node {
    return {type: Type.DelimToken, value: getCurrentString()};
  }

  function consumeHashToken(): Node {
    return {
      type: Type.HashToken,
      flag: isIdentSequence(at(1), at(2), at(3))
        ? HashFlag.ID
        : HashFlag.UNRESTRICTED,
      value: consumeIdentSequence(),
    };
  }

  // § 4.3.2. Consume whitespace
  function consumeWhitespace() {
    while (isWhitespace(at(1))) {
      consume(1);
    }
  }

  // § 4.3.2. Consume comments
  function consumeComments() {
    while (parser.value !== CodePoints.EOF) {
      consume(1);

      if (at(0) === CodePoints.ASTERISK && at(1) === CodePoints.SOLIDUS) {
        consume(1);
        return;
      }
    }

    error();
  }

  // § 4.3.3. Consume a numeric token
  function consumeNumericToken(): Node {
    const [number, flag] = consumeNumber();
    const c1 = at(1);

    if (isIdentSequence(c1, at(1), at(2))) {
      const unit = consumeIdentSequence();
      return {
        type: Type.DimensionToken,
        value: number,
        flag: flag,
        unit: unit,
      };
    } else if (c1 === CodePoints.PERCENTAGE_SIGN) {
      consume(1);
      return {
        type: Type.PercentageToken,
        value: number,
      };
    } else {
      return {
        type: Type.NumberToken,
        value: number,
        flag: flag,
      };
    }
  }

  // § 4.3.4. Consume an ident-like token
  function consumeIdentLikeToken(): Node {
    const value = consumeIdentSequence();
    let c1 = at(1);

    if (value.toLowerCase() === 'url' && c1 === CodePoints.LEFT_PARENTHESIS) {
      consume(1);

      while (isWhitespace(at(1)) && isWhitespace(at(2))) {
        consume(1);
      }

      c1 = at(1);
      const c2 = at(2);

      if (c1 === CodePoints.QUOTATION_MARK || c1 === CodePoints.APOSTROPHE) {
        return {
          type: Type.FunctionToken,
          value: value,
        };
      } else if (
        isWhitespace(c1) &&
        (c2 === CodePoints.QUOTATION_MARK || c2 === CodePoints.APOSTROPHE)
      ) {
        return {
          type: Type.FunctionToken,
          value: value,
        };
      } else {
        return consumeUrlToken();
      }
    } else if (c1 === CodePoints.LEFT_PARENTHESIS) {
      consume(1);
      return {
        type: Type.FunctionToken,
        value: value,
      };
    } else {
      return {
        type: Type.IdentToken,
        value: value,
      };
    }
  }

  // § 4.3.5. Consume a string token
  function consumeStringToken(endCodePoint: CodePoint): Node {
    let value = '';

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const code = consume(1);

      if (code === CodePoints.EOF || code === endCodePoint) {
        if (code === CodePoints.EOF) {
          error();
        }
        return {
          type: Type.StringToken,
          value: value,
        };
      } else if (isNewline(code)) {
        error();
        reconsume();
        return {
          type: Type.BadStringToken,
        };
      } else if (code === CodePoints.REVERSE_SOLIDUS) {
        const nextCode = at(1);
        if (nextCode === CodePoints.EOF) {
          continue;
        } else if (isNewline(nextCode)) {
          consume(1);
        } else {
          value += consumeEscapedCodePoint();
        }
      } else {
        value += getCurrentString();
      }
    }
  }

  // § 4.3.6. Consume a url token
  function consumeUrlToken(): Node {
    let value = '';
    consumeWhitespace();

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const code = consume(1);
      if (code === CodePoints.RIGHT_PARENTHESIS) {
        return {
          type: Type.URLToken,
          value: value,
        };
      } else if (code === CodePoints.EOF) {
        error();
        return {
          type: Type.URLToken,
          value: value,
        };
      } else if (isWhitespace(code)) {
        consumeWhitespace();
        const c1 = at(1);

        if (c1 === CodePoints.RIGHT_PARENTHESIS || c1 === CodePoints.EOF) {
          consume(1);
          if (code === CodePoints.EOF) {
            error();
          }
          return {
            type: Type.URLToken,
            value: value,
          };
        } else {
          consumeBadUrl();
          return {
            type: Type.BadURLToken,
          };
        }
      } else if (
        code === CodePoints.QUOTATION_MARK ||
        code === CodePoints.APOSTROPHE ||
        code === CodePoints.LEFT_PARENTHESIS ||
        isNonPrintable(code)
      ) {
        error();
        consumeBadUrl();
        return {
          type: Type.BadURLToken,
        };
      } else if (code === CodePoints.REVERSE_SOLIDUS) {
        if (isValidEscape(code, at(1))) {
          value += consumeEscapedCodePoint();
        } else {
          error();
          return {
            type: Type.BadURLToken,
          };
        }
      } else {
        value += getCurrentString();
      }
    }
  }

  // § 4.3.7. Consume an escaped code point
  function consumeEscapedCodePoint(): string {
    const code = consume(1);

    if (isHexDigit(code)) {
      const hexDigits: CodePoints[] = [code];

      for (let i = 0; i < 5; i++) {
        const code = at(1);

        if (!isHexDigit(code)) {
          break;
        }

        hexDigits.push(code);
        consume(1);
      }

      if (isWhitespace(at(1))) {
        consume(1);
      }

      let escapedCode = parseInt(String.fromCodePoint(...hexDigits), 16);
      if (
        escapedCode === 0 ||
        (escapedCode >= CodePoints.SURROGATE_START &&
          escapedCode <= CodePoints.SURROGATE_END) ||
        escapedCode > CodePoints.MAX
      ) {
        escapedCode = CodePoints.REPLACEMENT_CHARACTER;
      }
      return String.fromCodePoint(escapedCode);
    } else if (code === CodePoints.EOF) {
      error();
      return String.fromCodePoint(CodePoints.REPLACEMENT_CHARACTER);
    } else {
      return getCurrentString();
    }
  }

  // § 4.3.9. Check if three code points would start an ident sequence
  function isIdentSequence(
    c1: CodePoint,
    c2: CodePoint,
    c3: CodePoint
  ): boolean {
    if (c1 === CodePoints.HYPHEN_MINUS) {
      return (
        isIdentStart(c2) ||
        c2 === CodePoints.HYPHEN_MINUS ||
        isValidEscape(c2, c3)
      );
    } else if (isIdentStart(c1)) {
      return true;
    } else {
      return false;
    }
  }

  // § 4.3.10. Check if three code points would start a number
  function isNumberStart(c1: CodePoint, c2: CodePoint, c3: CodePoint): boolean {
    if (c1 === CodePoints.PLUS_SIGN || c1 === CodePoints.HYPHEN_MINUS) {
      return isDigit(c2) || (c2 === CodePoints.FULL_STOP && isDigit(c3));
    } else if (c1 === CodePoints.FULL_STOP && isDigit(c2)) {
      return true;
    } else if (isDigit(c1)) {
      return true;
    } else {
      return false;
    }
  }

  // § 4.3.11. Consume an ident sequence
  function consumeIdentSequence() {
    let value = '';

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const code = consume(1);

      if (isIdent(code)) {
        value += getCurrentString();
      } else if (isValidEscape(at(1), at(2))) {
        value += consumeEscapedCodePoint();
      } else {
        reconsume();
        return value;
      }
    }
  }

  // § 4.3.12. Consume a number
  function consumeNumber(): [string, NumberFlag] {
    let type = NumberFlag.INTEGER;
    let value = '';
    let c1 = at(1);

    if (c1 === CodePoints.PLUS_SIGN || c1 === CodePoints.HYPHEN_MINUS) {
      consume(1);
      value += getCurrentString();
    }

    while (isDigit(at(1))) {
      consume(1);
      value += getCurrentString();
    }

    if (at(1) === CodePoints.FULL_STOP && isDigit(at(2))) {
      type = NumberFlag.NUMBER;

      consume(1);
      value += getCurrentString();

      while (isDigit(at(1))) {
        consume(1);
        value += getCurrentString();
      }
    }

    c1 = at(1);
    if (
      c1 === CodePoints.LATIN_CAPITAL_LETTER_E ||
      c1 === CodePoints.LATIN_SMALL_LETTER_E
    ) {
      const c2 = at(2);
      if (isDigit(c2)) {
        type = NumberFlag.NUMBER;

        consume(1);
        value += getCurrentString();

        while (isDigit(at(1))) {
          consume(1);
          value += getCurrentString();
        }
      } else if (
        c2 === CodePoints.HYPHEN_MINUS ||
        c2 === CodePoints.PLUS_SIGN
      ) {
        if (isDigit(at(3))) {
          type = NumberFlag.NUMBER;

          consume(1);
          value += getCurrentString();

          consume(1);
          value += getCurrentString();

          while (isDigit(at(1))) {
            consume(1);
            value += getCurrentString();
          }
        }
      }
    }

    return [value, type];
  }

  // 4.3.14. Consume the remnants of a bad url
  function consumeBadUrl() {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const code = consume(1);
      if (code === CodePoints.EOF) {
        return;
      } else if (isValidEscape(code, at(1))) {
        consumeEscapedCodePoint();
      }
    }
  }

  while (true) {
    const code = consume(1);

    if (code === CodePoints.SOLIDUS && at(1) === CodePoints.ASTERISK) {
      consume(2);
      consumeComments();
    } else if (isWhitespace(code)) {
      consumeWhitespace();
      yield {type: Type.WhitespaceToken};
    } else if (code === CodePoints.QUOTATION_MARK) {
      yield consumeStringToken(code);
    } else if (code === CodePoints.NUMBER_SIGN) {
      const c1 = at(1);
      if (isIdent(c1) || isValidEscape(c1, at(2))) {
        yield consumeHashToken();
      } else {
        yield consumeDelimToken();
      }
    } else if (code === CodePoints.APOSTROPHE) {
      yield consumeStringToken(code);
    } else if (code === CodePoints.LEFT_PARENTHESIS) {
      yield {type: Type.LeftParenthesisToken};
    } else if (code === CodePoints.RIGHT_PARENTHESIS) {
      yield {type: Type.RightParenthesisToken};
    } else if (code === CodePoints.PLUS_SIGN) {
      if (isNumberStart(code, at(1), at(2))) {
        reconsume();
        yield consumeNumericToken();
      } else {
        yield consumeDelimToken();
      }
    } else if (code === CodePoints.COMMA) {
      yield {type: Type.CommaToken};
    } else if (code === CodePoints.HYPHEN_MINUS) {
      const c1 = at(1);
      const c2 = at(2);
      if (isNumberStart(code, c1, c2)) {
        reconsume();
        yield consumeNumericToken();
      } else if (
        c1 === CodePoints.HYPHEN_MINUS &&
        c2 === CodePoints.GREATER_THAN_SIGN
      ) {
        consume(2);
        yield {type: Type.CDCToken};
      } else if (isIdentSequence(code, c1, c2)) {
        reconsume();
        yield consumeIdentLikeToken();
      } else {
        yield consumeDelimToken();
      }
    } else if (code === CodePoints.FULL_STOP) {
      if (isNumberStart(code, at(1), at(2))) {
        reconsume();
        yield consumeNumericToken();
      } else {
        yield consumeDelimToken();
      }
    } else if (code === CodePoints.COLON) {
      yield {type: Type.ColonToken};
    } else if (code === CodePoints.SEMICOLON) {
      yield {type: Type.SemicolonToken};
    } else if (code === CodePoints.LESS_THAN_SIGN) {
      if (
        at(1) === CodePoints.EXCLAMATION_MARK &&
        at(2) === CodePoints.HYPHEN_MINUS &&
        at(3) === CodePoints.HYPHEN_MINUS
      ) {
        yield {type: Type.CDOToken};
      } else {
        yield consumeDelimToken();
      }
    } else if (code === CodePoints.COMMERCIAL_AT) {
      if (isIdentSequence(at(1), at(2), at(3))) {
        const value = consumeIdentSequence();
        yield {
          type: Type.AtKeywordToken,
          value: value,
        };
      } else {
        yield consumeDelimToken();
      }
    } else if (code === CodePoints.LEFT_SQUARE_BRACKET) {
      yield {type: Type.LeftSquareBracketToken};
    } else if (code === CodePoints.REVERSE_SOLIDUS) {
      if (isValidEscape(code, at(1))) {
        reconsume();
        yield consumeIdentLikeToken();
      } else {
        error();
        return consumeDelimToken();
      }
    } else if (code === CodePoints.RIGHT_SQUARE_BRACKET) {
      yield {type: Type.RightSquareBracketToken};
    } else if (code === CodePoints.LEFT_CURLY_BRACKET) {
      yield {type: Type.LeftCurlyBracketToken};
    } else if (code === CodePoints.RIGHT_CURLY_BRACKET) {
      yield {type: Type.RightCurlyBracketToken};
    } else if (isDigit(code)) {
      reconsume();
      yield consumeNumericToken();
    } else if (isIdentStart(code)) {
      reconsume();
      yield consumeIdentLikeToken();
    } else if (code === CodePoints.EOF) {
      yield {type: Type.EOFToken};
      return parser.errorIndices;
    } else {
      yield {type: Type.DelimToken, value: getCurrentString()};
    }
  }
}

function isDigit(c: CodePoint): boolean {
  return c >= CodePoints.DIGIT_ZERO && c <= CodePoints.DIGIT_NINE;
}

function isHexDigit(c: CodePoint): boolean {
  return (
    isDigit(c) ||
    (c >= CodePoints.LATIN_CAPITAL_LETTER_A &&
      c <= CodePoints.LATIN_CAPITAL_LETTER_F) ||
    (c >= CodePoints.LATIN_SMALL_LETTER_A &&
      c <= CodePoints.LATIN_SMALL_LETTER_F)
  );
}

function isNewline(c: CodePoint): boolean {
  return (
    c === CodePoints.NEWLINE ||
    c === CodePoints.CARRIAGE_RETURN ||
    c === CodePoints.FORM_FEED
  );
}

function isWhitespace(c: CodePoint): boolean {
  return (
    isNewline(c) ||
    c === CodePoints.CHARACTER_TABULATION ||
    c === CodePoints.SPACE
  );
}

function isIdentStart(c: CodePoint): boolean {
  return (
    (c >= CodePoints.LATIN_CAPITAL_LETTER_A &&
      c <= CodePoints.LATIN_CAPITAL_LETTER_Z) ||
    (c >= CodePoints.LATIN_SMALL_LETTER_A &&
      c <= CodePoints.LATIN_SMALL_LETTER_Z) ||
    c >= CodePoints.CONTROL ||
    c === CodePoints.LOW_LINE
  );
}

function isValidEscape(c1: CodePoint, c2: CodePoint): boolean {
  if (c1 !== CodePoints.REVERSE_SOLIDUS) {
    return false;
  } else if (isNewline(c2)) {
    return false;
  } else {
    return true;
  }
}

function isIdent(c: CodePoint): boolean {
  return isIdentStart(c) || isDigit(c) || c === CodePoints.HYPHEN_MINUS;
}

function isNonPrintable(c: CodePoint): boolean {
  return (
    (c >= CodePoints.NULL && c <= CodePoints.BACKSPACE) ||
    c === CodePoints.LINE_TABULATION ||
    (c >= CodePoints.SHIFT_OUT && c <= CodePoints.INFORMATION_SEPARATOR_ONE) ||
    c === CodePoints.DELETE
  );
}

const ENDING_TOKEN_MAP: {[key in Type]?: Type} = {
  [Type.LeftCurlyBracketToken]: Type.RightCurlyBracketToken,
  [Type.LeftSquareBracketToken]: Type.RightSquareBracketToken,
  [Type.LeftParenthesisToken]: Type.RightParenthesisToken,
};

// § 5.3.3. Parse a stylesheet
export function parseStylesheet(
  nodes: ReadonlyArray<Node>,
  topLevel?: boolean
): RuleListBlock {
  const node = consumeRuleList(createNodeParser(nodes), topLevel === true);
  return {
    ...node,
    value: node.value.map(rule => {
      return rule.type === Type.QualifiedRuleNode
        ? reinterpretQualifiedRule(rule, parseStyleBlock)
        : rule;
    }),
  };
}

export function parseComponentValue(nodes: ReadonlyArray<Node>): Node[] {
  const parser = createNodeParser(nodes);
  const result: Node[] = [];

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const node = parser.consume(1);

    switch (node.type) {
      case Type.EOFToken:
        return result;

      default:
        parser.reconsume();
        result.push(consumeComponentValue(parser));
        break;
    }
  }
}

function reinterpretQualifiedRule(
  node: QualifiedRuleNode,
  callback: (nodes: Node[]) => Block
) {
  if (node.value.value.type === BlockType.SimpleBlock) {
    return {
      ...node,
      value: {
        ...node.value,
        value: callback(node.value.value.value),
      },
    };
  }
  return node;
}

// § 5.3.6. Parse a declaration
export function parseDeclaration(
  nodes: ReadonlyArray<Node>
): ParseResult<DeclarationNode> {
  const parser = createNodeParser(nodes);

  consumeWhitespace(parser);
  if (parser.at(1).type !== Type.IdentToken) {
    return PARSE_ERROR;
  }

  const declaration = consumeDeclaration(parser);
  if (!declaration) {
    return PARSE_ERROR;
  }

  return declaration;
}

// § 5.3.7. Parse a style block’s contents
export function parseStyleBlock(nodes: ReadonlyArray<Node>): StyleBlock {
  return consumeStyleBlock(createNodeParser(nodes));
}

// § 5.3.8. Parse a list of declarations
export function parseDeclarationList(
  nodes: ReadonlyArray<Node>
): DeclarationListBlock {
  return consumeDeclarationList(createNodeParser(nodes));
}

export function consumeWhitespace(parser: Parser<Node>) {
  while (parser.at(1).type === Type.WhitespaceToken) {
    parser.consume(1);
  }
}

// § 5.4.1. Consume a list of rules
function consumeRuleList(
  parser: Parser<Node>,
  topLevel: boolean
): RuleListBlock {
  const rules: Array<AtRuleNode | QualifiedRuleNode> = [];

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const node = parser.consume(1);

    switch (node.type) {
      case Type.WhitespaceToken:
        // Do nothing.
        break;

      case Type.EOFToken:
        return {type: BlockType.RuleList, value: rules};

      case Type.CDOToken:
      case Type.CDCToken:
        if (topLevel !== false) {
          parser.reconsume();
          const rule = consumeQualifiedRule(parser);

          if (rule !== PARSE_ERROR) {
            rules.push(rule);
          }
        }
        break;

      case Type.AtKeywordToken:
        parser.reconsume();
        rules.push(consumeAtRule(parser));
        break;

      default: {
        parser.reconsume();
        const rule = consumeQualifiedRule(parser);

        if (rule !== PARSE_ERROR) {
          rules.push(rule);
        }
        break;
      }
    }
  }
}

// § 5.4.2. Consume an at-rule
function consumeAtRule(parser: Parser<Node>): AtRuleNode {
  let node = parser.consume(1);
  if (node.type !== Type.AtKeywordToken) {
    throw new Error(`Unexpected type ${node.type}`);
  }

  const name = node.value;
  const prelude: Node[] = [];

  // eslint-disable-next-line no-constant-condition
  while (true) {
    node = parser.consume(1);

    switch (node.type) {
      case Type.SemicolonToken:
        return {type: Type.AtRuleNode, name, prelude, value: null};

      case Type.EOFToken:
        parser.error();
        return {type: Type.AtRuleNode, name, prelude, value: null};

      case Type.LeftCurlyBracketToken:
        return {
          type: Type.AtRuleNode,
          name,
          prelude,
          value: consumeSimpleBlock(parser),
        };

      case Type.BlockNode:
        if (node.source.type === Type.LeftCurlyBracketToken) {
          return {type: Type.AtRuleNode, name, prelude, value: node};
        }

      // eslint-disable-next-line no-fallthrough
      default:
        parser.reconsume();
        prelude.push(consumeComponentValue(parser));
        break;
    }
  }
}

// § 5.4.3. Consume a qualified rule
function consumeQualifiedRule(
  parser: Parser<Node>
): ParseResult<QualifiedRuleNode> {
  let node = parser.value;
  const prelude: Node[] = [];

  // eslint-disable-next-line no-constant-condition
  while (true) {
    node = parser.consume(1);

    switch (node.type) {
      case Type.EOFToken:
        parser.error();
        return PARSE_ERROR;

      case Type.LeftCurlyBracketToken:
        return {
          type: Type.QualifiedRuleNode,
          prelude,
          value: consumeSimpleBlock(parser),
        };

      case Type.BlockNode:
        if (node.source.type === Type.LeftCurlyBracketToken) {
          return {
            type: Type.QualifiedRuleNode,
            prelude,
            value: node,
          };
        }

      // eslint-disable-next-line no-fallthrough
      default:
        parser.reconsume();
        prelude.push(consumeComponentValue(parser));
        break;
    }
  }
}

// § 5.4.4. Consume a style block’s contents
function consumeStyleBlock(parser: Parser<Node>): StyleBlock {
  const rules: Array<AtRuleNode | QualifiedRuleNode> = [];
  const declarations: DeclarationNode[] = [];

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const node = parser.consume(1);

    switch (node.type) {
      case Type.WhitespaceToken:
      case Type.SemicolonToken:
        // Do nothing
        break;

      case Type.EOFToken:
        return {
          type: BlockType.StyleBlock,
          value: [...declarations, ...rules],
        };

      case Type.AtKeywordToken:
        parser.reconsume();
        rules.push(consumeAtRule(parser));
        break;

      case Type.IdentToken: {
        const temp: Node[] = [node];

        let next = parser.at(1);
        while (
          next.type !== Type.SemicolonToken &&
          next.type !== Type.EOFToken
        ) {
          temp.push(consumeComponentValue(parser));
          next = parser.at(1);
        }

        const declaration = consumeDeclaration(createNodeParser(temp));
        if (declaration !== PARSE_ERROR) {
          declarations.push(declaration);
        }
        break;
      }

      case Type.DelimToken: {
        if (node.value === '&') {
          parser.reconsume();
          const rule = consumeQualifiedRule(parser);
          if (rule !== PARSE_ERROR) {
            rules.push(rule);
          }
          break;
        }
      }

      // eslint-disable-next-line no-fallthrough
      default: {
        parser.error();
        parser.reconsume();

        let next = parser.at(1);
        while (
          next.type !== Type.SemicolonToken &&
          next.type !== Type.EOFToken
        ) {
          consumeComponentValue(parser);
          next = parser.at(1);
        }

        break;
      }
    }
  }
}

// § 5.4.5. Consume a list of declarations
function consumeDeclarationList(parser: Parser<Node>): DeclarationListBlock {
  const declarations: Array<AtRuleNode | DeclarationNode> = [];

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const node = parser.consume(1);

    switch (node.type) {
      case Type.WhitespaceToken:
      case Type.SemicolonToken:
        // Do nothing
        break;

      case Type.EOFToken:
        return {type: BlockType.DeclarationList, value: declarations};

      case Type.AtKeywordToken:
        parser.reconsume();
        declarations.push(consumeAtRule(parser));
        break;

      case Type.IdentToken: {
        const temp: Node[] = [node];

        let next = parser.at(1);
        while (
          next.type !== Type.SemicolonToken &&
          next.type !== Type.EOFToken
        ) {
          temp.push(consumeComponentValue(parser));
          next = parser.at(1);
        }

        const declaration = consumeDeclaration(createNodeParser(temp));
        if (declaration !== PARSE_ERROR) {
          declarations.push(declaration);
        }
        break;
      }

      default: {
        parser.error();
        parser.reconsume();

        let next = parser.at(1);
        while (
          next.type !== Type.SemicolonToken &&
          next.type !== Type.EOFToken
        ) {
          consumeComponentValue(parser);
          next = parser.at(1);
        }

        break;
      }
    }
  }
}

// § 5.4.6. Consume a declaration
function consumeDeclaration(
  parser: Parser<Node>
): ParseResult<DeclarationNode> {
  const node = parser.consume(1);
  if (node.type !== Type.IdentToken) {
    throw new Error(`Unexpected type ${node.type}`);
  }

  const name = node.value;
  const value: Node[] = [];
  let important = false;

  consumeWhitespace(parser);

  if (parser.at(1).type !== Type.ColonToken) {
    parser.error();
    return PARSE_ERROR;
  }
  parser.consume(1);
  consumeWhitespace(parser);

  while (parser.at(1).type !== Type.EOFToken) {
    value.push(consumeComponentValue(parser));
  }

  const secondToLastValue = value[value.length - 2];
  const lastValue = value[value.length - 1];

  if (
    secondToLastValue &&
    secondToLastValue.type === Type.DelimToken &&
    secondToLastValue.value === '!' &&
    lastValue.type === Type.IdentToken &&
    lastValue.value.toLowerCase() === 'important'
  ) {
    important = true;
    value.splice(value.length - 2);
  }

  return {type: Type.DeclarationNode, name, value, important};
}

// § 5.4.7. Consume a component value
function consumeComponentValue(parser: Parser<Node>): Node {
  const node = parser.consume(1);

  switch (node.type) {
    case Type.LeftCurlyBracketToken:
    case Type.LeftSquareBracketToken:
    case Type.LeftParenthesisToken:
      return consumeSimpleBlock(parser);

    case Type.FunctionToken:
      return consumeFunction(parser);

    default:
      return node;
  }
}

// § 5.4.8. Consume a simple block
function consumeSimpleBlock(parser: Parser<Node>): BlockNode {
  let node = parser.value;

  const source = node;
  const endToken = ENDING_TOKEN_MAP[source.type];
  if (!endToken) {
    throw new Error(`Unexpected type ${node.type}`);
  }

  const value: Node[] = [];

  // eslint-disable-next-line no-constant-condition
  while (true) {
    node = parser.consume(1);

    switch (node.type) {
      case endToken:
        return {
          type: Type.BlockNode,
          source,
          value: {type: BlockType.SimpleBlock, value},
        };

      case Type.EOFToken:
        parser.error();
        return {
          type: Type.BlockNode,
          source,
          value: {type: BlockType.SimpleBlock, value},
        };

      default:
        parser.reconsume();
        value.push(consumeComponentValue(parser));
        break;
    }
  }
}

// § 5.4.9. Consume a function
function consumeFunction(parser: Parser<Node>): Node {
  let node = parser.value;
  if (node.type !== Type.FunctionToken) {
    throw new Error(`Unexpected type ${node.type}`);
  }

  const name = node.value;
  const value: Node[] = [];

  // eslint-disable-next-line no-constant-condition
  while (true) {
    node = parser.consume(1);

    switch (node.type as Type) {
      case Type.RightParenthesisToken:
        return {type: Type.FunctionNode, name, value};

      case Type.EOFToken:
        parser.error();
        return {type: Type.FunctionNode, name, value};

      default:
        parser.reconsume();
        value.push(consumeComponentValue(parser));
        break;
    }
  }
}

export function isEOF(parser: Parser<Node>): boolean {
  consumeWhitespace(parser);
  return parser.at(1).type === Type.EOFToken;
}

const BLOCK_MAP: {[key in Type]?: [string, string]} = {
  [Type.LeftCurlyBracketToken]: ['{', '}'],
  [Type.LeftSquareBracketToken]: ['[', ']'],
  [Type.LeftParenthesisToken]: ['(', ')'],
};

function serializeInternal(node: Node, level: number): string {
  switch (node.type) {
    case Type.AtRuleNode:
      return `@${node.name} ${node.prelude
        .map(n => serializeInternal(n, 0))
        .join('')}${node.value ? serializeInternal(node.value, level) : ''}`;

    case Type.QualifiedRuleNode:
      return `${node.prelude
        .map(n => serializeInternal(n, 0))
        .join('')}${serializeInternal(node.value, level)}`;

    case Type.BlockNode: {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const [start, end] = BLOCK_MAP[node.source.type]!;
      return `${start}${serializeBlock(node.value, level)}${end}`;
    }

    case Type.FunctionNode:
      return `${node.name}(${node.value
        .map(n => serializeInternal(n, 0))
        .join('')})`;

    case Type.DeclarationNode:
      return `${node.name}:${node.value
        .map(n => serializeInternal(n, 0))
        .join('')}${node.important ? ' !important' : ''}`;

    case Type.WhitespaceToken:
      return ' ';

    case Type.SemicolonToken:
      return ';';

    case Type.ColonToken:
      return ':';

    case Type.HashToken:
      return '#' + node.value;

    case Type.IdentToken:
      return node.value;

    case Type.DimensionToken:
      return node.value + node.unit;

    case Type.DelimToken:
      return node.value;

    case Type.NumberToken:
      return node.value;

    case Type.StringToken:
      return `"${node.value}"`;

    case Type.CommaToken:
      return ',';

    case Type.URLToken:
      return 'url(' + node.value + ')';

    case Type.AtKeywordToken:
      return '@' + node.value;

    case Type.PercentageToken:
      return node.value + '%';

    default:
      throw new Error(`Unsupported token ${node.type}`);
  }
}

export function serializeBlock(block: Block, level?: number) {
  return block.value
    .map(node => {
      let res = serializeInternal(node, level || 0);
      if (
        node.type === Type.DeclarationNode &&
        block.type !== BlockType.SimpleBlock
      ) {
        res += ';';
      }
      return res;
    })
    .join('');
}

export function serialize(node: Node): string {
  return serializeInternal(node, 0);
}
