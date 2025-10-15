import * as vscode from 'vscode';

let statusBarItem: vscode.StatusBarItem;
let isConnected = false;

export function activate(context: vscode.ExtensionContext) {
    console.log('Purdue AF extension is now active!');
    
    // Status bar item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    updateStatusBar();
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);
    
    // Register commands
    const connectCommand = vscode.commands.registerCommand('purdueAf.connect', connectToBroker);
    const disconnectCommand = vscode.commands.registerCommand('purdueAf.disconnect', disconnectFromBroker);
    
    context.subscriptions.push(connectCommand);
    context.subscriptions.push(disconnectCommand);
    
    // Auto-connect if configured
    const config = vscode.workspace.getConfiguration('purdueAf');
    if (config.get<boolean>('autoConnect', false)) {
        vscode.commands.executeCommand('purdueAf.connect');
    }
}

async function connectToBroker(): Promise<void> {
    try {
        statusBarItem.text = "$(loading~spin) Connecting to Purdue AF...";
        
        // Get broker URL from configuration
        const config = vscode.workspace.getConfiguration('purdueAf');
        const brokerUrl = config.get<string>('brokerUrl', 'http://localhost:8085');
        
        // Test broker connection first
        const healthUrl = `${brokerUrl}/health`;
        console.log(`Testing broker connection at: ${healthUrl}`);
        
        // Simple HTTP request using Node.js built-ins
        const http = require('http');
        const url = require('url');
        
        const parsedUrl = url.parse(healthUrl);
        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port,
            path: parsedUrl.path,
            method: 'GET',
            timeout: 5000
        };
        
        await new Promise<void>((resolve, reject) => {
            const req = http.request(options, (res: any) => {
                if (res.statusCode === 200) {
                    console.log('Broker health check successful');
                    resolve();
                } else {
                    reject(new Error(`Broker returned status ${res.statusCode}`));
                }
            });
            
            req.on('error', (err: any) => {
                reject(new Error(`Failed to connect to broker: ${err.message}`));
            });
            
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Connection timeout'));
            });
            
            req.end();
        });
        
        // Now start authentication
        statusBarItem.text = "$(loading~spin) Starting authentication...";
        
        const authStartUrl = `${brokerUrl}/auth/start`;
        console.log(`Starting authentication at: ${authStartUrl}`);
        
        const authParsedUrl = url.parse(authStartUrl);
        const authOptions = {
            hostname: authParsedUrl.hostname,
            port: authParsedUrl.port,
            path: authParsedUrl.path,
            method: 'GET',
            timeout: 10000
        };
        
        const authResponse = await new Promise<string>((resolve, reject) => {
            const req = http.request(authOptions, (res: any) => {
                let data = '';
                res.on('data', (chunk: any) => data += chunk);
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        resolve(data);
                    } else {
                        reject(new Error(`Auth start returned status ${res.statusCode}`));
                    }
                });
            });
            
            req.on('error', (err: any) => {
                reject(new Error(`Failed to start auth: ${err.message}`));
            });
            
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Auth start timeout'));
            });
            
            req.end();
        });
        
        const authData = JSON.parse(authResponse);
        console.log('Auth URL received:', authData.auth_url);
        console.log('State received:', authData.state);
        
        // Open browser for authentication
        statusBarItem.text = "$(loading~spin) Opening browser for authentication...";
        
        const openUrl = vscode.Uri.parse(authData.auth_url);
        await vscode.env.openExternal(openUrl);
        
        // Show message to user and wait for them to complete authentication
        const userAction = await vscode.window.showInformationMessage(
            'Browser opened for authentication. Please complete the login process in your browser, then click "I completed login" below.',
            'I completed login',
            'Cancel'
        );
        
        if (userAction !== 'I completed login') {
            statusBarItem.text = "$(server) Purdue AF";
            vscode.window.showInformationMessage('Authentication cancelled');
            return;
        }
        
        // For now, simulate successful authentication
        // TODO: Implement proper token exchange when broker callback is accessible
        statusBarItem.text = "$(loading~spin) Completing authentication...";
        
        // Simulate token exchange
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const mockTokens = {
            access_token: "mock_access_token",
            refresh_token: "mock_refresh_token",
            expires_in: 3600
        };
        
        // Create session with mock tokens
        statusBarItem.text = "$(loading~spin) Creating session...";
        
        const mockSession = {
            session_id: "mock_session_" + Date.now(),
            username: "user@example.com",
            namespace: "cms-dev",
            pod: "mock-pod",
            tunnel_url: "wss://mock-tunnel",
            session_token: "mock_session_token"
        };
        
        isConnected = true;
        updateStatusBar();
        
        vscode.window.showInformationMessage(`Successfully authenticated with Purdue AF! Session: ${mockSession.session_id}`);
        
    } catch (error) {
        console.error('Connection failed:', error);
        vscode.window.showErrorMessage(`Failed to connect to Purdue AF: ${error}`);
        updateStatusBar();
    }
}

async function disconnectFromBroker(): Promise<void> {
    try {
        isConnected = false;
        updateStatusBar();
        vscode.window.showInformationMessage('Disconnected from Purdue AF');
    } catch (error) {
        console.error('Disconnect failed:', error);
        vscode.window.showErrorMessage(`Failed to disconnect: ${error}`);
    }
}

function updateStatusBar(): void {
    if (isConnected) {
        statusBarItem.text = "$(check) Connected to Purdue AF";
        statusBarItem.command = 'purdueAf.disconnect';
    } else {
        statusBarItem.text = "$(server) Purdue AF";
        statusBarItem.command = 'purdueAf.connect';
    }
}

export function deactivate() {
    console.log('Purdue AF extension is now deactivated');
    if (isConnected) {
        disconnectFromBroker();
    }
}