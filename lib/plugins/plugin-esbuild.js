"use strict";
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
exports.esbuildPlugin = void 0;
const esbuild_1 = require("esbuild");
const colors = __importStar(require("kleur/colors"));
const path_1 = __importDefault(require("path"));
const fs_1 = require("fs");
const logger_1 = require("../logger");
let esbuildService = null;
const IS_PREACT = /from\s+['"]preact['"]/;
function checkIsPreact(filePath, contents) {
    return (filePath.endsWith('.jsx') || filePath.endsWith('.tsx')) && IS_PREACT.test(contents);
}
function getLoader(filePath) {
    const ext = path_1.default.extname(filePath);
    if (ext === '.mjs') {
        return 'js';
    }
    return ext.substr(1);
}
function esbuildPlugin(config, { input }) {
    console.log('esbuilt', input);
    return {
        name: '@snowpack/plugin-esbuild',
        resolve: {
            input,
            output: ['.js'],
        },
        async load({ filePath }) {
            var _a, _b;
            esbuildService = esbuildService || (await esbuild_1.startService());
            const contents = await fs_1.promises.readFile(filePath, 'utf8');
            const isPreact = checkIsPreact(filePath, contents);
            let jsxFactory = (_a = config.buildOptions.jsxFactory) !== null && _a !== void 0 ? _a : (isPreact ? 'h' : undefined);
            let jsxFragment = (_b = config.buildOptions.jsxFragment) !== null && _b !== void 0 ? _b : (isPreact ? 'Fragment' : undefined);
            const { code, map, warnings } = await esbuildService.transform(contents, {
                loader: getLoader(filePath),
                jsxFactory,
                jsxFragment,
                sourcefile: filePath,
                sourcemap: config.buildOptions.sourcemap,
            });
            for (const warning of warnings) {
                logger_1.logger.error(`${colors.bold('!')} ${filePath}
  ${warning.text}`);
            }
            return {
                '.js': {
                    code: code || '',
                    map,
                },
            };
        },
        cleanup() {
            esbuildService && esbuildService.stop();
        },
    };
}
exports.esbuildPlugin = esbuildPlugin;