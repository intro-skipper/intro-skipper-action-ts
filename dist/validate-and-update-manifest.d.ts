type Manifest = {
    guid: string;
    name: string;
    overview: string;
    description: string;
    owner: string;
    category: string;
    imageUrl: string;
    versions: Version[];
};
type Version = {
    version: string;
    changelog: string;
    targetAbi: string;
    sourceUrl: string;
    checksum: string;
    timestamp: string;
};
export declare function updateManifest(): Promise<void>;
export declare function updateDocsVersion(content: string, currentVersion?: string): {
    updatedContent: string;
    wasUpdated: boolean;
};
export declare function cleanUpOldReleases(jsonData: Manifest[]): Manifest[];
export declare function filterVersions(versions: string[], versionPattern: string): string | undefined;
export {};
