/*
 * vfs.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Defines virtual file system interface that our code will operate upon and
 * factory method to expose real file system as virtual file system
 */

/* eslint-disable no-dupe-class-members */

// * NOTE * except tests, this should be only file that import "fs"
import * as chokidar from 'chokidar';
import * as fs from 'fs';

import { ConsoleInterface, NullConsole } from './console';

export type Listener = (
    eventName: 'add' | 'addDir' | 'change' | 'unlink' | 'unlinkDir',
    path: string,
    stats?: Stats
) => void;

export interface FileWatcher {
    close(): void;
}

export interface Stats {
    size: number;

    isFile(): boolean;
    isDirectory(): boolean;
    isBlockDevice(): boolean;
    isCharacterDevice(): boolean;
    isSymbolicLink(): boolean;
    isFIFO(): boolean;
    isSocket(): boolean;
}

export interface VirtualFileSystem {
    existsSync(path: string): boolean;
    mkdirSync(path: string): void;
    chdir(path: string): void;
    readdirSync(path: string): string[];
    readFileSync(path: string, encoding?: null): Buffer;
    readFileSync(path: string, encoding: string): string;
    readFileSync(path: string, encoding?: string | null): string | Buffer;
    writeFileSync(path: string, data: string | Buffer, encoding: string | null): void;
    statSync(path: string): Stats;
    unlinkSync(path: string): void;
    realpathSync(path: string): string;
    getModulePath(): string;
    createFileSystemWatcher(paths: string[], event: 'all', listener: Listener): FileWatcher;
}

/**
 * expose real file system as virtual file system
 * @param console console to log messages
 */
export function createFromRealFileSystem(console?: ConsoleInterface): VirtualFileSystem {
    return new FileSystem(console ?? new NullConsole());
}

const _isMacintosh = process.platform === 'darwin';
const _isLinux = process.platform === 'linux';

class FileSystem implements VirtualFileSystem {
    constructor(private _console: ConsoleInterface) {}

    existsSync(path: string) {
        return fs.existsSync(path);
    }
    mkdirSync(path: string) {
        fs.mkdirSync(path);
    }
    chdir(path: string) {
        process.chdir(path);
    }
    readdirSync(path: string) {
        return fs.readdirSync(path);
    }
    readFileSync(path: string, encoding?: null): Buffer;
    readFileSync(path: string, encoding: string): string;
    readFileSync(path: string, encoding?: string | null): Buffer | string;
    readFileSync(path: string, encoding: string | null = null) {
        return fs.readFileSync(path, { encoding });
    }
    writeFileSync(path: string, data: string | Buffer, encoding: string | null) {
        fs.writeFileSync(path, data, { encoding });
    }
    statSync(path: string) {
        return fs.statSync(path);
    }
    unlinkSync(path: string) {
        fs.unlinkSync(path);
    }
    realpathSync(path: string) {
        return fs.realpathSync(path);
    }

    getModulePath(): string {
        // The entry point to the tool should have set the __rootDirectory
        // global variable to point to the directory that contains the
        // typeshed-fallback directory.
        return (global as any).__rootDirectory;
    }

    createFileSystemWatcher(paths: string[], event: 'all', listener: Listener): FileWatcher {
        return this._createBaseFileSystemWatcher(paths).on(event, listener);
    }

    private _createBaseFileSystemWatcher(paths: string[]): chokidar.FSWatcher {
        // The following options are copied from VS Code source base. It also
        // uses chokidar for its file watching.
        const watcherOptions: chokidar.WatchOptions = {
            ignoreInitial: true,
            ignorePermissionErrors: true,
            followSymlinks: true, // this is the default of chokidar and supports file events through symlinks
            interval: 1000, // while not used in normal cases, if any error causes chokidar to fallback to polling, increase its intervals
            binaryInterval: 1000,
            disableGlobbing: true // fix https://github.com/Microsoft/vscode/issues/4586
        };

        if (_isMacintosh) {
            // Explicitly disable on MacOS because it uses up large amounts of memory
            // and CPU for large file hierarchies, resulting in instability and crashes.
            watcherOptions.usePolling = false;
        }

        const excludes: string[] = [];
        if (_isMacintosh || _isLinux) {
            if (paths.some(path => path === '' || path === '/')) {
                excludes.push('/dev/**');
                if (_isLinux) {
                    excludes.push('/proc/**', '/sys/**');
                }
            }
        }
        watcherOptions.ignored = excludes;

        const watcher = chokidar.watch(paths, watcherOptions);
        watcher.on('error', _ => {
            this._console.log('Error returned from file system watcher.');
        });

        // Detect if for some reason the native watcher library fails to load
        if (_isMacintosh && !watcher.options.useFsEvents) {
            this._console.log('Watcher could not use native fsevents library. File system watcher disabled.');
        }

        return watcher;
    }
}
