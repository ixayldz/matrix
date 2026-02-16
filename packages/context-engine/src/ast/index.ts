import Parser from 'web-tree-sitter';
import type { SyntaxNode, Tree } from 'web-tree-sitter';

/**
 * Supported language identifiers
 */
export type SupportedLanguage = 'typescript' | 'typescriptreact' | 'python' | 'javascript' | 'javascriptreact';

/**
 * Symbol information extracted from AST
 */
export interface ASTSymbol {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'variable' | 'const' | 'method' | 'property' | 'import' | 'export';
  line: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  signature?: string;
  docstring?: string;
  exported: boolean;
  async?: boolean;
  parent?: string;
  modifiers?: string[];
}

/**
 * Reference information for call graph
 */
export interface ASTReference {
  from: string;
  to: string;
  type: 'call' | 'extends' | 'implements' | 'import' | 'usage';
  line: number;
}

/**
 * AST parse result
 */
export interface ASTParseResult {
  symbols: ASTSymbol[];
  references: ASTReference[];
  errors: Array<{
    line: number;
    column: number;
    message: string;
  }>;
  language: SupportedLanguage;
}

/**
 * Language configuration for queries
 */
interface LanguageConfig {
  name: SupportedLanguage;
  extensions: string[];
  wasmFile: string;
  queries: {
    symbols: string;
    references: string;
    docstrings: string;
  };
}

/**
 * Language-specific tree-sitter queries
 */
