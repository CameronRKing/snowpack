"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateEnvModule = exports.wrapImportProxy = exports.wrapHtmlResponse = exports.wrapImportMeta = exports.getMetaUrlPath = void 0;
const path_1 = __importDefault(require("path"));
const postcss_1 = __importDefault(require("postcss"));
const postcss_modules_1 = __importDefault(require("postcss-modules"));
const logger_1 = require("../logger");
const util_1 = require("../util");
const import_sri_1 = require("./import-sri");
const SRI_CLIENT_HMR_SNOWPACK = import_sri_1.generateSRI(Buffer.from(util_1.HMR_CLIENT_CODE));
const SRI_ERROR_HMR_SNOWPACK = import_sri_1.generateSRI(Buffer.from(util_1.HMR_OVERLAY_CODE));
const importMetaRegex = /import\s*\.\s*meta/;
function getMetaUrlPath(urlPath, config) {
    return path_1.default.posix.normalize(path_1.default.posix.join('/', config.buildOptions.metaUrlPath, urlPath));
}
exports.getMetaUrlPath = getMetaUrlPath;
function wrapImportMeta({ code, hmr, env, config, }) {
    // Create Regex expressions here, since global regex has per-string state
    const importMetaHotRegex = /import\s*\.\s*meta\s*\.\s*hot/g;
    const importMetaEnvRegex = /import\s*\.\s*meta\s*\.\s*env/g;
    // Optimize: replace direct references to `import.meta.hot` by inlining undefined.
    // Do this first so that we can bail out in the next `import.meta` test.
    if (!hmr) {
        code = code.replace(importMetaHotRegex, 'undefined /* [snowpack] import.meta.hot */ ');
    }
    if (!importMetaRegex.test(code)) {
        return code;
    }
    let hmrSnippet = ``;
    if (hmr) {
        hmrSnippet = `import * as  __SNOWPACK_HMR__ from '${getMetaUrlPath('hmr-client.js', config)}';\nimport.meta.hot = __SNOWPACK_HMR__.createHotContext(import.meta.url);\n`;
    }
    let envSnippet = ``;
    if (env) {
        envSnippet = `import * as __SNOWPACK_ENV__ from '${getMetaUrlPath('env.js', config)}';\n`;
        // Optimize any direct references `import.meta.env` by inlining the ref
        code = code.replace(importMetaEnvRegex, '__SNOWPACK_ENV__');
        // If we still detect references to `import.meta`, assign `import.meta.env` to be safe
        if (importMetaRegex.test(code)) {
            envSnippet += `import.meta.env = __SNOWPACK_ENV__;\n`;
        }
    }
    return hmrSnippet + envSnippet + '\n' + code;
}
exports.wrapImportMeta = wrapImportMeta;
function wrapHtmlResponse({ code, hmr, hmrPort, isDev, config, mode, }) {
    // replace %PUBLIC_URL% (along with surrounding slashes, if any)
    code = code.replace(/\/?%PUBLIC_URL%\/?/g, isDev ? '/' : config.buildOptions.baseUrl);
    // replace %MODE%
    code = code.replace(/%MODE%/g, mode);
    const snowpackPublicEnv = getSnowpackPublicEnvVariables();
    code = code.replace(/%SNOWPACK_PUBLIC_.+?%/gi, (match) => {
        const envVariableName = match.slice(1, -1);
        if (envVariableName in snowpackPublicEnv) {
            return snowpackPublicEnv[envVariableName] || '';
        }
        logger_1.logger.warn(`Environment variable "${envVariableName}" is not set`);
        return match;
    });
    // Full Page Transformations: Only full page responses should get these transformations.
    // Any code not containing `<!DOCTYPE html>` is assumed to be an HTML fragment.
    const isFullPage = code.trim().toLowerCase().startsWith('<!doctype html>');
    if (hmr && !isFullPage && !config.buildOptions.htmlFragments) {
        throw new Error(`HTML fragment found!
HTML fragments (files not starting with "<!doctype html>") are not transformed like full HTML pages.
Add the missing doctype, or set buildOptions.htmlFragments=true if HTML fragments are expected.`);
    }
    if (hmr && isFullPage) {
        let hmrScript = ``;
        if (hmrPort) {
            hmrScript += `<script type="text/javascript">window.HMR_WEBSOCKET_PORT=${hmrPort}</script>\n`;
        }
        hmrScript += `<script type="module" integrity="${SRI_CLIENT_HMR_SNOWPACK}" src="${getMetaUrlPath('hmr-client.js', config)}"></script>`;
        if (config.devOptions.hmrErrorOverlay) {
            hmrScript += `<script type="module" integrity="${SRI_ERROR_HMR_SNOWPACK}" src="${getMetaUrlPath('hmr-error-overlay.js', config)}"></script>`;
        }
        code = util_1.appendHtmlToHead(code, hmrScript);
    }
    return code;
}
exports.wrapHtmlResponse = wrapHtmlResponse;
function generateJsonImportProxy({ code, hmr, config, }) {
    const jsonImportProxyCode = `let json = ${JSON.stringify(JSON.parse(code))};
export default json;`;
    return wrapImportMeta({ code: jsonImportProxyCode, hmr, env: false, config });
}
function generateCssImportProxy({ code, hmr, config, }) {
    const cssImportProxyCode = `// [snowpack] add styles to the page (skip if no document exists)
if (typeof document !== 'undefined') {${hmr
        ? `
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    document.head.removeChild(styleEl);
  });\n`
        : ''}
  const code = ${JSON.stringify(code)};

  const styleEl = document.createElement("style");
  const codeEl = document.createTextNode(code);
  styleEl.type = 'text/css';
  styleEl.appendChild(codeEl);
  document.head.appendChild(styleEl);
}`;
    return wrapImportMeta({ code: cssImportProxyCode, hmr, env: false, config });
}
async function generateCssModuleImportProxy({ url, code, hmr, config, }) {
    let moduleJson;
    const processor = postcss_1.default([
        postcss_modules_1.default({
            getJSON: (_, json) => {
                moduleJson = json;
            },
        }),
    ]);
    const result = await processor.process(code, {
        from: url,
        to: url + '.proxy.js',
    });
    // log any warnings that happened.
    result
        .warnings()
        .forEach((element) => logger_1.logger.warn(`${url} - ${element.text}`, { name: 'snowpack:cssmodules' }));
    // return the JS+CSS proxy file.
    return `
export let code = ${JSON.stringify(result.css)};
let json = ${JSON.stringify(moduleJson)};
export default json;
${hmr
        ? `
import * as __SNOWPACK_HMR_API__ from '${getMetaUrlPath('hmr-client.js', config)}';
import.meta.hot = __SNOWPACK_HMR_API__.createHotContext(import.meta.url);\n`
        : ``}
// [snowpack] add styles to the page (skip if no document exists)
if (typeof document !== 'undefined') {${hmr
        ? `
  import.meta.hot.dispose(() => {
    document && document.head.removeChild(styleEl);
  });\n`
        : ``}
  const styleEl = document.createElement("style");
  const codeEl = document.createTextNode(code);
  styleEl.type = 'text/css';

  styleEl.appendChild(codeEl);
  document.head.appendChild(styleEl);
}`;
}
function generateDefaultImportProxy(url) {
    return `export default ${JSON.stringify(url)};`;
}
async function wrapImportProxy({ url, code, hmr, config, }) {
    if (typeof code === 'string') {
        if (util_1.hasExtension(url, '.json')) {
            return generateJsonImportProxy({ code, hmr, config });
        }
        if (util_1.hasExtension(url, '.css')) {
            // if proxying a CSS file, remove its source map (the path no longer applies)
            const sanitized = code.replace(/\/\*#\s*sourceMappingURL=[^/]+\//gm, '');
            return util_1.hasExtension(url, '.module.css')
                ? generateCssModuleImportProxy({ url, code: sanitized, hmr, config })
                : generateCssImportProxy({ code: sanitized, hmr, config });
        }
    }
    return generateDefaultImportProxy(url);
}
exports.wrapImportProxy = wrapImportProxy;
function generateEnvModule({ mode, isSSR, }) {
    const envObject = getSnowpackPublicEnvVariables();
    envObject.MODE = mode;
    envObject.NODE_ENV = mode;
    envObject.SSR = isSSR;
    return Object.entries(envObject)
        .map(([key, val]) => {
        return `export const ${key} = ${JSON.stringify(val)};`;
    })
        .join('\n');
}
exports.generateEnvModule = generateEnvModule;
const PUBLIC_ENV_REGEX = /^SNOWPACK_PUBLIC_.+/;
function getSnowpackPublicEnvVariables() {
    const envObject = { ...process.env };
    for (const env of Object.keys(envObject)) {
        if (!PUBLIC_ENV_REGEX.test(env)) {
            delete envObject[env];
        }
    }
    return envObject;
}