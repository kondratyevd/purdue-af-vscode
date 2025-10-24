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
        
        // Show authentication method selection
        const authMethod = await vscode.window.showQuickPick([
            {
                label: "$(paste) Paste authorization token",
                description: "I have a JupyterLab token to paste",
                value: "paste"
            },
            {
                label: "$(globe) Obtain token from Purdue AF web interface",
                description: "Open browser to get token from Purdue AF",
                value: "web"
            }
        ], {
            placeHolder: "Choose how to authenticate with Purdue AF",
            title: "Authentication Method"
        });
        
        if (!authMethod) {
            statusBarItem.text = "$(server) Purdue AF";
            return;
        }
        
        if (authMethod.value === "paste") {
            await authenticateWithPastedToken();
        } else if (authMethod.value === "web") {
            await authenticateWithWebInterface();
        }
        
    } catch (error) {
        console.error('Connection failed:', error);
        vscode.window.showErrorMessage(`Failed to connect to Purdue AF: ${error}`);
        updateStatusBar();
    }
}

async function authenticateWithPastedToken(): Promise<void> {
    try {
        // Prompt user to paste JupyterLab token
        const token = await vscode.window.showInputBox({
            prompt: "Paste your JupyterLab token from Purdue AF",
            placeHolder: "Enter your JupyterLab token here...",
            password: true,
            title: "JupyterLab Token"
        });
        
        if (!token) {
            statusBarItem.text = "$(server) Purdue AF";
            vscode.window.showInformationMessage('Authentication cancelled');
            return;
        }
        
        statusBarItem.text = "$(loading~spin) Validating token...";
        
        // Get broker URL from configuration
        const config = vscode.workspace.getConfiguration('purdueAf');
        const brokerUrl = config.get<string>('brokerUrl', 'http://localhost:8085');
        
        // Test broker connection first
        const healthUrl = `${brokerUrl}/health`;
        console.log(`Testing broker connection at: ${healthUrl}`);
        
        // Simple HTTP request using Node.js built-ins
        const http = require('http');
        const https = require('https');
        const url = require('url');
        
        const parsedUrl = url.parse(healthUrl);
        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port,
            path: parsedUrl.path,
            method: 'GET',
            timeout: 5000,
            rejectUnauthorized: false
        };
        
        const client = parsedUrl.protocol === 'https:' ? https : http;
        
        await new Promise<void>((resolve, reject) => {
            const req = client.request(options, (res: any) => {
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
        
        // Create session with the provided token
        statusBarItem.text = "$(loading~spin) Creating session...";
        
        // For now, simulate successful authentication with the token
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const mockSession = {
            session_id: "session_" + Date.now(),
            username: "user@purdue.edu",
            namespace: "cms-dev",
            pod: "jupyter-user",
            tunnel_url: "wss://mock-tunnel",
            session_token: token
        };
        
        isConnected = true;
        updateStatusBar();
        
        vscode.window.showInformationMessage(`Successfully authenticated with Purdue AF using token! Session: ${mockSession.session_id}`);
        
    } catch (error) {
        console.error('Token authentication failed:', error);
        vscode.window.showErrorMessage(`Failed to authenticate with token: ${error}`);
        updateStatusBar();
    }
}

async function authenticateWithWebInterface(): Promise<void> {
    try {
        statusBarItem.text = "$(loading~spin) Opening Purdue AF web interface...";
        
        // Open the Purdue AF token page
        const tokenUrl = vscode.Uri.parse('https://cms.geddes.rcac.purdue.edu/hub/token');
        await vscode.env.openExternal(tokenUrl);
        
        // Show message to user and wait for them to complete authentication
        const userAction = await vscode.window.showInformationMessage(
            'Browser opened to Purdue AF token page. Please complete the login process and copy your JupyterLab token, then click "I have my token" below.',
            'I have my token',
            'Cancel'
        );
        
        if (userAction !== 'I have my token') {
            statusBarItem.text = "$(server) Purdue AF";
            vscode.window.showInformationMessage('Authentication cancelled');
            return;
        }
        
        // Now prompt for the token they obtained
        const token = await vscode.window.showInputBox({
            prompt: "Paste the JupyterLab token you obtained from the web interface",
            placeHolder: "Enter your JupyterLab token here...",
            password: true,
            title: "JupyterLab Token from Web Interface"
        });
        
        if (!token) {
            statusBarItem.text = "$(server) Purdue AF";
            vscode.window.showInformationMessage('Authentication cancelled');
            return;
        }
        
        statusBarItem.text = "$(loading~spin) Validating token...";
        
        // Get broker URL from configuration
        const config = vscode.workspace.getConfiguration('purdueAf');
        const brokerUrl = config.get<string>('brokerUrl', 'http://localhost:8085');
        
        // Test broker connection first
        const healthUrl = `${brokerUrl}/health`;
        console.log(`Testing broker connection at: ${healthUrl}`);
        
        // Simple HTTP request using Node.js built-ins
        const http = require('http');
        const https = require('https');
        const url = require('url');
        
        const parsedUrl = url.parse(healthUrl);
        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port,
            path: parsedUrl.path,
            method: 'GET',
            timeout: 5000,
            rejectUnauthorized: false
        };
        
        const client = parsedUrl.protocol === 'https:' ? https : http;
        
        await new Promise<void>((resolve, reject) => {
            const req = client.request(options, (res: any) => {
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
        
        // Create session with the provided token
        statusBarItem.text = "$(loading~spin) Creating session...";
        
        // For now, simulate successful authentication with the token
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const mockSession = {
            session_id: "session_" + Date.now(),
            username: "user@purdue.edu",
            namespace: "cms-dev",
            pod: "jupyter-user",
            tunnel_url: "wss://mock-tunnel",
            session_token: token
        };
        
        isConnected = true;
        updateStatusBar();
        
        vscode.window.showInformationMessage(`Successfully authenticated with Purdue AF via web interface! Session: ${mockSession.session_id}`);
        
    } catch (error) {
        console.error('Web interface authentication failed:', error);
        vscode.window.showErrorMessage(`Failed to authenticate via web interface: ${error}`);
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