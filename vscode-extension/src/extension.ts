import * as vscode from 'vscode';
import { OIDCClient } from './auth/oidcClient';
import { BrokerClient } from './broker/brokerClient';
import { RemoteConnection } from './remote/connection';
import { TerminalProvider } from './terminal/terminalProvider';
import { FileSystemProvider } from './filesystem/filesystemProvider';

export function activate(context: vscode.ExtensionContext) {
    console.log('Purdue AF extension is now active!');

    // Initialize components
    const oidcClient = new OIDCClient();
    const brokerClient = new BrokerClient();
    const remoteConnection = new RemoteConnection();
    const terminalProvider = new TerminalProvider(remoteConnection);
    const filesystemProvider = new FileSystemProvider(remoteConnection);

    // Status bar item
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.text = "$(server) Purdue AF";
    statusBarItem.command = 'purdueAf.connect';
    statusBarItem.show();

    // Connect command
    const connectCommand = vscode.commands.registerCommand('purdueAf.connect', async () => {
        try {
            statusBarItem.text = "$(loading~spin) Connecting...";
            statusBarItem.command = undefined;

            // Start OIDC flow
            const authUrl = await oidcClient.startAuth();
            
            // Open browser
            await vscode.env.openExternal(vscode.Uri.parse(authUrl));

            // Wait for callback
            const tokens = await oidcClient.waitForCallback();
            
            // Create session with broker
            const session = await brokerClient.createSession(tokens.accessToken, tokens.refreshToken);
            
            // Connect to tunnel
            await remoteConnection.connect(session);
            
            // Register terminal provider
            vscode.window.registerTerminalProfileProvider('jupyter-cluster', terminalProvider);
            
            // Register filesystem provider
            vscode.workspace.registerFileSystemProvider('jupyter-cluster', filesystemProvider);

            // Update status
            statusBarItem.text = "$(check) Connected to Purdue AF";
            statusBarItem.command = 'purdueAf.disconnect';
            
            vscode.window.showInformationMessage('Successfully connected to Purdue AF!');

        } catch (error) {
            statusBarItem.text = "$(error) Connection Failed";
            statusBarItem.command = 'purdueAf.connect';
            
            vscode.window.showErrorMessage(`Failed to connect to Purdue AF: ${error}`);
        }
    });

    // Disconnect command
    const disconnectCommand = vscode.commands.registerCommand('purdueAf.disconnect', async () => {
        try {
            await remoteConnection.disconnect();
            await brokerClient.deleteSession();
            
            statusBarItem.text = "$(server) Purdue AF";
            statusBarItem.command = 'purdueAf.connect';
            
            vscode.window.showInformationMessage('Disconnected from Purdue AF');
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to disconnect: ${error}`);
        }
    });

    // Register commands
    context.subscriptions.push(connectCommand);
    context.subscriptions.push(disconnectCommand);
    context.subscriptions.push(statusBarItem);

    // Auto-connect if configured
    const config = vscode.workspace.getConfiguration('purdueAf');
    if (config.get('autoConnect', false)) {
        vscode.commands.executeCommand('purdueAf.connect');
    }
}

export function deactivate() {
    console.log('Purdue AF extension is now deactivated');
}