const LANGUAGE_CONFIGS: Record<SupportedLanguage, LanguageConfig> = {
  typescript: {
    name: 'typescript',
    extensions: ['.ts'],
    wasmFile: 'tree-sitter-typescript.wasm',
    queries: {
      symbols: `
        (function_declaration
          name: (identifier) @name
          parameters: (formal_parameters) @params
        ) @function

        (function_signature
          name: (identifier) @name
          parameters: (formal_parameters) @params
        ) @function

        (class_declaration
          name: (type_identifier) @name
        ) @class

        (interface_declaration
          name: (type_identifier) @name
        ) @interface

        (type_alias_declaration
          name: (type_identifier) @name
        ) @type

        (method_definition
          name: (property_identifier) @name
          parameters: (formal_parameters) @params
        ) @method

        (public_field_definition
          name: (property_identifier) @name
        ) @property

        (lexical_declaration
          (variable_declarator
            name: (identifier) @name
          )
        ) @variable

        (import_statement
          source: (string) @source
        ) @import

        (export_statement) @export
      `,
      references: `
        (call_expression
          function: (identifier) @callee
        ) @call

        (call_expression
          function: (member_expression
            property: (property_identifier) @callee
          )
        ) @method_call

        (extends_clause
          value: (type_identifier) @parent
        ) @extends

        (implements_clause
          type: (type_identifier) @interface
        ) @implements
      `,
      docstrings: `
        (comment) @comment
        (string) @string
      `,
    },
  },
  typescriptreact: {
    name: 'typescriptreact',
    extensions: ['.tsx'],
    wasmFile: 'tree-sitter-tsx.wasm',
    queries: {
      symbols: `
        (function_declaration
          name: (identifier) @name
          parameters: (formal_parameters) @params
        ) @function

        (function_signature
          name: (identifier) @name
          parameters: (formal_parameters) @params
        ) @function

        (class_declaration
          name: (type_identifier) @name
        ) @class

        (interface_declaration
          name: (type_identifier) @name
        ) @interface

        (type_alias_declaration
          name: (type_identifier) @name
        ) @type

        (method_definition
          name: (property_identifier) @name
          parameters: (formal_parameters) @params
        ) @method

        (public_field_definition
          name: (property_identifier) @name
        ) @property

        (lexical_declaration
          (variable_declarator
            name: (identifier) @name
          )
        ) @variable

        (import_statement
          source: (string) @source
        ) @import

        (export_statement) @export
      `,
      references: `
        (call_expression
          function: (identifier) @callee
        ) @call

        (call_expression
          function: (member_expression
            property: (property_identifier) @callee
          )
        ) @method_call

        (extends_clause
          value: (type_identifier) @parent
        ) @extends

        (implements_clause
          type: (type_identifier) @interface
        ) @implements
      `,
      docstrings: `
        (comment) @comment
        (string) @string
      `,
    },
  },
  javascript: {
    name: 'javascript',
    extensions: ['.js'],
    wasmFile: 'tree-sitter-javascript.wasm',
    queries: {
      symbols: `
        (function_declaration
          name: (identifier) @name
          parameters: (formal_parameters) @params
        ) @function

        (class_declaration
          name: (identifier) @name
        ) @class

        (method_definition
          name: (property_identifier) @name
          parameters: (formal_parameters) @params
        ) @method

        (lexical_declaration
          (variable_declarator
            name: (identifier) @name
          )
        ) @variable

        (import_statement
          source: (string) @source
        ) @import

        (export_statement) @export
      `,
      references: `
        (call_expression
          function: (identifier) @callee
        ) @call

        (call_expression
          function: (member_expression
            property: (property_identifier) @callee
          )
        ) @method_call
      `,
      docstrings: `
        (comment) @comment
      `,
    },
  },
  javascriptreact: {
    name: 'javascriptreact',
    extensions: ['.jsx'],
    wasmFile: 'tree-sitter-jsx.wasm',
    queries: {
      symbols: `
        (function_declaration
          name: (identifier) @name
          parameters: (formal_parameters) @params
        ) @function

        (class_declaration
          name: (identifier) @name
        ) @class

        (method_definition
          name: (property_identifier) @name
          parameters: (formal_parameters) @params
        ) @method

        (lexical_declaration
          (variable_declarator
            name: (identifier) @name
          )
        ) @variable

        (import_statement
          source: (string) @source
        ) @import

        (export_statement) @export
      `,
      references: `
        (call_expression
          function: (identifier) @callee
        ) @call
      `,
      docstrings: `
        (comment) @comment
      `,
    },
  },
  python: {
    name: 'python',
    extensions: ['.py'],
    wasmFile: 'tree-sitter-python.wasm',
    queries: {
      symbols: `
        (function_definition
          name: (identifier) @name
          parameters: (parameters) @params
        ) @function

        (class_definition
          name: (identifier) @name
        ) @class

        (assignment
          left: (identifier) @name
        ) @variable

        (import_statement
          name: (dotted_name) @module
        ) @import

        (import_from_statement
          module_name: (dotted_name) @module
        ) @import
      `,
      references: `
        (call
          function: (identifier) @callee
        ) @call

        (call
          function: (attribute
            attr: (identifier) @callee
          )
        ) @method_call

        (class_definition
          (argument_list
            (identifier) @parent
          )
        ) @extends
      `,
      docstrings: `
        (expression_statement
          (string) @docstring
        )
        (comment) @comment
      `,
    },
  },
};

/**
 * AST Parser using tree-sitter for accurate code analysis
 *
 * This implements PRD Section 8.4 Tree-sitter AST Parsing with:
 * - Symbol Table (classes, functions, variables + line ranges)
 * - Reference Graph (call graph + inheritance)
 * - Error Tolerance (works despite syntax errors)
 * - Multi-language support
 */
export class ASTParser {
  private parsers: Map<SupportedLanguage, Parser> = new Map();
  private initialized: boolean = false;
  private initPromise: Promise<void> | null = null;

