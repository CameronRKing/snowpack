"use strict";
/**
 * This license applies to parts of this file originating from the
 * https://github.com/lukejacksonn/servor repository:
 *
 * MIT License
 * Copyright (c) 2019 Luke Jackson
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.command = exports.startServer = void 0;
const cacache_1 = __importDefault(require("cacache"));
const compressible_1 = __importDefault(require("compressible"));
const ssr_loader_1 = require("../ssr-loader");
const etag_1 = __importDefault(require("etag"));
const events_1 = require("events");
const fs_1 = require("fs");
const http_1 = __importDefault(require("http"));
const http2_1 = __importDefault(require("http2"));
const isbinaryfile_1 = require("isbinaryfile");
const colors = __importStar(require("kleur/colors"));
const mime_types_1 = __importDefault(require("mime-types"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const perf_hooks_1 = require("perf_hooks");
const signal_exit_1 = __importDefault(require("signal-exit"));
const stream_1 = __importDefault(require("stream"));
const url_1 = __importDefault(require("url"));
const util_1 = __importDefault(require("util"));
const zlib_1 = __importDefault(require("zlib"));
const build_import_proxy_1 = require("../build/build-import-proxy");
const build_pipeline_1 = require("../build/build-pipeline");
const file_urls_1 = require("../build/file-urls");
const import_resolver_1 = require("../build/import-resolver");
const hmr_server_engine_1 = require("../hmr-server-engine");
const logger_1 = require("../logger");
const rewrite_imports_1 = require("../rewrite-imports");
const scan_imports_1 = require("../scan-imports");
const util_2 = require("../util");
const paint_1 = require("./paint");
const FILE_BUILD_RESULT_ERROR = `Build Result Error: There was a problem with a file build result.`;
/**
 * If encoding is defined, return a string. Otherwise, return a Buffer.
 */
function encodeResponse(response, encoding) {
    if (encoding === undefined) {
        return response;
    }
    if (encoding) {
        if (typeof response === 'string') {
            return response;
        }
        else {
            return response.toString(encoding);
        }
    }
    if (typeof response === 'string') {
        return Buffer.from(response);
    }
    else {
        return response;
    }
}
function getCacheKey(fileLoc, { isSSR, env }) {
    return `${fileLoc}?env=${env}&isSSR=${isSSR ? '1' : '0'}`;
}
/**
 * A helper class for "Not Found" errors, storing data about what file lookups were attempted.
 */
