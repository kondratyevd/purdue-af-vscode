import * as vscode from 'vscode';
import { RemoteConnection } from '../remote/connection';

export class FileSystemProvider implements vscode.FileSystemProvider {
    private _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._onDidChangeFile.event;

    constructor(private remoteConnection: RemoteConnection) {}

    watch(_uri: vscode.Uri, _options: { recursive: boolean; excludes: string[] }): vscode.Disposable {
        // File watching not implemented in this simplified version
        return new vscode.Disposable(() => {});
    }

    stat(uri: vscode.Uri): vscode.FileStat | Promise<vscode.FileStat> {
        return this.getFileInfo(uri.path);
    }

    readDirectory(uri: vscode.Uri): [string, vscode.FileType][] | Promise<[string, vscode.FileType][]> {
        return this.listDirectory(uri.path);
    }

    createDirectory(uri: vscode.Uri): void | Promise<void> {
        return this.createDir(uri.path);
    }

    readFile(uri: vscode.Uri): Uint8Array | Promise<Uint8Array> {
        return this.readFileContent(uri.path);
    }

    writeFile(uri: vscode.Uri, content: Uint8Array, _options: { create: boolean; overwrite: boolean }): void | Promise<void> {
        return this.writeFileContent(uri.path, Buffer.from(content).toString());
    }

    delete(uri: vscode.Uri, options: { recursive: boolean }): void | Promise<void> {
        return this.deleteFile(uri.path, options.recursive);
    }

    rename(oldUri: vscode.Uri, newUri: vscode.Uri, _options: { overwrite: boolean }): void | Promise<void> {
        return this.renameFile(oldUri.path, newUri.path);
    }

    private async getFileInfo(path: string): Promise<vscode.FileStat> {
        try {
            await this.remoteConnection.sendFileOperation('stat', path);
            // Parse output to determine file type and size
            // This is simplified - in practice you'd parse the actual stat output
            return {
                type: path.endsWith('/') ? vscode.FileType.Directory : vscode.FileType.File,
                ctime: Date.now(),
                mtime: Date.now(),
                size: 0
            };
        } catch (error) {
            throw vscode.FileSystemError.FileNotFound(path);
        }
    }

    private async listDirectory(path: string): Promise<[string, vscode.FileType][]> {
        try {
            const output = await this.remoteConnection.sendFileOperation('list', path);
            // Parse output to get directory listing
            // This is simplified - in practice you'd parse the actual ls output
            const lines = output.split('\n').filter(line => line.trim());
            return lines.map(line => {
                const isDir = line.startsWith('d');
                return [line.split(' ').pop() || '', isDir ? vscode.FileType.Directory : vscode.FileType.File];
            });
        } catch (error) {
            throw vscode.FileSystemError.FileNotFound(path);
        }
    }

    private async createDir(path: string): Promise<void> {
        try {
            await this.remoteConnection.sendCommand('mkdir', ['-p', path]);
        } catch (error) {
            throw vscode.FileSystemError.Unavailable(path);
        }
    }

    private async readFileContent(path: string): Promise<Uint8Array> {
        try {
            const content = await this.remoteConnection.sendFileOperation('read', path);
            return new TextEncoder().encode(content);
        } catch (error) {
            throw vscode.FileSystemError.FileNotFound(path);
        }
    }

    private async writeFileContent(path: string, content: string): Promise<void> {
        try {
            await this.remoteConnection.sendFileOperation('write', path, content);
        } catch (error) {
            throw vscode.FileSystemError.Unavailable(path);
        }
    }

    private async deleteFile(path: string, recursive: boolean): Promise<void> {
        try {
            const command = recursive ? 'rm' : 'rm';
            const args = recursive ? ['-rf', path] : [path];
            await this.remoteConnection.sendCommand(command, args);
        } catch (error) {
            throw vscode.FileSystemError.Unavailable(path);
        }
    }

    private async renameFile(oldPath: string, newPath: string): Promise<void> {
        try {
            await this.remoteConnection.sendCommand('mv', [oldPath, newPath]);
        } catch (error) {
            throw vscode.FileSystemError.Unavailable(oldPath);
        }
    }
}