  /**
   * Initialize tree-sitter and load language parsers
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.doInitialize();
    await this.initPromise;
    this.initPromise = null;
  }

  private async doInitialize(): Promise<void> {
    try {
      await Parser.init();

      // Load TypeScript parser (most commonly needed)
      const tsParser = new Parser();
      const TS = await Parser.Language.load('tree-sitter-typescript.wasm');
      tsParser.setLanguage(TS);
      this.parsers.set('typescript', tsParser);
      this.parsers.set('typescriptreact', tsParser);

      // Load JavaScript parser
      const jsParser = new Parser();
      const JS = await Parser.Language.load('tree-sitter-javascript.wasm');
      jsParser.setLanguage(JS);
      this.parsers.set('javascript', jsParser);
      this.parsers.set('javascriptreact', jsParser);

      // Load Python parser
      const pyParser = new Parser();
      const Python = await Parser.Language.load('tree-sitter-python.wasm');
      pyParser.setLanguage(Python);
      this.parsers.set('python', pyParser);

      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize tree-sitter:', error);
      // Continue without tree-sitter - will fall back to regex parsing
      this.initialized = false;
    }
  }

  /**
   * Detect language from file extension
   */
  detectLanguage(filePath: string): SupportedLanguage | null {
    const ext = this.getExtension(filePath);

    for (const [lang, config] of Object.entries(LANGUAGE_CONFIGS)) {
      if (config.extensions.includes(ext)) {
        return lang as SupportedLanguage;
      }
    }

    return null;
  }

  /**
   * Parse file content and extract symbols
   */
  async parse(content: string, language: SupportedLanguage): Promise<ASTParseResult> {
    await this.initialize();

    const parser = this.parsers.get(language);
    if (!parser) {
      // Fallback to regex-based parsing if parser not available
      return this.regexFallback(content, language);
    }

    try {
      const tree = parser.parse(content);
      if (!tree) {
        return this.regexFallback(content, language);
      }

      return this.extractFromTree(tree, content, language);
    } catch (error) {
      console.error(`Tree-sitter parse error for ${language}:`, error);
      return this.regexFallback(content, language);
    }
  }

  /**
   * Parse file by path
   */
  async parseFile(filePath: string, content: string): Promise<ASTParseResult | null> {
    const language = this.detectLanguage(filePath);
    if (!language) {
      return null;
    }

    return this.parse(content, language);
  }

  /**
   * Extract symbols and references from parse tree
   */
  private extractFromTree(
    tree: Tree,
    content: string,
    language: SupportedLanguage
  ): ASTParseResult {
    const symbols: ASTSymbol[] = [];
    const references: ASTReference[] = [];
    const errors: ASTParseResult['errors'] = [];

    // Check for syntax errors
    this.collectErrors(tree.rootNode, errors);

    const lines = content.split('\n');

    // Walk the tree and extract symbols
    this.walkNode(tree.rootNode, (node) => {
      const symbol = this.extractSymbol(node);
      if (symbol) {
        symbols.push(symbol);
      }

      const ref = this.extractReference(node);
      if (ref) {
        references.push(ref);
      }
    });

    // Extract docstrings
    this.associateDocstrings(symbols, lines);

    return {
      symbols,
      references,
      errors,
      language,
    };
  }

  /**
   * Walk all nodes in the tree
   */
  private walkNode(node: SyntaxNode, callback: (node: SyntaxNode) => void): void {
    callback(node);
    for (const child of node.children) {
      this.walkNode(child, callback);
    }
  }

  /**
   * Extract symbol from syntax node
   */
  private extractSymbol(node: SyntaxNode): ASTSymbol | null {
    const nodeTypes: Record<string, ASTSymbol['kind']> = {
      'function_declaration': 'function',
      'function_definition': 'function',
      'function_signature': 'function',
      'arrow_function': 'function',
      'class_declaration': 'class',
      'class_definition': 'class',
      'interface_declaration': 'interface',
      'type_alias_declaration': 'type',
      'method_definition': 'method',
      'public_field_definition': 'property',
      'lexical_declaration': 'variable',
      'variable_declaration': 'variable',
      'import_statement': 'import',
      'export_statement': 'export',
    };

    const kind = nodeTypes[node.type];
    if (!kind) return null;

    // Find name node
    const nameNode = this.findNameNode(node, kind);
    if (!nameNode) return null;

    const name = nameNode.text;
    const line = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;

    // Extract signature
    let signature: string | undefined;
    if (['function', 'method'].includes(kind)) {
      signature = this.extractSignature(node);
    }

    // Check if exported
    const exported = this.isExported(node);

    // Check if async
    const async = this.isAsync(node);

    // Get modifiers
    const modifiers = this.getModifiers(node);

    const symbol: ASTSymbol = {
      name,
      kind,
      line,
      endLine,
      startColumn: node.startPosition.column,
      endColumn: node.endPosition.column,
      exported,
    };
    if (signature !== undefined) {
      symbol.signature = signature;
    }
    if (async) {
      symbol.async = true;
    }
    if (modifiers.length > 0) {
      symbol.modifiers = modifiers;
    }
    return symbol;
  }