class NotFoundError extends Error {
    constructor(lookups) {
        super('NOT_FOUND');
        this.lookups = lookups;
    }
}
function sendResponseFile(req, res, { contents, originalFileLoc, contentType }) {
    var _a;
    const body = Buffer.from(contents);
    const ETag = etag_1.default(body, { weak: true });
    if (originalFileLoc === null || originalFileLoc === void 0 ? void 0 : originalFileLoc.endsWith('.ts'))
        contentType = 'application/javascript';
    const headers = {
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Content-Type': contentType || 'application/octet-stream',
        ETag,
        Vary: 'Accept-Encoding',
    };
    if (req.headers['if-none-match'] === ETag) {
        res.writeHead(304, headers);
        res.end();
        return;
    }
    let acceptEncoding = req.headers['accept-encoding'] || '';
    if (((_a = req.headers['cache-control']) === null || _a === void 0 ? void 0 : _a.includes('no-transform')) ||
        ['HEAD', 'OPTIONS'].includes(req.method) ||
        !contentType ||
        !compressible_1.default(contentType)) {
        acceptEncoding = '';
    }
    // Handle gzip compression
    if (/\bgzip\b/.test(acceptEncoding) && stream_1.default.Readable.from) {
        const bodyStream = stream_1.default.Readable.from([body]);
        headers['Content-Encoding'] = 'gzip';
        res.writeHead(200, headers);
        stream_1.default.pipeline(bodyStream, zlib_1.default.createGzip(), res, function onError(err) {
            if (err) {
                res.end();
                logger_1.logger.error(`✘ An error occurred serving ${colors.bold(req.url)}`);
                logger_1.logger.error(typeof err !== 'string' ? err.toString() : err);
            }
        });
        return;
    }
    // Handle partial requests
    // TODO: This throws out a lot of hard work, and ignores any build. Improve.
    const { range } = req.headers;
    if (range) {
        if (!originalFileLoc) {
            throw new Error('Virtual files do not support partial requests');
        }
        const { size: fileSize } = fs_1.statSync(originalFileLoc);
        const [rangeStart, rangeEnd] = range.replace(/bytes=/, '').split('-');
        const start = parseInt(rangeStart, 10);
        const end = rangeEnd ? parseInt(rangeEnd, 10) : fileSize - 1;
        const chunkSize = end - start + 1;
        const fileStream = fs_1.createReadStream(originalFileLoc, { start, end });
        res.writeHead(206, {
            ...headers,
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Content-Length': chunkSize,
        });
        fileStream.pipe(res);
        return;
    }
    res.writeHead(200, headers);
    res.write(body);
    res.end();
}
function sendResponseError(req, res, status) {
    const contentType = mime_types_1.default.contentType(path_1.default.extname(req.url) || '.html');
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Accept-Ranges': 'bytes',
        'Content-Type': contentType || 'application/octet-stream',
        Vary: 'Accept-Encoding',
    };
    res.writeHead(status, headers);
    res.end();
}
function handleResponseError(req, res, err) {
    var _a;
    if (err instanceof NotFoundError) {
        // Don't log favicon "Not Found" errors. Browsers automatically request a favicon.ico file
        // from the server, which creates annoying errors for new apps / first experiences.
        if (req.url !== '/favicon.ico') {
            const attemptedFilesMessage = err.lookups.map((loc) => '  ✘ ' + loc).join('\n');
            logger_1.logger.error(`[404] ${req.url}\n${attemptedFilesMessage}`);
        }
        sendResponseError(req, res, 404);
        return;
    }
    logger_1.logger.error(err.toString());
    logger_1.logger.error(`[500] ${req.url}`, {
        // @ts-ignore
        name: (_a = err.__snowpackBuildDetails) === null || _a === void 0 ? void 0 : _a.name,
    });
    sendResponseError(req, res, 500);
    return;
}
function getServerRuntime(sp, options = {}) {
    const runtime = ssr_loader_1.createLoader({
        load: (url) => sp.loadUrl(url, { isSSR: true, allowStale: false, encoding: 'utf8' }),
    });
    if (options.invalidateOnChange !== false) {
        sp.onFileChange(({ filePath }) => {
            const url = sp.getUrlForFile(filePath);
            if (url) {
                runtime.invalidateModule(url);
            }
        });
    }
    return runtime;
}
async function startServer(commandOptions) {
    const { config } = commandOptions;
    // Start the startup timer!
    let serverStart = perf_hooks_1.performance.now();
    const { port: defaultPort, hostname, open } = config.devOptions;
    const messageBus = new events_1.EventEmitter();
    const port = await paint_1.getPort(defaultPort);
    const pkgSource = util_2.getPackageSource(config.packageOptions.source);
    const PACKAGE_PATH_PREFIX = path_1.default.posix.join(config.buildOptions.metaUrlPath, 'pkg/');
    // Reset the clock if we had to wait for the user prompt to select a new port.
    if (port !== defaultPort) {
        serverStart = perf_hooks_1.performance.now();
    }
    // Fill in any command-specific plugin methods.
    for (const p of config.plugins) {
        p.markChanged = (fileLoc) => {
            knownETags.clear();
            onWatchEvent(fileLoc);
        };
    }
    if (config.devOptions.output === 'dashboard') {
        // "dashboard": Pipe console methods to the logger, and then start the dashboard.
        logger_1.logger.debug(`attaching console.log listeners`);
        console.log = (...args) => {
            logger_1.logger.info(util_1.default.format(...args));
        };
        console.warn = (...args) => {
            logger_1.logger.warn(util_1.default.format(...args));
        };
        console.error = (...args) => {
            logger_1.logger.error(util_1.default.format(...args));
        };
        paint_1.paintDashboard(messageBus, config);
        logger_1.logger.debug(`dashboard started`);
    }
    else {
        // "stream": Log relevent events to the console.
        messageBus.on(paint_1.paintEvent.WORKER_MSG, ({ id, msg }) => {
            logger_1.logger.info(msg.trim(), { name: id });
        });
        messageBus.on(paint_1.paintEvent.SERVER_START, (info) => {
            console.log(paint_1.getServerInfoMessage(info));
        });
    }
    const inMemoryBuildCache = new Map();
    const filesBeingDeleted = new Set();
    const filesBeingBuilt = new Map();
    logger_1.logger.debug(`Using in-memory cache.`);
    logger_1.logger.debug(`Mounting directories:`, {
        task: () => {
            for (const [mountKey, mountEntry] of Object.entries(config.mount)) {
                logger_1.logger.debug(` -> '${mountKey}' as URL '${mountEntry.url}'`);
            }
        },
    });
    let sourceImportMap = await pkgSource.prepare(commandOptions);
    const readCredentials = async (cwd) => {
        const [cert, key] = await Promise.all([
            fs_1.promises.readFile(path_1.default.join(cwd, 'snowpack.crt')),
            fs_1.promises.readFile(path_1.default.join(cwd, 'snowpack.key')),
        ]);
        return {
            cert,
            key,
        };
    };
    let credentials;
    if (config.devOptions.secure) {
        try {
            logger_1.logger.debug(`reading credentials`);
            credentials = await readCredentials(config.root);
        }
        catch (e) {
            logger_1.logger.error(`✘ No HTTPS credentials found! Missing Files:  ${colors.bold('snowpack.crt')}, ${colors.bold('snowpack.key')}`);
            logger_1.logger.info(`You can automatically generate credentials for your project via either:

    - ${colors.cyan('devcert')}: ${colors.yellow('npx devcert-cli generate localhost')}
        https://github.com/davewasmer/devcert-cli (no install required)

    - ${colors.cyan('mkcert')}: ${colors.yellow('mkcert -install && mkcert -key-file snowpack.key -cert-file snowpack.crt localhost')}

        https://github.com/FiloSottile/mkcert (install required)`);
            process.exit(1);
        }
    }
    for (const runPlugin of config.plugins) {
        if (runPlugin.run) {
            logger_1.logger.debug(`starting ${runPlugin.name} run() in watch/isDev mode`);
            runPlugin
                .run({
                isDev: true,
                // @ts-ignore: internal API only
                log: (msg, data) => {
                    if (msg === 'CONSOLE_INFO') {
                        logger_1.logger.info(data.msg, { name: runPlugin.name });
                    }
                    else {
                        messageBus.emit(msg, { ...data, id: runPlugin.name });
                    }
                },
            })
                .then(() => {
                logger_1.logger.info('Command completed.', { name: runPlugin.name });
            })
                .catch((err) => {
                logger_1.logger.error(`Command exited with error code: ${err}`, { name: runPlugin.name });
                process.exit(1);
            });
        }
    }
    async function loadUrl(reqUrl, { isSSR: _isSSR, isHMR: _isHMR, allowStale: _allowStale, encoding: _encoding, } = {}) {
        var _a;
        const isSSR = _isSSR !== null && _isSSR !== void 0 ? _isSSR : false;
        // Default to HMR on, but disable HMR if SSR mode is enabled.
        const isHMR = _isHMR !== null && _isHMR !== void 0 ? _isHMR : (((_a = config.devOptions.hmr) !== null && _a !== void 0 ? _a : true) && !isSSR);
        const allowStale = _allowStale !== null && _allowStale !== void 0 ? _allowStale : false;
        const encoding = _encoding !== null && _encoding !== void 0 ? _encoding : null;
        const reqUrlHmrParam = reqUrl.includes('?mtime=') && reqUrl.split('?')[1];
        let reqPath = decodeURI(url_1.default.parse(reqUrl).pathname);
        const originalReqPath = reqPath;
        let isProxyModule = false;
        let isSourceMap = false;
        if (util_2.hasExtension(reqPath, '.proxy.js')) {
            isProxyModule = true;
            reqPath = util_2.removeExtension(reqPath, '.proxy.js');
        }
        else if (util_2.hasExtension(reqPath, '.map')) {
            isSourceMap = true;
            reqPath = util_2.removeExtension(reqPath, '.map');
        }
        if (reqPath === build_import_proxy_1.getMetaUrlPath('/hmr-client.js', config)) {
            return {
                contents: encodeResponse(util_2.HMR_CLIENT_CODE, encoding),
                originalFileLoc: null,
                contentType: 'application/javascript',
            };
        }
        if (reqPath === build_import_proxy_1.getMetaUrlPath('/hmr-error-overlay.js', config)) {
            return {
                contents: encodeResponse(util_2.HMR_OVERLAY_CODE, encoding),
                originalFileLoc: null,
                contentType: 'application/javascript',
            };
        }
        if (reqPath === build_import_proxy_1.getMetaUrlPath('/env.js', config)) {
            return {
                contents: encodeResponse(build_import_proxy_1.generateEnvModule({ mode: 'development', isSSR }), encoding),
                originalFileLoc: null,
                contentType: 'application/javascript',
            };
        }
        if (reqPath.startsWith(PACKAGE_PATH_PREFIX)) {
            try {
                const webModuleUrl = reqPath.substr(PACKAGE_PATH_PREFIX.length);
                const loadedModule = await pkgSource.load(webModuleUrl, commandOptions);
                let code = loadedModule;
                if (isProxyModule) {
                    code = await build_import_proxy_1.wrapImportProxy({ url: reqPath, code: code.toString(), hmr: isHMR, config });
                }
                let contentType = path_1.default.extname(originalReqPath)
                    ? mime_types_1.default.lookup(path_1.default.extname(originalReqPath))
                    : 'application/javascript';
                // We almost never want an 'application/octet-stream' response, so just
                // convert to JS until we have proper "raw" handling in the URL for non-JS responses.
                if (contentType === 'application/octet-stream') {
                    contentType = 'application/javascript';
                }
                return {
                    contents: encodeResponse(code, encoding),
                    originalFileLoc: null,
                    contentType,
                };
            }
            catch (err) {
                const errorTitle = `Dependency Load Error`;
                const errorMessage = err.message;
                logger_1.logger.error(`${errorTitle}: ${errorMessage}`);
                hmrEngine.broadcastMessage({
                    type: 'error',
                    title: errorTitle,
                    errorMessage,
                    fileLoc: reqPath,
                });
                throw err;
            }
        }
        const attemptedFileLoads = [];
        function attemptLoadFile(requestedFile) {
            if (attemptedFileLoads.includes(requestedFile)) {
                return Promise.resolve(null);
            }
            attemptedFileLoads.push(requestedFile);
            return fs_1.promises
                .stat(requestedFile)
                .then((stat) => (stat.isFile() ? requestedFile : null))
                .catch(() => null /* ignore */);
        }
        let requestedFile = path_1.default.parse(reqPath);
        let requestedFileExt = requestedFile.ext.toLowerCase();
        let responseFileExt = requestedFileExt;
        let isRoute = !requestedFileExt || requestedFileExt === '.html';
        async function getFileFromMount(requestedFile, mountEntry) {
            const fileLocExact = await attemptLoadFile(requestedFile);
            if (fileLocExact) {
                return {
                    fileLoc: fileLocExact,
                    isStatic: mountEntry.static,
                    isResolve: mountEntry.resolve,
                };
            }
            if (!mountEntry.static) {
                for (const potentialSourceFile of build_pipeline_1.getInputsFromOutput(requestedFile, config.plugins)) {
                    const fileLoc = await attemptLoadFile(potentialSourceFile);
                    if (fileLoc) {
                        return {
                            fileLoc,
                            isStatic: mountEntry.static,
                            isResolve: mountEntry.resolve,
                        };
                    }
                }
            }
            return null;
        }
        async function getFileFromUrl(reqPath) {
            for (const [mountKey, mountEntry] of Object.entries(config.mount)) {
                let requestedFile;
                if (mountEntry.url === '/') {
                    requestedFile = path_1.default.join(mountKey, reqPath);
                }
                else if (reqPath.startsWith(mountEntry.url)) {
                    requestedFile = path_1.default.join(mountKey, reqPath.replace(mountEntry.url, './'));
                }
                else {
                    continue;
                }
                const file = await getFileFromMount(requestedFile, mountEntry);
                if (file) {
                    return file;
                }
            }
            return null;
        }
        async function getFileFromLazyUrl(reqPath) {
            for (const [mountKey, mountEntry] of Object.entries(config.mount)) {
                let requestedFile;
                if (mountEntry.url === '/') {
                    requestedFile = path_1.default.join(mountKey, reqPath);
                }
                else if (reqPath.startsWith(mountEntry.url)) {
                    requestedFile = path_1.default.join(mountKey, reqPath.replace(mountEntry.url, './'));
                }
                else {
                    continue;
                }
                const file = (await getFileFromMount(requestedFile + '.html', mountEntry)) ||
                    (await getFileFromMount(requestedFile + 'index.html', mountEntry)) ||
                    (await getFileFromMount(requestedFile + '/index.html', mountEntry));
                if (file) {
                    requestedFileExt = '.html';
                    responseFileExt = '.html';
                    return file;
                }
            }
            return null;
        }
        let foundFile = await getFileFromUrl(reqPath);
        if (!foundFile && isRoute) {
            foundFile = await getFileFromLazyUrl(reqPath);
        }
        if (!foundFile) {
            throw new NotFoundError(attemptedFileLoads);
        }
        if (!isRoute && !isProxyModule && !isSourceMap) {
            const cleanUrl = url_1.default.parse(reqUrl).pathname;
            const cleanUrlWithMainExtension = cleanUrl && util_2.replaceExtension(cleanUrl, path_1.default.extname(cleanUrl), '.js');
            const expectedUrl = file_urls_1.getUrlForFile(foundFile.fileLoc, config);
            if (cleanUrl !== expectedUrl && cleanUrlWithMainExtension !== expectedUrl) {
                logger_1.logger.warn(`Bad Request: "${reqUrl}" should be requested as "${expectedUrl}".`);
                throw new NotFoundError([foundFile.fileLoc]);
            }
        }
        /**
         * Given a file, build it. Building a file sends it through our internal
         * file builder pipeline, and outputs a build map representing the final
         * build. A Build Map is used because one source file can result in multiple
         * built files (Example: .svelte -> .js & .css).
         */
        async function buildFile(fileLoc) {
            const existingBuilderPromise = filesBeingBuilt.get(fileLoc);
            if (existingBuilderPromise) {
                return existingBuilderPromise;
            }
            const fileBuilderPromise = (async () => {
                const builtFileOutput = await build_pipeline_1.buildFile(url_1.default.pathToFileURL(fileLoc), {
                    config,
                    isDev: true,
                    isSSR,
                    isHmrEnabled: isHMR,
                });
                inMemoryBuildCache.set(getCacheKey(fileLoc, { isSSR, env: process.env.NODE_ENV }), builtFileOutput);
                return builtFileOutput;
            })();
            filesBeingBuilt.set(fileLoc, fileBuilderPromise);
            try {
                messageBus.emit(paint_1.paintEvent.BUILD_FILE, { id: fileLoc, isBuilding: true });
                return await fileBuilderPromise;
            }
            finally {
                filesBeingBuilt.delete(fileLoc);
                messageBus.emit(paint_1.paintEvent.BUILD_FILE, { id: fileLoc, isBuilding: false });
            }
        }
        /**
         * Wrap Response: The same build result can be expressed in different ways
         * based on the URL. For example, "App.css" should return CSS but
         * "App.css.proxy.js" should return a JS representation of that CSS. This is
         * handled in the wrap step.
         */
        async function wrapResponse(code, { sourceMap, sourceMappingURL, }) {
            // transform special requests
            if (isRoute) {
                code = build_import_proxy_1.wrapHtmlResponse({
                    code: code,
                    hmr: isHMR,
                    hmrPort: hmrEngine.port !== port ? hmrEngine.port : undefined,
                    isDev: true,
                    config,
                    mode: 'development',
                });
            }
            else if (isProxyModule) {
                responseFileExt = '.js';
            }
            else if (isSourceMap && sourceMap) {
                responseFileExt = '.map';
                code = sourceMap;
            }
            // transform other files
            switch (responseFileExt) {
                case '.css': {
                    if (sourceMap)
                        code = util_2.cssSourceMappingURL(code, sourceMappingURL);
                    break;
                }
                case '.js': {
                    if (isProxyModule) {
                        code = await build_import_proxy_1.wrapImportProxy({ url: reqPath, code, hmr: isHMR, config });
                    }
                    else {
                        code = build_import_proxy_1.wrapImportMeta({ code: code, env: true, hmr: isHMR, config });
                    }
                    // source mapping
                    if (sourceMap)
                        code = util_2.jsSourceMappingURL(code, sourceMappingURL);
                    break;
                }
            }
            // by default, return file from disk
            return code;
        }
        /**
         * Resolve Imports: Resolved imports are based on the state of the file
         * system, so they can't be cached long-term with the build.
         */
        async function resolveResponseImports(fileLoc, responseExt, wrappedResponse, retryMissing = true) {
            let missingPackages = [];
            const resolveImportSpecifier = import_resolver_1.createImportResolver({
                fileLoc,
                config,
            });
            wrappedResponse = await rewrite_imports_1.transformFileImports({
                locOnDisk: fileLoc,
                contents: wrappedResponse,
                root: config.root,
                baseExt: responseExt,
            }, (spec) => {
                var _a;
                // Try to resolve the specifier to a known URL in the project
                let resolvedImportUrl = resolveImportSpecifier(spec);
                // Handle a package import
                if (!resolvedImportUrl) {
                    resolvedImportUrl = pkgSource.resolvePackageImport(spec, sourceImportMap, config);
                }
                // Handle a package import that couldn't be resolved
                if (!resolvedImportUrl) {
                    missingPackages.push(spec);
                    return spec;
                }
                // Ignore "http://*" imports
                if (util_2.isRemoteUrl(resolvedImportUrl)) {
                    return resolvedImportUrl;
                }
                // Ignore packages marked as external
                if ((_a = config.packageOptions.external) === null || _a === void 0 ? void 0 : _a.includes(resolvedImportUrl)) {
                    return spec;
                }
                // Handle normal "./" & "../" import specifiers
                const importExtName = path_1.default.posix.extname(resolvedImportUrl);
                const isProxyImport = importExtName && !['.js', '.ts'].includes(importExtName);
                const isAbsoluteUrlPath = path_1.default.posix.isAbsolute(resolvedImportUrl);
                if (isProxyImport) {
                    resolvedImportUrl = resolvedImportUrl + '.proxy.js';
                }
                // When dealing with an absolute import path, we need to honor the baseUrl
                // proxy modules may attach code to the root HTML (like style) so don't resolve
                if (isAbsoluteUrlPath && !isProxyModule) {
                    resolvedImportUrl = util_2.relativeURL(path_1.default.posix.dirname(reqPath), resolvedImportUrl);
                }
                // Make sure that a relative URL always starts with "./"
                if (!resolvedImportUrl.startsWith('.') && !resolvedImportUrl.startsWith('/')) {
                    resolvedImportUrl = './' + resolvedImportUrl;
                }
                return resolvedImportUrl;
            });
            // A missing package is a broken import, so we need to recover instantly if possible.
            if (missingPackages.length > 0) {
                // if retryMissing is true, do a fresh dependency install and then retry.
                // Only retry once, to prevent an infinite loop when a package doesn't actually exist.
                if (retryMissing) {
                    try {
                        sourceImportMap = await pkgSource.recoverMissingPackageImport(missingPackages, config);
                        return resolveResponseImports(fileLoc, responseExt, wrappedResponse, false);
                    }
                    catch (err) {
                        const errorTitle = `Dependency Install Error`;
                        const errorMessage = err.message;
                        logger_1.logger.error(`${errorTitle}: ${errorMessage}`);
                        hmrEngine.broadcastMessage({
                            type: 'error',
                            title: errorTitle,
                            errorMessage,
                            fileLoc,
                        });
                        return wrappedResponse;
                    }
                }
                // Otherwise, we need to send an error to the user, telling them about this issue.
                // A failed retry usually means that Snowpack couldn't detect the import that the browser
                // eventually saw post-build. In that case, you need to add it manually.
                const errorTitle = `Error: Import "${missingPackages[0]}" could not be resolved.`;
                const errorMessage = `If this import doesn't exist in the source file, add ${colors.bold(`"knownEntrypoints": ["${missingPackages[0]}"]`)} to your Snowpack config "packageOptions".`;
                logger_1.logger.error(`${errorTitle}\n${errorMessage}`);
                hmrEngine.broadcastMessage({
                    type: 'error',
                    title: errorTitle,
                    errorMessage,
                    fileLoc,
                });
            }
            let code = wrappedResponse;
            if (responseFileExt === '.js' && reqUrlHmrParam)
                code = await rewrite_imports_1.transformEsmImports(code, (imp) => {
                    const importUrl = path_1.default.posix.resolve(path_1.default.posix.dirname(reqPath), imp);
                    const node = hmrEngine.getEntry(importUrl);
                    if (node && node.needsReplacement) {
                        hmrEngine.markEntryForReplacement(node, false);
                        return `${imp}?${reqUrlHmrParam}`;
                    }
                    return imp;
                });
            // cleans up import paths that are modified because of HMR
            if (responseFileExt === '.js') {
                const isHmrEnabled = code.includes('import.meta.hot');
                const rawImports = await rewrite_imports_1.scanCodeImportsExports(code);
                const resolvedImports = rawImports.map((imp) => {
                    let spec = code.substring(imp.s, imp.e);
                    if (imp.d > -1) {
                        spec = scan_imports_1.matchDynamicImportValue(spec) || '';
                    }
                    spec = spec.replace(/\?mtime=[0-9]+$/, '');
                    return path_1.default.posix.resolve(path_1.default.posix.dirname(reqPath), spec);
                });
                hmrEngine.setEntry(originalReqPath, resolvedImports, isHmrEnabled);
            }
            wrappedResponse = code;
            return wrappedResponse;
        }
        /**
         * Given a build, finalize it for the response. This involves running
         * individual steps needed to go from build result to sever response,
         * including:
         *   - wrapResponse(): Wrap responses
         *   - resolveResponseImports(): Resolve all ESM imports
         */
        async function finalizeResponse(fileLoc, requestedFileExt, output) {
            // Verify that the requested file exists in the build output map.
            if (!output[requestedFileExt] || !Object.keys(output)) {
                return null;
            }
            const { code, map } = output[requestedFileExt];
            let finalResponse = code;
            // Handle attached CSS.
            if (requestedFileExt === '.js' && output['.css']) {
                finalResponse = `import '${util_2.replaceExtension(reqPath, '.js', '.css')}';\n` + finalResponse;
            }
            // Resolve imports.
            if (['.js', '.ts', '.html', '.css'].includes(requestedFileExt)) {
                finalResponse = await resolveResponseImports(fileLoc, requestedFileExt, finalResponse);
            }
            // Wrap the response.
            finalResponse = await wrapResponse(finalResponse, {
                sourceMap: map,
                sourceMappingURL: path_1.default.basename(requestedFile.base) + '.map',
            });
            // Return the finalized response.
            return finalResponse;
        }
        const { fileLoc, isStatic: _isStatic, isResolve } = foundFile;
        // Workaround: HMR plugins need to add scripts to HTML file, even if static.
        // TODO: Once plugins are able to add virtual files + imports, this will no longer be needed.
        const isStatic = _isStatic && !util_2.hasExtension(fileLoc, '.html');
        // 1. Check the hot build cache. If it's already found, then just serve it.
        let hotCachedResponse = inMemoryBuildCache.get(getCacheKey(fileLoc, { isSSR, env: process.env.NODE_ENV }));
        if (hotCachedResponse) {
            let responseContent;
            try {
                responseContent = await finalizeResponse(fileLoc, requestedFileExt, hotCachedResponse);
            }
            catch (err) {
                logger_1.logger.error(FILE_BUILD_RESULT_ERROR);
                hmrEngine.broadcastMessage({
                    type: 'error',
                    title: FILE_BUILD_RESULT_ERROR,
                    errorMessage: err.toString(),
                    fileLoc,
                    errorStackTrace: err.stack,
                });
                throw err;
            }
            if (!responseContent) {
                throw new NotFoundError([fileLoc]);
            }
            return {
                contents: encodeResponse(responseContent, encoding),
                originalFileLoc: fileLoc,
                contentType: mime_types_1.default.lookup(responseFileExt),
            };
        }
        // 2. Load the file from disk. We'll need it to check the cold cache or build from scratch.
        const fileContents = await util_2.readFile(url_1.default.pathToFileURL(fileLoc));
        // 3. Send static files directly, since they were already build & resolved at install time.
        if (!isProxyModule && isStatic) {
            // If no resolution needed, just send the file directly.
            if (!isResolve) {
                return {
                    contents: encodeResponse(fileContents, encoding),
                    originalFileLoc: fileLoc,
                    contentType: mime_types_1.default.lookup(responseFileExt),
                };
            }
            // Otherwise, finalize the response (where resolution happens) before sending.
            let responseContent;
            try {
                responseContent = await finalizeResponse(fileLoc, requestedFileExt, {
                    [requestedFileExt]: { code: fileContents },
                });
            }
            catch (err) {
                logger_1.logger.error(FILE_BUILD_RESULT_ERROR);
                hmrEngine.broadcastMessage({
                    type: 'error',
                    title: FILE_BUILD_RESULT_ERROR,
                    errorMessage: err.toString(),
                    fileLoc,
                    errorStackTrace: err.stack,
                });
                throw err;
            }
            if (!responseContent) {
                throw new NotFoundError([fileLoc]);
            }
            return {
                contents: encodeResponse(responseContent, encoding),
                originalFileLoc: fileLoc,
                contentType: mime_types_1.default.lookup(responseFileExt),
            };
        }
        // 4. Check the persistent cache. If found, serve it via a
        // "trust-but-verify" strategy. Build it after sending, and if it no longer
        // matches then assume the entire cache is suspect. In that case, clear the
        // persistent cache and then force a live-reload of the page.
        const cachedBuildData = allowStale &&
            process.env.NODE_ENV !== 'test' &&
            !filesBeingDeleted.has(fileLoc) &&
            !(await isbinaryfile_1.isBinaryFile(fileLoc)) &&
            (await cacache_1.default
                .get(util_2.BUILD_CACHE, getCacheKey(fileLoc, { isSSR, env: process.env.NODE_ENV }))
                .catch(() => null));
        if (cachedBuildData) {
            const { originalFileHash } = cachedBuildData.metadata;
            const newFileHash = etag_1.default(fileContents);
            if (originalFileHash === newFileHash) {
                // IF THIS FAILS TS CHECK: If you are changing the structure of
                // SnowpackBuildMap, be sure to also update `BUILD_CACHE` in util.ts to
                // a new unique name, to guarantee a clean cache for our users.
                const coldCachedResponse = JSON.parse(cachedBuildData.data.toString());
                inMemoryBuildCache.set(getCacheKey(fileLoc, { isSSR, env: process.env.NODE_ENV }), coldCachedResponse);
                let wrappedResponse;
                try {
                    wrappedResponse = await finalizeResponse(fileLoc, requestedFileExt, coldCachedResponse);
                }
                catch (err) {
                    logger_1.logger.error(FILE_BUILD_RESULT_ERROR);
                    hmrEngine.broadcastMessage({
                        type: 'error',
                        title: FILE_BUILD_RESULT_ERROR,
                        errorMessage: err.toString(),
                        fileLoc,
                        errorStackTrace: err.stack,
                    });
                    throw err;
                }
                if (!wrappedResponse) {
                    logger_1.logger.warn(`WARN: Failed to load ${fileLoc} from cold cache.`);
                }
                else {
                    // Trust...
                    return {
                        contents: encodeResponse(wrappedResponse, encoding),
                        originalFileLoc: fileLoc,
                        contentType: mime_types_1.default.lookup(responseFileExt),
                        // ...but verify.
                        checkStale: async () => {
                            let checkFinalBuildResult = null;
                            try {
                                checkFinalBuildResult = await buildFile(fileLoc);
                            }
                            catch (err) {
                                // safe to ignore, it will be surfaced later anyway
                            }
                            finally {
                                if (!checkFinalBuildResult ||
                                    !cachedBuildData.data.equals(Buffer.from(JSON.stringify(checkFinalBuildResult)))) {
                                    inMemoryBuildCache.clear();
                                    await cacache_1.default.rm.all(util_2.BUILD_CACHE);
                                    hmrEngine.broadcastMessage({ type: 'reload' });
                                }
                            }
                            return;
                        },
                    };
                }
            }
        }
        // 5. Final option: build the file, serve it, and cache it.
        let responseContent;
        let responseOutput;
        try {
            responseOutput = await buildFile(fileLoc);
        }
        catch (err) {
            hmrEngine.broadcastMessage({
                type: 'error',
                title: `Build Error` +
                    (err.__snowpackBuildDetails ? `: ${err.__snowpackBuildDetails.name}` : ''),
                errorMessage: err.toString(),
                fileLoc,
                errorStackTrace: err.stack,
            });
            throw err;
        }
        try {
            responseContent = await finalizeResponse(fileLoc, requestedFileExt, responseOutput);
        }
        catch (err) {
            logger_1.logger.error(FILE_BUILD_RESULT_ERROR);
            hmrEngine.broadcastMessage({
                type: 'error',
                title: FILE_BUILD_RESULT_ERROR,
                errorMessage: err.toString(),
                fileLoc,
                errorStackTrace: err.stack,
            });
            throw err;
        }
        if (!responseContent) {
            throw new NotFoundError([fileLoc]);
        }
        // Save the file to the cold cache for reuse across restarts.
        cacache_1.default
            .put(util_2.BUILD_CACHE, getCacheKey(fileLoc, { isSSR, env: process.env.NODE_ENV }), Buffer.from(JSON.stringify(responseOutput)), {
            metadata: { originalFileHash: etag_1.default(fileContents) },
        })
            .catch((err) => {
            logger_1.logger.error(`Cache Error: ${err.toString()}`);
        });
        return {
            contents: encodeResponse(responseContent, encoding),
            originalFileLoc: fileLoc,
            contentType: mime_types_1.default.lookup(responseFileExt),
        };
    }
    /**
     * A simple map to optimize the speed of our 304 responses. If an ETag check is
     * sent in the request, check if it matches the last known etag for tat file.
     *
     * Remember: This is just a nice-to-have! If we get this logic wrong, it can mean
     * stale files in the user's cache. Feel free to clear aggressively, as needed.
     */
    const knownETags = new Map();
    function matchRoute(reqUrl) {
        let reqPath = decodeURI(url_1.default.parse(reqUrl).pathname);
        const reqExt = path_1.default.extname(reqPath);
        const isRoute = !reqExt || reqExt.toLowerCase() === '.html';
        for (const route of config.routes) {
            if (route.match === 'routes' && !isRoute) {
                continue;
            }
            if (route._srcRegex.test(reqPath)) {
                return route;
            }
        }
        return null;
    }
    /**
     * Fully handle the response for a given request. This is used internally for
     * every response that the dev server sends, but it can also be used via the
     * JS API to handle most boilerplate around request handling.
     */
    async function handleRequest(req, res, { handleError } = {}) {
        let reqUrl = req.url;
        const matchedRoute = matchRoute(reqUrl);
        // If a route is matched, rewrite the URL or call the route function
        if (matchedRoute) {
            if (typeof matchedRoute.dest === 'string') {
                reqUrl = matchedRoute.dest;
            }
            else {
                return matchedRoute.dest(req, res);
            }
        }
        // Check if we can send back an optimized 304 response
        const quickETagCheck = req.headers['if-none-match'];
        const quickETagCheckUrl = reqUrl.replace(/\/$/, '/index.html');
        if (quickETagCheck && quickETagCheck === knownETags.get(quickETagCheckUrl)) {
            logger_1.logger.debug(`optimized etag! sending 304...`);
            res.writeHead(304, { 'Access-Control-Allow-Origin': '*' });
            res.end();
            return;
        }
        // Otherwise, load the file and respond if successful.
        try {
            const result = await loadUrl(reqUrl, { allowStale: true, encoding: null });
            sendResponseFile(req, res, result);
            if (result.checkStale) {
                await result.checkStale();
            }
            if (result.contents) {
                const tag = etag_1.default(result.contents, { weak: true });
                const reqPath = decodeURI(url_1.default.parse(reqUrl).pathname);
                knownETags.set(reqPath, tag);
            }
            return;
        }
        catch (err) {
            // Some consumers may want to handle/ignore errors themselves.
            if (handleError === false) {
                throw err;
            }
            handleResponseError(req, res, err);
        }
    }
    const createServer = (responseHandler) => {
        if (credentials) {
            return http2_1.default.createSecureServer({ ...credentials, allowHTTP1: true }, responseHandler);
        }
        return http_1.default.createServer(responseHandler);
    };
    const server = createServer(async (req, res) => {
        // Attach a request logger.
        res.on('finish', () => {
            const { method, url } = req;
            const { statusCode } = res;
            logger_1.logger.debug(`[${statusCode}] ${method} ${url}`);
        });
        // Otherwise, pass requests directly to Snowpack's request handler.
        handleRequest(req, res);
    })
        .on('error', (err) => {
        logger_1.logger.error(colors.red(`  ✘ Failed to start server at port ${colors.bold(port)}.`), err);
        server.close();
        process.exit(1);
    })
        .listen(port);
    const { hmrDelay } = config.devOptions;
    const hmrEngineOptions = Object.assign({ delay: hmrDelay }, config.devOptions.hmrPort ? { port: config.devOptions.hmrPort } : { server, port });
    const hmrEngine = new hmr_server_engine_1.EsmHmrEngine(hmrEngineOptions);
    signal_exit_1.default(() => {
        hmrEngine.disconnectAllClients();
    });
    // Live Reload + File System Watching
    let isLiveReloadPaused = false;
    function updateOrBubble(url, visited) {
        if (visited.has(url)) {
            return;
        }
        const node = hmrEngine.getEntry(url);
        const isBubbled = visited.size > 0;
        if (node && node.isHmrEnabled) {
            hmrEngine.broadcastMessage({ type: 'update', url, bubbled: isBubbled });
        }
        visited.add(url);
        if (node && node.isHmrAccepted) {
            // Found a boundary, no bubbling needed
        }
        else if (node && node.dependents.size > 0) {
            node.dependents.forEach((dep) => {
                hmrEngine.markEntryForReplacement(node, true);
                updateOrBubble(dep, visited);
            });
        }
        else {
            // We've reached the top, trigger a full page refresh
            hmrEngine.broadcastMessage({ type: 'reload' });
        }
    }
    function handleHmrUpdate(fileLoc, originalUrl) {
        if (isLiveReloadPaused) {
            return;
        }
        // CSS files may be loaded directly in the client (not via JS import / .proxy.js)
        // so send an "update" event to live update if thats the case.
        if (util_2.hasExtension(originalUrl, '.css') && !util_2.hasExtension(originalUrl, '.module.css')) {
            hmrEngine.broadcastMessage({ type: 'update', url: originalUrl, bubbled: false });
        }
        // Append ".proxy.js" to Non-JS files to match their registered URL in the
        // client app.
        let updatedUrl = originalUrl;
        if (!util_2.hasExtension(updatedUrl, '.js')) {
            updatedUrl += '.proxy.js';
        }
        // Check if a virtual file exists in the resource cache (ex: CSS from a
        // Svelte file) If it does, mark it for HMR replacement but DONT trigger a
        // separate HMR update event. This is because a virtual resource doesn't
        // actually exist on disk, so we need the main resource (the JS) to load
        // first. Only after that happens will the CSS exist.
        const virtualCssFileUrl = updatedUrl.replace(/.js$/, '.css');
        const virtualNode = hmrEngine.getEntry(`${virtualCssFileUrl}.proxy.js`);
        if (virtualNode) {
            hmrEngine.markEntryForReplacement(virtualNode, true);
        }
        // If the changed file exists on the page, trigger a new HMR update.
        if (hmrEngine.getEntry(updatedUrl)) {
            updateOrBubble(updatedUrl, new Set());
            return;
        }
        // Otherwise, reload the page if the file exists in our hot cache (which
        // means that the file likely exists on the current page, but is not
        // supported by HMR (HTML, image, etc)).
        if (inMemoryBuildCache.has(getCacheKey(fileLoc, { isSSR: false, env: process.env.NODE_ENV }))) {
            hmrEngine.broadcastMessage({ type: 'reload' });
            return;
        }
    }
    // Announce server has started
    const remoteIps = Object.values(os_1.default.networkInterfaces())
        .reduce((every, i) => [...every, ...(i || [])], [])
        .filter((i) => i.family === 'IPv4' && i.internal === false)
        .map((i) => i.address);
    const protocol = config.devOptions.secure ? 'https:' : 'http:';
    messageBus.emit(paint_1.paintEvent.SERVER_START, {
        protocol,
        hostname,
        port,
        remoteIp: remoteIps[0],
        startTimeMs: Math.round(perf_hooks_1.performance.now() - serverStart),
    });
    // Open the user's browser (ignore if failed)
    if (open !== 'none') {
        await util_2.openInBrowser(protocol, hostname, port, open).catch((err) => {
            logger_1.logger.debug(`Browser open error: ${err}`);
        });
    }
    // Start watching the file system.
    // Defer "chokidar" loading to here, to reduce impact on overall startup time
    const chokidar = await Promise.resolve().then(() => __importStar(require('chokidar')));
    // Allow the user to hook into this callback, if they like (noop by default)
    let onFileChangeCallback = () => { };
    // Watch src files
    async function onWatchEvent(fileLoc) {
        logger_1.logger.info(colors.cyan('File changed...'));
        onFileChangeCallback({ filePath: fileLoc });
        const updatedUrl = file_urls_1.getUrlForFile(fileLoc, config);
        if (updatedUrl) {
            handleHmrUpdate(fileLoc, updatedUrl);
            knownETags.delete(updatedUrl);
            knownETags.delete(updatedUrl + '.proxy.js');
        }
        inMemoryBuildCache.delete(getCacheKey(fileLoc, { isSSR: true, env: process.env.NODE_ENV }));
        inMemoryBuildCache.delete(getCacheKey(fileLoc, { isSSR: false, env: process.env.NODE_ENV }));
        filesBeingDeleted.add(fileLoc);
        await cacache_1.default.rm.entry(util_2.BUILD_CACHE, getCacheKey(fileLoc, { isSSR: true, env: process.env.NODE_ENV }));
        await cacache_1.default.rm.entry(util_2.BUILD_CACHE, getCacheKey(fileLoc, { isSSR: false, env: process.env.NODE_ENV }));
        for (const plugin of config.plugins) {
            plugin.onChange && plugin.onChange({ filePath: fileLoc });
        }
        filesBeingDeleted.delete(fileLoc);
    }
    const watcher = chokidar.watch(Object.keys(config.mount), {
        ignored: config.exclude,
        persistent: true,
        ignoreInitial: true,
        disableGlobbing: false,
        useFsEvents: util_2.isFsEventsEnabled(),
    });
    watcher.on('add', (fileLoc) => {
        knownETags.clear();
        onWatchEvent(fileLoc);
    });
    watcher.on('unlink', (fileLoc) => {
        knownETags.clear();
        onWatchEvent(fileLoc);
    });
    watcher.on('change', (fileLoc) => {
        onWatchEvent(fileLoc);
    });
    // Watch node_modules & rerun snowpack install if symlinked dep updates
    const symlinkedFileLocs = new Set(Object.keys(sourceImportMap.imports)
        .map((specifier) => {
        const [packageName] = util_2.parsePackageImportSpecifier(specifier);
        return util_2.resolveDependencyManifest(packageName, config.root);
    }) // resolve symlink src location
        .filter(([_, packageManifest]) => packageManifest && !packageManifest['_id']) // only watch symlinked deps for now
        .map(([fileLoc]) => `${path_1.default.dirname(fileLoc)}/**`));
    function onDepWatchEvent() {
        hmrEngine.broadcastMessage({ type: 'reload' });
    }
    const depWatcher = chokidar.watch([...symlinkedFileLocs], {
        cwd: '/',
        persistent: true,
        ignoreInitial: true,
        disableGlobbing: false,
        useFsEvents: util_2.isFsEventsEnabled(),
    });
    depWatcher.on('add', onDepWatchEvent);
    depWatcher.on('change', onDepWatchEvent);
    depWatcher.on('unlink', onDepWatchEvent);
    const sp = {
        port,
        loadUrl,
        handleRequest,
        sendResponseFile,
        sendResponseError,
        getUrlForFile: (fileLoc) => file_urls_1.getUrlForFile(fileLoc, config),
        onFileChange: (callback) => (onFileChangeCallback = callback),
        getServerRuntime: (options) => getServerRuntime(sp, options),
        async shutdown() {
            await watcher.close();
            server.close();
        },
    };
    return sp;
}
exports.startServer = startServer;
async function command(commandOptions) {
    try {
        await startServer(commandOptions);
    }
    catch (err) {
        logger_1.logger.error(err.message);
        logger_1.logger.debug(err.stack);
        process.exit(1);
    }
    return new Promise(() => { });
}
exports.command = command;