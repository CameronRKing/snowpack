import { DependencyStatsOutput, InstallOptions as EsinstallOptions, InstallTarget } from 'esinstall';
import { ImportMap, SnowpackConfig } from '../types';
interface InstallRunOptions {
    config: SnowpackConfig;
    installOptions: EsinstallOptions;
    installTargets: InstallTarget[];
    shouldPrintStats: boolean;
}
interface InstallRunResult {
    importMap: ImportMap;
    newLockfile: ImportMap | null;
    stats: DependencyStatsOutput | null;
}
export declare function run({ config, installOptions, installTargets, shouldPrintStats, }: InstallRunOptions): Promise<InstallRunResult>;
export {};