"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.transformFileImports = exports.transformEsmImports = exports.scanCodeImportsExports = void 0;
const util_1 = require("./util");
const scan_imports_1 = require("./scan-imports");
const { parse } = require('es-module-lexer');
const WEBPACK_MAGIC_COMMENT_REGEX = /\/\*[\s\S]*?\*\//g;
function spliceString(source, withSlice, start, end) {
    return source.slice(0, start) + (withSlice || '') + source.slice(end);
}
async function scanCodeImportsExports(code) {
    const [imports] = await parse(code);
    return imports.filter((imp) => {
        //imp.d = -2 = import.meta.url = we can skip this for now
        if (imp.d === -2) {
            return false;
        }
        // imp.d > -1 === dynamic import
        if (imp.d > -1) {
            const importStatement = code.substring(imp.s, imp.e);
            return !!scan_imports_1.matchDynamicImportValue(importStatement);
        }
        return true;
    });
}
exports.scanCodeImportsExports = scanCodeImportsExports;
async function transformEsmImports(_code, replaceImport) {
    const imports = await scanCodeImportsExports(_code);
    let rewrittenCode = _code;
    for (const imp of imports.reverse()) {
        let spec = rewrittenCode.substring(imp.s, imp.e);
        let webpackMagicCommentMatches;
        if (imp.d > -1) {
            // Extracting comments from spec as they are stripped in `matchDynamicImportValue`
            webpackMagicCommentMatches = spec.match(WEBPACK_MAGIC_COMMENT_REGEX);
            spec = scan_imports_1.matchDynamicImportValue(spec) || '';
        }
        let rewrittenImport = replaceImport(spec);
        if (imp.d > -1) {
            rewrittenImport = webpackMagicCommentMatches
                ? `${webpackMagicCommentMatches.join(' ')} ${JSON.stringify(rewrittenImport)}`
                : JSON.stringify(rewrittenImport);
        }
        rewrittenCode = spliceString(rewrittenCode, rewrittenImport, imp.s, imp.e);
    }
    return rewrittenCode;
}
exports.transformEsmImports = transformEsmImports;
async function transformHtmlImports(code, replaceImport) {
    let rewrittenCode = code;
    let match;
    const jsImportRegex = new RegExp(util_1.HTML_JS_REGEX);
    while ((match = jsImportRegex.exec(rewrittenCode))) {
        const [, scriptTag, scriptCode] = match;
        // Only transform a script element if it contains inlined code / is not empty.
        if (scriptCode.trim()) {
            rewrittenCode = spliceString(rewrittenCode, await transformEsmImports(scriptCode, replaceImport), match.index + scriptTag.length, match.index + scriptTag.length + scriptCode.length);
        }
    }
    const cssImportRegex = new RegExp(util_1.HTML_STYLE_REGEX);
    while ((match = cssImportRegex.exec(rewrittenCode))) {
        const [, styleTag, styleCode] = match;
        // Only transform a script element if it contains inlined code / is not empty.
        if (styleCode.trim()) {
            rewrittenCode = spliceString(rewrittenCode, await transformCssImports(styleCode, replaceImport), match.index + styleTag.length, match.index + styleTag.length + styleCode.length);
        }
    }
    return rewrittenCode;
}
async function transformCssImports(code, replaceImport) {
    let rewrittenCode = code;
    let match;
    const importRegex = new RegExp(util_1.CSS_REGEX);
    while ((match = importRegex.exec(rewrittenCode))) {
        const [fullMatch, spec] = match;
        // Only transform a script element if it contains inlined code / is not empty.
        rewrittenCode = spliceString(rewrittenCode, 
        // CSS doesn't support proxy files, so always point to the original file
        `@import "${replaceImport(spec).replace('.proxy.js', '')}";`, match.index, match.index + fullMatch.length);
    }
    return rewrittenCode;
}
async function transformFileImports({ baseExt, contents }, replaceImport) {
    if (baseExt === '.js' || baseExt === '.ts') {
        return transformEsmImports(contents, replaceImport);
    }
    if (baseExt === '.html') {
        return transformHtmlImports(contents, replaceImport);
    }
    if (baseExt === '.css') {
        return transformCssImports(contents, replaceImport);
    }
    throw new Error(`Incompatible filetype: cannot scan ${baseExt} files for ESM imports. This is most likely an error within Snowpack.`);
}
exports.transformFileImports = transformFileImports;