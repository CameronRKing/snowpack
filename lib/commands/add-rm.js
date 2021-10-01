"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.rmCommand = exports.addCommand = void 0;
const httpie_1 = require("httpie");
const colors_1 = require("kleur/colors");
const path_1 = __importDefault(require("path"));
const logger_1 = require("../logger");
const util_1 = require("../util");
const remote_1 = __importDefault(require("../sources/remote"));
async function addCommand(addValue, commandOptions) {
    const { lockfile, config } = commandOptions;
    if (config.packageOptions.source !== 'remote') {
        throw new Error(`add command requires packageOptions.source="remote".`);
    }
    let [pkgName, pkgSemver] = addValue.split('@');
    const installMessage = pkgSemver ? `${pkgName}@${pkgSemver}` : pkgName;
    logger_1.logger.info(`fetching ${colors_1.cyan(installMessage)} from CDN...`);
    if (!pkgSemver || pkgSemver === 'latest') {
        const { data } = await httpie_1.send('GET', `http://registry.npmjs.org/${pkgName}/latest`);
        pkgSemver = `^${data.version}`;
    }
    logger_1.logger.info(`adding ${colors_1.cyan(colors_1.underline(`${pkgName}@${pkgSemver}`))} to your project lockfile. ${colors_1.dim(`(${util_1.LOCKFILE_NAME})`)}`);
    const addedDependency = { [pkgName]: pkgSemver };
    const lookupResponse = await util_1.remotePackageSDK.lookupBySpecifier(pkgName, pkgSemver);
    if (lookupResponse.error) {
        throw new Error(`There was a problem looking up ${pkgName}@${pkgSemver}`);
    }
    const newLockfile = util_1.convertSkypackImportMapToLockfile({
        ...lockfile === null || lockfile === void 0 ? void 0 : lockfile.dependencies,
        ...addedDependency,
    }, await util_1.remotePackageSDK.generateImportMap(addedDependency, lockfile
        ? util_1.convertLockfileToSkypackImportMap(config.packageOptions.origin, lockfile)
        : undefined));
    await util_1.writeLockfile(path_1.default.join(config.root, util_1.LOCKFILE_NAME), newLockfile);
    await remote_1.default.prepare(commandOptions);
}
exports.addCommand = addCommand;
async function rmCommand(addValue, commandOptions) {
    var _a;
    const { lockfile, config } = commandOptions;
    if (config.packageOptions.source !== 'remote') {
        throw new Error(`rm command requires packageOptions.source="remote".`);
    }
    let [pkgName] = addValue.split('@');
    logger_1.logger.info(`removing ${colors_1.cyan(pkgName)} from project lockfile...`);
    const newLockfile = util_1.convertSkypackImportMapToLockfile((_a = lockfile === null || lockfile === void 0 ? void 0 : lockfile.dependencies) !== null && _a !== void 0 ? _a : {}, await util_1.remotePackageSDK.generateImportMap({ [pkgName]: null }, lockfile
        ? util_1.convertLockfileToSkypackImportMap(config.packageOptions.origin, lockfile)
        : undefined));
    delete newLockfile.dependencies[pkgName];
    await util_1.writeLockfile(path_1.default.join(config.root, util_1.LOCKFILE_NAME), newLockfile);
    await remote_1.default.prepare(commandOptions);
}
exports.rmCommand = rmCommand;