  /**
   * Find the name node for a given declaration
   */
  private findNameNode(node: SyntaxNode, kind: ASTSymbol['kind']): SyntaxNode | null {
    switch (kind) {
      case 'function':
      case 'method':
        return (
          node.childForFieldName('name') ||
          node.children.find(c => c.type === 'identifier' || c.type === 'property_identifier')
        ) ?? null;
      case 'class':
      case 'interface':
      case 'type':
        return (
          node.childForFieldName('name') ||
          node.children.find(c => c.type === 'type_identifier' || c.type === 'identifier')
        ) ?? null;
      case 'variable': {
        const declaratorNode = node.children.find(c =>
          c.type === 'identifier' ||
          c.type === 'variable_declarator'
        );
        return (
          declaratorNode?.childForFieldName('name') ??
          node.children.find(c => c.type === 'identifier') ??
          null
        );
      }
      default:
        return null;
    }
  }

  /**
   * Extract function signature
   */
  private extractSignature(node: SyntaxNode): string {
    const params = node.childForFieldName('parameters');
    const returnType = node.childForFieldName('return_type');

    let sig = node.childForFieldName('name')?.text || '';

    if (params) {
      sig += params.text;
    }

    if (returnType) {
      sig += ': ' + returnType.text;
    }

    return sig;
  }

  /**
   * Check if node is exported
   */
  private isExported(node: SyntaxNode): boolean {
    // Check if parent is export_statement
    if (node.parent?.type === 'export_statement') {
      return true;
    }

    // Check for export modifier
    const modifiers = node.childForFieldName('modifiers');
    if (modifiers) {
      return modifiers.text.includes('export');
    }

    return false;
  }

  /**
   * Check if function is async
   */
  private isAsync(node: SyntaxNode): boolean {
    // Check for async keyword
    const firstChild = node.firstChild;
    if (firstChild?.text === 'async') {
      return true;
    }

    // Check modifiers
    const modifiers = node.childForFieldName('modifiers');
    if (modifiers && modifiers.text.includes('async')) {
      return true;
    }

    return false;
  }

  /**
   * Get modifiers for a declaration
   */
  private getModifiers(node: SyntaxNode): string[] {
    const modifiers: string[] = [];

    const modifiersNode = node.childForFieldName('modifiers');
    if (modifiersNode) {
      const text = modifiersNode.text;
      if (text.includes('public')) modifiers.push('public');
      if (text.includes('private')) modifiers.push('private');
      if (text.includes('protected')) modifiers.push('protected');
      if (text.includes('static')) modifiers.push('static');
      if (text.includes('readonly')) modifiers.push('readonly');
      if (text.includes('abstract')) modifiers.push('abstract');
      if (text.includes('async')) modifiers.push('async');
    }

    // Check first child for async
    if (node.firstChild?.text === 'async') {
      modifiers.push('async');
    }

    return modifiers;
  }

