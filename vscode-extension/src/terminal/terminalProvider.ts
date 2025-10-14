import * as vscode from 'vscode';
import { RemoteConnection } from '../remote/connection';

export class TerminalProvider implements vscode.TerminalProfileProvider {
    constructor(private remoteConnection: RemoteConnection) {}

    provideTerminalProfile(_token: vscode.CancellationToken): vscode.ProviderResult<vscode.TerminalProfile> {
        return new vscode.TerminalProfile({
            name: 'Jupyter Cluster Terminal',
            pty: new JupyterTerminal(this.remoteConnection)
        });
    }
}

class JupyterTerminal implements vscode.Pseudoterminal {
    private writeEmitter = new vscode.EventEmitter<string>();
    private closeEmitter = new vscode.EventEmitter<number>();

    onDidWrite: vscode.Event<string> = this.writeEmitter.event;
    onDidClose: vscode.Event<number> = this.closeEmitter.event;

    constructor(private remoteConnection: RemoteConnection) {}

    open(_initialDimensions: vscode.TerminalDimensions | undefined): void {
        this.writeEmitter.fire('Welcome to Jupyter Cluster Terminal\r\n');
        this.writeEmitter.fire('$ ');
    }

    close(): void {
        // Cleanup if needed
    }

    handleInput(data: string): void {
        if (data === '\r') { // Enter key
            this.writeEmitter.fire('\r\n');
            
            // Get the current command (simplified - in practice you'd track the command buffer)
            const command = this.getCurrentCommand();
            
            if (command.trim()) {
                this.executeCommand(command);
            } else {
                this.writeEmitter.fire('$ ');
            }
        } else if (data === '\u007f') { // Backspace
            this.writeEmitter.fire('\b \b');
        } else {
            this.writeEmitter.fire(data);
        }
    }

    private getCurrentCommand(): string {
        // Simplified implementation - in practice you'd track the command buffer
        return 'ls';
    }

    private async executeCommand(command: string): Promise<void> {
        try {
            const output = await this.remoteConnection.sendCommand(command);
            this.writeEmitter.fire(output);
        } catch (error) {
            this.writeEmitter.fire(`Error: ${error}\r\n`);
        }
        
        this.writeEmitter.fire('$ ');
    }

    setDimensions(_dimensions: vscode.TerminalDimensions): void {
        // Handle terminal resize if needed
    }
}
