import * as core from '@actions/core';
import fs from 'fs';
export declare function incrementVersion(version: string): string;
export declare function updateVersion(csprojPath?: string, fileSystem?: typeof fs, logger?: typeof core): Promise<void>;
export declare function updateVersionsInData(data: string): {
    updatedData: string;
    newAssemblyVersion: string;
    newFileVersion: string;
};