  /**
   * Extract reference from syntax node
   */
  private extractReference(node: SyntaxNode): ASTReference | null {
    // Call expression
    if (node.type === 'call_expression') {
      const func = node.childForFieldName('function');
      if (func) {
        return {
          from: '', // Will be filled by caller context
          to: func.text,
          type: 'call',
          line: node.startPosition.row + 1,
        };
      }
    }

    // Class extends
    if (node.type === 'extends_clause') {
      const parent = node.childForFieldName('value');
      if (parent) {
        return {
          from: '', // Will be filled by caller context
          to: parent.text,
          type: 'extends',
          line: node.startPosition.row + 1,
        };
      }
    }

    // Interface implements
    if (node.type === 'implements_clause') {
      const types = node.children.filter(c => c.type === 'type_identifier');
      if (types.length > 0) {
        return {
          from: '',
          to: types.map(t => t.text).join(', '),
          type: 'implements',
          line: node.startPosition.row + 1,
        };
      }
    }

    return null;
  }

  /**
   * Collect syntax errors from tree
   */
  private collectErrors(node: SyntaxNode, errors: ASTParseResult['errors']): void {
    if (node.isError || node.isMissing) {
      errors.push({
        line: node.startPosition.row + 1,
        column: node.startPosition.column,
        message: node.isMissing
          ? `Missing ${node.type}`
          : `Syntax error: ${node.text.slice(0, 50)}...`,
      });
    }

    for (const child of node.children) {
      this.collectErrors(child, errors);
    }
  }

  /**
   * Associate docstrings with symbols
   */
  private associateDocstrings(
    symbols: ASTSymbol[],
    lines: string[]
  ): void {
    for (const symbol of symbols) {
      const docstring = this.findDocstring(symbol.line, lines);
      if (docstring) {
        symbol.docstring = docstring;
      }
    }
  }

  /**
   * Find docstring for a symbol at given line
   */
  private findDocstring(symbolLine: number, lines: string[]): string | null {
    // Look for comment or string before the symbol
    const prevLine = symbolLine - 2; // 0-indexed, line before symbol
    if (prevLine < 0) return null;

    const prevLineText = lines[prevLine]?.trim();

    // JSDoc / Block comment
    if (prevLineText?.endsWith('*/')) {
      // Find start of comment
      let startLine = prevLine;
      while (startLine >= 0 && !lines[startLine]?.includes('/**')) {
        startLine--;
      }
      if (startLine >= 0) {
        const docLines = lines.slice(startLine, prevLine + 1);
        return docLines
          .map(l => l.trim().replace(/^\* ?/, '').replace(/^\/\*\*?/, '').replace(/\*\/$/, ''))
          .filter(l => l)
          .join('\n');
      }
    }

    // Single line comment
    if (prevLineText?.startsWith('//')) {
      return prevLineText.slice(2).trim();
    }

    // Python docstring (look on same line as def)
    const symbolLineText = lines[symbolLine - 1];
    if (symbolLineText?.includes('"""') || symbolLineText?.includes("'''")) {
      // Extract inline docstring
      const match = symbolLineText.match(/"""([\s\S]*?)"""|'''([\s\S]*?)'''/);
      if (match) {
        return (match[1] || match[2] || '').trim();
      }

      // Multi-line docstring
      const quote = symbolLineText.includes('"""') ? '"""' : "'''";
      let endLine = symbolLine;
      while (endLine < lines.length - 1) {
        if (lines[endLine]?.includes(quote) && endLine !== symbolLine - 1) {
          const docLines = lines.slice(symbolLine - 1, endLine + 1);
          return docLines
            .join('\n')
            .replace(quote, '')
            .replace(quote, '')
            .trim();
        }
        endLine++;
      }
    }

    return null;
  }

  /**
   * Fallback to regex-based parsing when tree-sitter is not available
   */
  private regexFallback(content: string, language: SupportedLanguage): ASTParseResult {
    const symbols: ASTSymbol[] = [];
    const references: ASTReference[] = [];
    const errors: ASTParseResult['errors'] = [];

    if (['typescript', 'typescriptreact', 'javascript', 'javascriptreact'].includes(language)) {
      // TypeScript/JavaScript regex parsing
      const funcRegex = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/gm;
      let match;
      while ((match = funcRegex.exec(content)) !== null) {
        const line = content.substring(0, match.index).split('\n').length;
        symbols.push({
          name: match[1]!,
          kind: 'function',
          line,
          endLine: line,
          startColumn: 0,
          endColumn: 0,
          exported: match[0].includes('export'),
          async: match[0].includes('async'),
        });
      }

      const classRegex = /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/gm;
      while ((match = classRegex.exec(content)) !== null) {
        const line = content.substring(0, match.index).split('\n').length;
        symbols.push({
          name: match[1]!,
          kind: 'class',
          line,
          endLine: line,
          startColumn: 0,
          endColumn: 0,
          exported: match[0].includes('export'),
        });
      }

      const interfaceRegex = /^(?:export\s+)?interface\s+(\w+)/gm;
      while ((match = interfaceRegex.exec(content)) !== null) {
        const line = content.substring(0, match.index).split('\n').length;
        symbols.push({
          name: match[1]!,
          kind: 'interface',
          line,
          endLine: line,
          startColumn: 0,
          endColumn: 0,
          exported: match[0].includes('export'),
        });
      }

      const typeRegex = /^(?:export\s+)?type\s+(\w+)/gm;
      while ((match = typeRegex.exec(content)) !== null) {
        const line = content.substring(0, match.index).split('\n').length;
        symbols.push({
          name: match[1]!,
          kind: 'type',
          line,
          endLine: line,
          startColumn: 0,
          endColumn: 0,
          exported: match[0].includes('export'),
        });
      }

      const arrowRegex = /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])*=>/gm;
      while ((match = arrowRegex.exec(content)) !== null) {
        const line = content.substring(0, match.index).split('\n').length;
        symbols.push({
          name: match[1]!,
          kind: 'function',
          line,
          endLine: line,
          startColumn: 0,
          endColumn: 0,
          exported: match[0].includes('export'),
          async: match[0].includes('async'),
        });
      }
    } else if (language === 'python') {
      // Python regex parsing
      const funcRegex = /^(?:async\s+)?def\s+(\w+)\s*\(/gm;
      let match;
      while ((match = funcRegex.exec(content)) !== null) {
        const line = content.substring(0, match.index).split('\n').length;
        symbols.push({
          name: match[1]!,
          kind: 'function',
          line,
          endLine: line,
          startColumn: 0,
          endColumn: 0,
          exported: !match[1]!.startsWith('_'),
          async: match[0].includes('async'),
        });
      }

      const classRegex = /^class\s+(\w+)/gm;
      while ((match = classRegex.exec(content)) !== null) {
        const line = content.substring(0, match.index).split('\n').length;
        symbols.push({
          name: match[1]!,
          kind: 'class',
          line,
          endLine: line,
          startColumn: 0,
          endColumn: 0,
          exported: !match[1]!.startsWith('_'),
        });
      }
    }

    return {
      symbols: symbols.sort((a, b) => a.line - b.line),
      references,
      errors,
      language,
    };
  }

  /**
   * Get file extension
   */
  private getExtension(filePath: string): string {
    const parts = filePath.split('.');
    return parts.length > 1 ? '.' + parts[parts.length - 1] : '';
  }

  /**
   * Check if parser is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get supported languages
   */
  getSupportedLanguages(): SupportedLanguage[] {
    return Object.keys(LANGUAGE_CONFIGS) as SupportedLanguage[];
  }

  /**
   * Get supported extensions
   */
  getSupportedExtensions(): string[] {
    return Object.values(LANGUAGE_CONFIGS).flatMap(c => c.extensions);
  }
}

// Singleton instance
let parserInstance: ASTParser | null = null;

/**
 * Get or create the global AST parser instance
 */
export async function getASTParser(): Promise<ASTParser> {
  if (!parserInstance) {
    parserInstance = new ASTParser();
    await parserInstance.initialize();
  }
  return parserInstance;
}

/**
 * Create a new AST parser instance
 */
export function createASTParser(): ASTParser {
  return new ASTParser();
}
