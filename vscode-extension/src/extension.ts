import * as vscode from 'vscode';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

let statusBarItem: vscode.StatusBarItem;
let isConnected = false;
let sshProcess: child_process.ChildProcess | null = null;
let sshConfigPath: string | null = null;

export function activate(context: vscode.ExtensionContext) {
    console.log('Purdue AF extension is now active!');
    
    // Check for Remote-SSH dependency
    checkRemoteSSHDependency();
    
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

async function checkRemoteSSHDependency(): Promise<void> {
    // Wait a bit for extensions to load
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Debug: List all installed extensions
    const allExtensions = vscode.extensions.all;
    console.log('All installed extensions:');
    allExtensions.forEach(ext => {
        if (ext.id.includes('remote') || ext.id.includes('ssh')) {
            console.log(`- ${ext.id} (${ext.extensionPath}) - Active: ${ext.isActive}`);
        }
    });
    
    // Try different possible IDs for Remote-SSH
    const possibleIds = [
        'ms-vscode-remote.remote-ssh',
        'ms-vscode-remote.remote-ssh-edit',
        'ms-vscode.remote-explorer',
        'ms-vscode-remote.remote-containers'
    ];
    
    let remoteSSH = null;
    for (const id of possibleIds) {
        remoteSSH = vscode.extensions.getExtension(id);
        if (remoteSSH) {
            console.log(`Found Remote-SSH extension: ${id}`);
            break;
        }
    }
    
    if (!remoteSSH) {
        console.log('No Remote-SSH extension found');
        const installRemoteSSH = await vscode.window.showInformationMessage(
            'The "Remote-SSH" extension is required for "Purdue AF" to function properly. Would you like to install it now?',
            'Install Remote-SSH',
            'Skip'
        );
        
        if (installRemoteSSH === 'Install Remote-SSH') {
            try {
                await vscode.commands.executeCommand('workbench.extensions.installExtension', 'ms-vscode-remote.remote-ssh');
                vscode.window.showInformationMessage('Remote-SSH installed successfully! Please reload VS Code to complete the installation.');
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to install Remote-SSH: ${error}`);
            }
        }
    } else if (!remoteSSH.isActive) {
        // Extension is installed but not active, try to activate it
        try {
            await remoteSSH.activate();
            console.log('Remote-SSH extension activated successfully');
        } catch (error) {
            console.log('Could not activate Remote-SSH extension:', error);
        }
    } else {
        console.log('Remote-SSH extension is active and ready');
    }
}

async function connectToBroker(): Promise<void> {
    try {
        statusBarItem.text = "$(loading~spin) Connecting to Purdue AF...";
        
        console.log('Starting connection process...');
        vscode.window.showInformationMessage('Starting Purdue AF connection...');
        
        // Step 1: Check token availability first
        console.log('Step 1: Checking token availability...');
        const token = await queryTokenWithOptions();
        if (!token) {
            statusBarItem.text = "$(server) Purdue AF";
            vscode.window.showErrorMessage('Token is required to connect');
            console.log('Connection cancelled: No token provided');
            return;
        }
        console.log(`Token obtained: ${token.substring(0, 10)}...`);

        // Step 2: Request username after token is confirmed
        console.log('Step 2: Requesting username...');
        const username = await queryUsername();
        if (!username) {
            statusBarItem.text = "$(server) Purdue AF";
            vscode.window.showErrorMessage('Username is required to connect');
            console.log('Connection cancelled: No username provided');
            return;
        }
        console.log(`Username obtained: ${username}`);

        // Step 3: Setup SSH tunnel with username and token
        console.log('Step 3: Setting up SSH tunnel...');
        vscode.window.showInformationMessage(`Connecting as ${username}...`);
        await setupSSHTunnel(username, token);
        
        // Step 4: Configure Remote-SSH for file access
        console.log('Step 4: Configuring Remote-SSH...');
        await configureRemoteSSH();
        
        console.log('Connection process completed successfully');
        
    } catch (error) {
        console.error('Connection failed:', error);
        vscode.window.showErrorMessage(`Failed to connect to Purdue AF: ${error}`);
        updateStatusBar();
    }
}

async function queryUsername(): Promise<string | undefined> {
    // First ask for account type
    const accountType = await vscode.window.showQuickPick([
        {
            label: "$(account) Purdue Account",
            description: "Use your Purdue username (e.g., 'jdoe')",
            value: "purdue"
        },
        {
            label: "$(globe) CERN Account", 
            description: "Use your CERN username with '-cern' suffix (e.g., 'jdoe-cern')",
            value: "cern"
        },
        {
            label: "$(server) FNAL Account",
            description: "Use your FNAL username with '-fnal' suffix (e.g., 'jdoe-fnal')",
            value: "fnal"
        }
    ], {
        placeHolder: "Select your account type",
        title: "Account Type Selection"
    });
    
    if (!accountType) {
        return undefined;
    }
    
    // Then ask for username based on account type
    let prompt = "";
    let placeholder = "";
    
    switch (accountType.value) {
        case "purdue":
            prompt = "Enter your Purdue username";
            placeholder = "jdoe";
            break;
        case "cern":
            prompt = "Enter your CERN username (without '-cern' suffix)";
            placeholder = "jdoe";
            break;
        case "fnal":
            prompt = "Enter your FNAL username (without '-fnal' suffix)";
            placeholder = "jdoe";
            break;
    }
    
    const username = await vscode.window.showInputBox({
        prompt: prompt,
        placeHolder: placeholder,
        title: "Username Input",
        validateInput: (value) => {
            if (!value || value.trim().length === 0) {
                return "Username is required";
            }
            if (value.includes('-')) {
                return "Do not include the suffix - it will be added automatically";
            }
            return null;
        }
    });
    
    if (!username) {
        return undefined;
    }
    
    // Format username based on account type
    switch (accountType.value) {
        case "purdue":
            return username.trim();
        case "cern":
            return `${username.trim()}-cern`;
        case "fnal":
            return `${username.trim()}-fnal`;
        default:
            return username.trim();
    }
}

async function queryTokenWithOptions(): Promise<string | undefined> {
    // First show the requirement message with better formatting
    const tokenReady = await vscode.window.showInformationMessage(
        '🔑 **JupyterHub Access Token Required**\n\nTo connect to Purdue AF, you need a JupyterHub access token.\n\nChoose how you\'d like to proceed:',
        { modal: true },
        '🌐 Open web page to get token',
        '📋 I have the token copied and ready to paste'
    );

    if (!tokenReady) {
        return undefined;
    }

    if (tokenReady === '🌐 Open web page to get token') {
        // Open the web interface
        vscode.env.openExternal(vscode.Uri.parse('https://cms.geddes.rcac.purdue.edu/hub/token'));
        
        // Show a message that browser opened
        vscode.window.showInformationMessage('🌐 Browser opened to get token. Please copy the token and paste it below.');
        
        // Then ask for the token
        const token = await vscode.window.showInputBox({
            prompt: 'Please paste your JupyterLab authorization token',
            placeHolder: 'Enter your token here...',
            password: true,
            title: 'JupyterLab Token',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Token is required';
                }
                return null;
            }
        });
        
        return token?.trim();
    } else {
        // Direct paste option
        const token = await vscode.window.showInputBox({
            prompt: 'Please paste your JupyterLab authorization token',
            placeHolder: 'Enter your token here...',
            password: true,
            title: 'JupyterLab Token',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Token is required';
                }
                return null;
            }
        });
        
        return token?.trim();
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
        
        // Query for username and create SSH tunnel
        statusBarItem.text = "$(loading~spin) Setting up SSH tunnel...";
        
        const username = await queryUsername();
        if (!username) {
            statusBarItem.text = "$(server) Purdue AF";
            vscode.window.showInformationMessage('Authentication cancelled - username required');
            return;
        }
        
        await setupSSHTunnel(username, token);
        
        isConnected = true;
        updateStatusBar();
        
        vscode.window.showInformationMessage(`Successfully connected to Purdue AF! SSH tunnel established and Remote-SSH configured.`);
        
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
        
        // Query for username and create SSH tunnel
        statusBarItem.text = "$(loading~spin) Setting up SSH tunnel...";
        
        const username = await queryUsername();
        if (!username) {
            statusBarItem.text = "$(server) Purdue AF";
            vscode.window.showInformationMessage('Authentication cancelled - username required');
            return;
        }
        
        await setupSSHTunnel(username, token);
        
        isConnected = true;
        updateStatusBar();
        
        vscode.window.showInformationMessage(`Successfully connected to Purdue AF! SSH tunnel established and Remote-SSH configured.`);
        
    } catch (error) {
        console.error('Web interface authentication failed:', error);
        vscode.window.showErrorMessage(`Failed to authenticate via web interface: ${error}`);
        updateStatusBar();
    }
}

async function disconnectFromBroker(): Promise<void> {
    try {
        // Clean up SSH tunnel
        if (sshProcess) {
            sshProcess.kill();
            sshProcess = null;
        }
        
        // Clean up SSH config
        if (sshConfigPath && fs.existsSync(sshConfigPath)) {
            fs.unlinkSync(sshConfigPath);
            sshConfigPath = null;
        }
        
        // Clean up workspace files
        const workspaceDir = path.join(os.tmpdir(), 'purdue-af-workspace');
        if (fs.existsSync(workspaceDir)) {
            fs.rmSync(workspaceDir, { recursive: true, force: true });
        }
        
        // Clean up notebook files
        const notebookDir = path.join(os.tmpdir(), 'purdue-af-notebooks');
        if (fs.existsSync(notebookDir)) {
            fs.rmSync(notebookDir, { recursive: true, force: true });
        }
        
        isConnected = false;
        updateStatusBar();
        vscode.window.showInformationMessage('Disconnected from Purdue AF and cleaned up SSH tunnel');
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

async function setupSSHTunnel(username: string, token: string): Promise<void> {
    try {
        // JupyterHub SSH service details - use FQDN instead of IP
        const sshHost = 'jupyterhub-ssh.cms.geddes.rcac.purdue.edu';
        const sshPort = 22;
        const localPort = 2222; // Local port for the tunnel
        
        // Create SSH config for Remote-SSH
        await createSSHConfig(sshHost, sshPort, username);
        
        // Start SSH tunnel
        await startSSHTunnel(sshHost, sshPort, localPort, username, token);
        
        // Configure VS Code Remote-SSH
        await configureRemoteSSH();
        
        // Detect and configure Jupyter kernels
        await detectJupyterKernels();
        
        // Configure remote file system access
        await configureRemoteFileSystem();
        
        // Configure notebook rendering
        await configureNotebookRendering();
        
    } catch (error) {
        console.error('SSH tunnel setup failed:', error);
        throw new Error(`Failed to setup SSH tunnel: ${error}`);
    }
}

async function createSSHConfig(host: string, port: number, username: string): Promise<void> {
    try {
        // Create temporary SSH config file
        const sshDir = path.join(os.tmpdir(), 'purdue-af-ssh');
        if (!fs.existsSync(sshDir)) {
            fs.mkdirSync(sshDir, { recursive: true });
        }
        
        sshConfigPath = path.join(sshDir, 'config');
        
        const sshConfig = `Host purdue-af-jupyterhub
    HostName ${host}
    Port ${port}
    User ${username}
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
    ServerAliveInterval 60
    ServerAliveCountMax 3
    ForwardAgent yes
    RemoteForward 8888 localhost:8888
    RemoteForward 8889 localhost:8889
    RemoteForward 8890 localhost:8890
`;
        
        fs.writeFileSync(sshConfigPath, sshConfig);
        
        console.log(`SSH config created at: ${sshConfigPath}`);
        
    } catch (error) {
        console.error('Failed to create SSH config:', error);
        throw error;
    }
}

async function startSSHTunnel(host: string, port: number, localPort: number, username: string, token: string): Promise<void> {
    return new Promise((resolve, reject) => {
        try {
            // Create an expect script to handle password input and keep connection alive
            const expectScript = `#!/usr/bin/expect -f
set timeout 30
spawn ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -L ${localPort}:localhost:8888 -L ${localPort + 1}:localhost:8889 -L ${localPort + 2}:localhost:8890 ${username}@${host}
expect "Password:"
send "${token}\\r"
expect "$ "
interact
`;
            
            const scriptPath = path.join(os.tmpdir(), `ssh_expect_${Date.now()}.exp`);
            
            console.log(`Creating expect script: ${scriptPath}`);
            console.log(`Username: ${username}`);
            console.log(`Host: ${host}`);
            console.log(`Token length: ${token.length}`);
            console.log(`Platform: ${process.platform}`);
            console.log(`Expect script content: ${expectScript}`);
            
            // Write script to temporary file
            fs.writeFileSync(scriptPath, expectScript);
            fs.chmodSync(scriptPath, '755');
            
            // Verify script was created
            console.log(`Expect script file created: ${fs.existsSync(scriptPath)}`);
            console.log(`Expect script file size: ${fs.statSync(scriptPath).size} bytes`);
            
            // Show progress to user
            vscode.window.showInformationMessage(`Creating SSH connection to ${host}...`);
            
            // Run the expect script
            sshProcess = child_process.spawn('expect', [scriptPath], {
                stdio: ['pipe', 'pipe', 'pipe']
            });
            
            let stdoutData = '';
            let stderrData = '';
            let hasResolved = false;
            
            // Show progress updates
            const progressInterval = setInterval(() => {
                if (!hasResolved && sshProcess && !sshProcess.killed) {
                    vscode.window.showInformationMessage(`SSH connection in progress... (${Math.floor((Date.now() - Date.now()) / 1000)}s)`);
                }
            }, 2000);
            
            sshProcess.stdout?.on('data', (data) => {
                const output = data.toString();
                stdoutData += output;
                console.log(`SSH stdout: ${output}`);
                
                // Show progress to user
                if (output.includes('$ ') || output.includes('dkondra@purdue-af') || output.includes('SSH connection successful')) {
                    vscode.window.showInformationMessage('SSH connection established successfully!');
                    hasResolved = true;
                    resolve();
                }
            });
            
            sshProcess.stderr?.on('data', (data) => {
                const output = data.toString();
                stderrData += output;
                console.log(`SSH stderr: ${output}`);
                
                // Show progress to user
                if (output.includes('Password:')) {
                    vscode.window.showInformationMessage('Sending password to SSH...');
                } else if (output.includes('Permission denied')) {
                    vscode.window.showErrorMessage('SSH authentication failed - check username and token');
                }
            });
            
            sshProcess.on('error', (error) => {
                clearInterval(progressInterval);
                console.error('SSH tunnel error:', error);
                console.error('Full stdout:', stdoutData);
                console.error('Full stderr:', stderrData);
                
                // Clean up script
                try { fs.unlinkSync(scriptPath); } catch (e) {}
                
                vscode.window.showErrorMessage(`SSH tunnel failed: ${error.message}`);
                reject(new Error(`SSH tunnel failed: ${error.message}`));
            });
            
            sshProcess.on('exit', (code, signal) => {
                clearInterval(progressInterval);
                console.log(`SSH tunnel exited with code: ${code}, signal: ${signal}`);
                console.log('Full stdout:', stdoutData);
                console.log('Full stderr:', stderrData);
                
                // Clean up script
                try { fs.unlinkSync(scriptPath); } catch (e) {}
                
                // Don't treat exit as error if we already resolved (connection established)
                if (hasResolved) {
                    console.log('SSH tunnel ended after successful connection');
                    return;
                }
                
                if (code === 0 || code === 143) {
                    console.log('SSH tunnel established successfully');
                    hasResolved = true;
                    vscode.window.showInformationMessage('SSH connection successful!');
                    resolve();
                } else {
                    const errorMsg = `SSH tunnel exited with code: ${code}. stdout: ${stdoutData}, stderr: ${stderrData}`;
                    console.error(errorMsg);
                    vscode.window.showErrorMessage(`SSH connection failed (code ${code}). Check Developer Console for details.`);
                    reject(new Error(errorMsg));
                }
            });
            
            // Keep connection alive - no timeout
            // The SSH tunnel will stay open for remote development
            
        } catch (error) {
            console.error('Failed to start SSH tunnel:', error);
            vscode.window.showErrorMessage(`Failed to start SSH tunnel: ${error}`);
            reject(error);
        }
    });
}

async function configureRemoteSSH(): Promise<void> {
    try {
        // Try different possible IDs for Remote-SSH
        const possibleIds = [
            'ms-vscode-remote.remote-ssh',
            'ms-vscode-remote.remote-ssh-edit',
            'ms-vscode.remote-explorer',
            'ms-vscode-remote.remote-containers'
        ];
        
        let remoteSSHExtension = null;
        for (const id of possibleIds) {
            remoteSSHExtension = vscode.extensions.getExtension(id);
            if (remoteSSHExtension) {
                console.log(`Found Remote-SSH extension for config: ${id}`);
                break;
            }
        }
        
        if (!remoteSSHExtension) {
            // Wait a bit and try again
            await new Promise(resolve => setTimeout(resolve, 500));
            for (const id of possibleIds) {
                remoteSSHExtension = vscode.extensions.getExtension(id);
                if (remoteSSHExtension) {
                    console.log(`Found Remote-SSH extension on retry: ${id}`);
                    break;
                }
            }
        }
        
        if (!remoteSSHExtension) {
            const installNow = await vscode.window.showErrorMessage(
                'Remote-SSH extension is not available. Would you like to install it now?',
                'Install Remote-SSH',
                'Skip'
            );
            
            if (installNow === 'Install Remote-SSH') {
                try {
                    await vscode.commands.executeCommand('workbench.extensions.installExtension', 'ms-vscode-remote.remote-ssh');
                    vscode.window.showInformationMessage('Remote-SSH installed! Please reload VS Code and try again.');
                    return;
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to install Remote-SSH: ${error}`);
                    return;
                }
            } else {
                return;
            }
        }
        
        // Try to activate if not active
        if (!remoteSSHExtension.isActive) {
            try {
                await remoteSSHExtension.activate();
                console.log('Remote-SSH extension activated for config');
            } catch (error) {
                console.log('Could not activate Remote-SSH:', error);
            }
        }
        
        // Create SSH config entry for Purdue AF
        const sshConfigPath = path.join(os.homedir(), '.ssh', 'config');
        const configEntry = `
# Purdue AF JupyterHub
Host purdue-af-jupyterhub
    HostName jupyterhub-ssh.cms.geddes.rcac.purdue.edu
    User dkondra
    Port 22
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
    LocalForward 2222 localhost:8888
    LocalForward 2223 localhost:8889
    LocalForward 2224 localhost:8890
`;
        
        // Append to SSH config
        fs.appendFileSync(sshConfigPath, configEntry);
        
        vscode.window.showInformationMessage('SSH config updated! You can now connect via Remote-SSH.');
        
        // Automatically open remote development environment
        vscode.window.showInformationMessage('SSH tunnel established! Opening remote development environment...');
        
        // Step 1: Open remote file browser (no Remote-SSH needed)
        await openRemoteFileBrowser();
        
        // Step 2: Configure Jupyter kernels
        await detectJupyterKernels();
        
        vscode.window.showInformationMessage('🎉 Remote development environment ready! You can now browse files, run notebooks, and use terminals.');
        
    } catch (error) {
        console.error('Failed to configure Remote-SSH:', error);
        vscode.window.showErrorMessage(`Failed to configure Remote-SSH: ${error}`);
    }
}

async function openRemoteFileBrowser(): Promise<void> {
    try {
        vscode.window.showInformationMessage('Opening remote file browser...');
        
        // Get the username from the SSH config or use default
        const username = await getUsernameFromConfig() || 'jupyter';
        const remotePath = `/home/${username}`;
        
        console.log(`Opening remote file browser at: ${remotePath}`);
        
        // Create a custom file system provider for remote access
        await createRemoteFileSystemProvider(remotePath);
        
        vscode.window.showInformationMessage(`📁 Remote file browser opened at ${remotePath}`);
    } catch (error) {
        console.error('Failed to open remote file browser:', error);
        vscode.window.showErrorMessage(`Failed to open remote file browser: ${error}`);
    }
}

async function createRemoteFileSystemProvider(remotePath: string): Promise<void> {
    try {
        // Create a temporary workspace folder for remote access
        const tempWorkspacePath = path.join(os.tmpdir(), 'purdue-af-workspace');
        
        if (!fs.existsSync(tempWorkspacePath)) {
            fs.mkdirSync(tempWorkspacePath, { recursive: true });
        }
        
        // Create a README file explaining the setup
        const readmeContent = `# Purdue AF Remote Workspace

This workspace is connected to Purdue AF JupyterHub via SSH tunnel.

## Remote Path: ${remotePath}

## Available Services:
- JupyterHub: http://localhost:8888
- JupyterLab: http://localhost:8889  
- Jupyter Notebook: http://localhost:8890

## Terminal Access:
Use the integrated terminal to run commands on the remote AlmaLinux 8 system.

## File Access:
Files are accessed via SSH commands. Use the terminal to browse and edit files.
`;
        
        fs.writeFileSync(path.join(tempWorkspacePath, 'README.md'), readmeContent);
        
        // Open the workspace
        await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(tempWorkspacePath));
        
        // Show instructions
        vscode.window.showInformationMessage(
            '📁 Remote workspace opened! Use the terminal to access remote files.',
            'Open Terminal',
            'View README'
        ).then(selection => {
            if (selection === 'Open Terminal') {
                vscode.window.createTerminal({
                    name: 'Purdue AF Terminal',
                    shellPath: '/bin/bash'
                }).show();
            } else if (selection === 'View README') {
                vscode.window.showTextDocument(vscode.Uri.file(path.join(tempWorkspacePath, 'README.md')));
            }
        });
        
    } catch (error) {
        console.error('Failed to create remote file system provider:', error);
        throw error;
    }
}

async function getUsernameFromConfig(): Promise<string | null> {
    try {
        const sshConfigPath = path.join(os.homedir(), '.ssh', 'config');
        if (fs.existsSync(sshConfigPath)) {
            const configContent = fs.readFileSync(sshConfigPath, 'utf8');
            const match = configContent.match(/Host purdue-af-jupyterhub[\s\S]*?User\s+(\w+)/);
            return match ? match[1] : null;
        }
    } catch (error) {
        console.log('Could not read SSH config:', error);
    }
    return null;
}


async function detectJupyterKernels(): Promise<void> {
    try {
        statusBarItem.text = "$(loading~spin) Detecting Jupyter kernels...";
        
        vscode.window.showInformationMessage('🔍 Detecting Jupyter kernels...');
        
        // Wait for Remote-SSH to be fully connected
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Check if Jupyter extension is installed
        const jupyterExtension = vscode.extensions.getExtension('ms-toolsai.jupyter');
        if (!jupyterExtension) {
            const installJupyter = await vscode.window.showWarningMessage(
                'Jupyter extension is not installed. Would you like to install it for notebook support?',
                'Install Jupyter',
                'Skip'
            );
            
            if (installJupyter === 'Install Jupyter') {
                await vscode.commands.executeCommand('workbench.extensions.installExtension', 'ms-toolsai.jupyter');
                await vscode.window.showInformationMessage('Please restart VS Code after Jupyter extension installation completes.');
                return;
            }
        }
        
        // Set up terminal for AlmaLinux 8
        await setupAlmaLinuxTerminal();
        
        vscode.window.showInformationMessage('✅ Jupyter kernels ready! You can now run notebooks.');
        
        statusBarItem.text = "$(server) Purdue AF";
        
    } catch (error) {
        console.error('Failed to detect Jupyter kernels:', error);
        vscode.window.showErrorMessage(`Failed to detect Jupyter kernels: ${error}`);
        statusBarItem.text = "$(server) Purdue AF";
    }
}

async function setupAlmaLinuxTerminal(): Promise<void> {
    try {
        vscode.window.showInformationMessage('🐧 Setting up AlmaLinux 8 terminal...');
        
        // Get username from config
        const username = await getUsernameFromConfig() || 'jupyter';
        
        // Open a new terminal
        const terminal = vscode.window.createTerminal({
            name: 'Purdue AF Terminal',
            shellPath: '/bin/bash',
            shellArgs: ['-l']
        });
        
        terminal.show();
        
        // Send welcome message and SSH connection
        terminal.sendText('echo "🐧 Welcome to Purdue AF Terminal!"');
        terminal.sendText('echo "🔗 Connecting to AlmaLinux 8..."');
        terminal.sendText(`ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${username}@jupyterhub-ssh.cms.geddes.rcac.purdue.edu`);
        
        vscode.window.showInformationMessage('✅ Terminal ready! SSH connection will prompt for your token.');
        
    } catch (error) {
        console.error('Failed to setup terminal:', error);
        vscode.window.showErrorMessage(`Failed to setup terminal: ${error}`);
    }
}

async function detectKernelsViaSSH(): Promise<string[]> {
    return new Promise((resolve) => {
        try {
            // Use SSH to run jupyter kernelspec list on the remote host
            const sshArgs = [
                '-o', 'StrictHostKeyChecking=no',
                '-o', 'UserKnownHostsFile=/dev/null',
                '-o', 'ConnectTimeout=10',
                'jupyterhub-ssh.cms.geddes.rcac.purdue.edu',
                'jupyter kernelspec list --json'
            ];
            
            console.log(`Detecting kernels: ssh ${sshArgs.join(' ')}`);
            
            const sshProcess = child_process.spawn('ssh', sshArgs, {
                stdio: ['pipe', 'pipe', 'pipe']
            });
            
            let stdout = '';
            let stderr = '';
            
            sshProcess.stdout?.on('data', (data) => {
                stdout += data.toString();
            });
            
            sshProcess.stderr?.on('data', (data) => {
                stderr += data.toString();
            });
            
            sshProcess.on('exit', (code) => {
                console.log(`Kernel detection exited with code: ${code}`);
                console.log(`stdout: ${stdout}`);
                console.log(`stderr: ${stderr}`);
                
                if (code === 0 && stdout) {
                    try {
                        const kernelSpecs = JSON.parse(stdout);
                        const kernels = Object.keys(kernelSpecs.kernelspecs || {});
                        console.log(`Detected kernels: ${kernels.join(', ')}`);
                        resolve(kernels);
                    } catch (parseError) {
                        console.error('Failed to parse kernel specs:', parseError);
                        resolve([]);
                    }
                } else {
                    console.log('No kernels detected or command failed');
                    resolve([]);
                }
            });
            
            sshProcess.on('error', (error) => {
                console.error('SSH kernel detection error:', error);
                resolve([]);
            });
            
            // Timeout after 10 seconds
            setTimeout(() => {
                sshProcess.kill();
                resolve([]);
            }, 10000);
            
        } catch (error) {
            console.error('Failed to detect kernels via SSH:', error);
            resolve([]);
        }
    });
}

async function configureJupyterKernels(kernels: string[]): Promise<void> {
    try {
        // Show available kernels to user
        const kernelChoices = kernels.map(kernel => ({
            label: `$(notebook) ${kernel}`,
            description: `Jupyter kernel: ${kernel}`,
            value: kernel
        }));
        
        kernelChoices.push({
            label: "$(gear) Configure all kernels",
            description: "Set up all detected kernels",
            value: "all"
        });
        
        const selectedKernels = await vscode.window.showQuickPick(kernelChoices, {
            placeHolder: "Select Jupyter kernels to configure",
            title: "Available Jupyter Kernels",
            canPickMany: true
        });
        
        if (selectedKernels && selectedKernels.length > 0) {
            const kernelsToConfigure = selectedKernels.map(choice => choice.value);
            
            if (kernelsToConfigure.includes('all')) {
                await configureAllKernels(kernels);
            } else {
                await configureSpecificKernels(kernelsToConfigure);
            }
            
            vscode.window.showInformationMessage(`Configured ${kernelsToConfigure.length} Jupyter kernel(s) for Purdue AF`);
        }
        
    } catch (error) {
        console.error('Failed to configure Jupyter kernels:', error);
        throw error;
    }
}

async function configureAllKernels(kernels: string[]): Promise<void> {
    try {
        // Create VS Code settings for Jupyter kernels
        const config = vscode.workspace.getConfiguration('jupyter');
        
        // Configure kernel paths
        const kernelPaths: { [key: string]: string } = {};
        kernels.forEach(kernel => {
            kernelPaths[kernel] = `ssh://jupyterhub-ssh.cms.geddes.rcac.purdue.edu:22/usr/local/share/jupyter/kernels/${kernel}`;
        });
        
        await config.update('kernels.kernelPaths', kernelPaths, vscode.ConfigurationTarget.Global);
        
        console.log(`Configured kernel paths for: ${kernels.join(', ')}`);
        
    } catch (error) {
        console.error('Failed to configure all kernels:', error);
        throw error;
    }
}

async function configureSpecificKernels(kernels: string[]): Promise<void> {
    try {
        // Configure specific kernels
        const config = vscode.workspace.getConfiguration('jupyter');
        
        const kernelPaths: { [key: string]: string } = {};
        kernels.forEach(kernel => {
            kernelPaths[kernel] = `ssh://jupyter@172.21.161.22:22/usr/local/share/jupyter/kernels/${kernel}`;
        });
        
        await config.update('kernels.kernelPaths', kernelPaths, vscode.ConfigurationTarget.Global);
        
        console.log(`Configured specific kernel paths for: ${kernels.join(', ')}`);
        
    } catch (error) {
        console.error('Failed to configure specific kernels:', error);
        throw error;
    }
}

async function configureRemoteFileSystem(): Promise<void> {
    try {
        statusBarItem.text = "$(loading~spin) Configuring remote file system...";
        
        // Check if Remote-SSH extension is installed
        const remoteSSHExtension = vscode.extensions.getExtension('ms-vscode-remote.remote-ssh');
        if (!remoteSSHExtension) {
            console.log('Remote-SSH extension not available for file system access');
            return;
        }
        
        // Create workspace configuration for remote file access
        await createRemoteWorkspaceConfig();
        
        // Show file system access options
        await showFileSystemOptions();
        
    } catch (error) {
        console.error('Failed to configure remote file system:', error);
        // Don't throw error - file system access is optional
    }
}

async function createRemoteWorkspaceConfig(): Promise<void> {
    try {
        // Create a workspace configuration file for remote access
        const workspaceDir = path.join(os.tmpdir(), 'purdue-af-workspace');
        if (!fs.existsSync(workspaceDir)) {
            fs.mkdirSync(workspaceDir, { recursive: true });
        }
        
        const workspaceConfig = {
            "folders": [
                {
                    "name": "Purdue AF - Home Directory",
                    "uri": "ssh://jupyterhub-ssh.cms.geddes.rcac.purdue.edu:22/home/jupyter"
                },
                {
                    "name": "Purdue AF - CVMFS",
                    "uri": "ssh://jupyterhub-ssh.cms.geddes.rcac.purdue.edu:22/cvmfs"
                },
                {
                    "name": "Purdue AF - EOS",
                    "uri": "ssh://jupyterhub-ssh.cms.geddes.rcac.purdue.edu:22/eos"
                },
                {
                    "name": "Purdue AF - Depot",
                    "uri": "ssh://jupyterhub-ssh.cms.geddes.rcac.purdue.edu:22/depot/cms"
                }
            ],
            "settings": {
                "remote.SSH.remotePlatform": {
                    "jupyterhub-ssh.cms.geddes.rcac.purdue.edu": "linux"
                },
                "remote.SSH.configFile": sshConfigPath,
                "files.exclude": {
                    "**/.git": true,
                    "**/.DS_Store": true,
                    "**/node_modules": true
                },
                "search.exclude": {
                    "**/.git": true,
                    "**/node_modules": true,
                    "**/bower_components": true
                }
            }
        };
        
        const workspaceFile = path.join(workspaceDir, 'purdue-af.code-workspace');
        fs.writeFileSync(workspaceFile, JSON.stringify(workspaceConfig, null, 2));
        
        console.log(`Remote workspace config created at: ${workspaceFile}`);
        
    } catch (error) {
        console.error('Failed to create remote workspace config:', error);
        throw error;
    }
}

async function showFileSystemOptions(): Promise<void> {
    try {
        const fileSystemOptions = await vscode.window.showInformationMessage(
            'Remote file system configured! You can now access files on your JupyterHub pod.',
            'Open Remote Workspace',
            'Show File Access Instructions',
            'Skip'
        );
        
        if (fileSystemOptions === 'Open Remote Workspace') {
            await openRemoteWorkspace();
        } else if (fileSystemOptions === 'Show File Access Instructions') {
            await showFileAccessInstructions();
        }
        
    } catch (error) {
        console.error('Failed to show file system options:', error);
        throw error;
    }
}

async function openRemoteWorkspace(): Promise<void> {
    try {
        const workspaceDir = path.join(os.tmpdir(), 'purdue-af-workspace');
        const workspaceFile = path.join(workspaceDir, 'purdue-af.code-workspace');
        
        if (fs.existsSync(workspaceFile)) {
            const workspaceUri = vscode.Uri.file(workspaceFile);
            await vscode.commands.executeCommand('vscode.openFolder', workspaceUri);
            vscode.window.showInformationMessage('Remote workspace opened! You can now browse files on your JupyterHub pod.');
        } else {
            vscode.window.showErrorMessage('Remote workspace file not found. Please try reconnecting.');
        }
        
    } catch (error) {
        console.error('Failed to open remote workspace:', error);
        throw error;
    }
}

async function showFileAccessInstructions(): Promise<void> {
    const instructions = `
Remote File System Access Configured!

You can access files on your JupyterHub pod through:

1. **Home Directory**: /home/jupyter
   - Your personal files and notebooks
   - JupyterLab workspace

2. **CVMFS**: /cvmfs
   - Shared software installations
   - CMS software stack

3. **EOS**: /eos
   - Large-scale data storage
   - Experiment data

4. **Depot**: /depot/cms
   - Additional data storage
   - Shared datasets

To access files:
1. Use Remote-SSH to connect to "purdue-af-jupyterhub"
2. Browse files in the Explorer panel
3. Open notebooks directly in VS Code
4. Use integrated terminal for command-line access

All file operations are performed through the SSH tunnel.
    `;
    
    await vscode.window.showInformationMessage(instructions);
}

async function configureNotebookRendering(): Promise<void> {
    try {
        statusBarItem.text = "$(loading~spin) Configuring notebook rendering...";
        
        // Check if Jupyter extension is installed
        const jupyterExtension = vscode.extensions.getExtension('ms-toolsai.jupyter');
        if (!jupyterExtension) {
            console.log('Jupyter extension not available for notebook rendering');
            return;
        }
        
        // Configure notebook settings for optimal rendering
        await configureNotebookSettings();
        
        // Show notebook rendering options
        await showNotebookRenderingOptions();
        
    } catch (error) {
        console.error('Failed to configure notebook rendering:', error);
        // Don't throw error - notebook rendering is optional
    }
}

async function configureNotebookSettings(): Promise<void> {
    try {
        // Configure Jupyter notebook settings for remote rendering
        const jupyterConfig = vscode.workspace.getConfiguration('jupyter');
        
        // Enable remote kernel support
        await jupyterConfig.update('remoteKernelSupport', true, vscode.ConfigurationTarget.Global);
        
        // Configure kernel connection timeout
        await jupyterConfig.update('kernelConnectionTimeout', 30000, vscode.ConfigurationTarget.Global);
        
        // Enable interactive window
        await jupyterConfig.update('enableInteractiveWindow', true, vscode.ConfigurationTarget.Global);
        
        // Configure notebook output
        const notebookConfig = vscode.workspace.getConfiguration('notebook');
        await notebookConfig.update('output.textLineLimit', 1000, vscode.ConfigurationTarget.Global);
        await notebookConfig.update('output.scrolling', true, vscode.ConfigurationTarget.Global);
        
        // Configure Python settings for remote development
        const pythonConfig = vscode.workspace.getConfiguration('python');
        await pythonConfig.update('defaultInterpreterPath', '/usr/bin/python3', vscode.ConfigurationTarget.Global);
        
        console.log('Notebook rendering settings configured');
        
    } catch (error) {
        console.error('Failed to configure notebook settings:', error);
        throw error;
    }
}

async function showNotebookRenderingOptions(): Promise<void> {
    try {
        const notebookOptions = await vscode.window.showInformationMessage(
            'Notebook rendering configured! You can now work with Jupyter notebooks in VS Code.',
            'Open Sample Notebook',
            'Show Notebook Instructions',
            'Skip'
        );
        
        if (notebookOptions === 'Open Sample Notebook') {
            await createSampleNotebook();
        } else if (notebookOptions === 'Show Notebook Instructions') {
            await showNotebookInstructions();
        }
        
    } catch (error) {
        console.error('Failed to show notebook rendering options:', error);
        throw error;
    }
}

async function createSampleNotebook(): Promise<void> {
    try {
        // Create a sample notebook to demonstrate functionality
        const sampleNotebook = {
            "cells": [
                {
                    "cell_type": "markdown",
                    "metadata": {},
                    "source": [
                        "# Purdue AF Sample Notebook\n",
                        "\n",
                        "This notebook demonstrates the integration between VS Code and Purdue AF JupyterHub.\n",
                        "\n",
                        "## Features:\n",
                        "- Remote kernel execution\n",
                        "- File system access\n",
                        "- SSH tunnel connectivity"
                    ]
                },
                {
                    "cell_type": "code",
                    "execution_count": null,
                    "metadata": {},
                    "outputs": [],
                    "source": [
                        "# Test remote kernel connection\n",
                        "import sys\n",
                        "import os\n",
                        "\n",
                        "print(f\"Python version: {sys.version}\")\n",
                        "print(f\"Current working directory: {os.getcwd()}\")\n",
                        "print(f\"Available directories: {os.listdir('.')}\")"
                    ]
                },
                {
                    "cell_type": "code",
                    "execution_count": null,
                    "metadata": {},
                    "outputs": [],
                    "source": [
                        "# Test CVMFS access\n",
                        "cvmfs_path = \"/cvmfs\"\n",
                        "if os.path.exists(cvmfs_path):\n",
                        "    print(f\"CVMFS is accessible at: {cvmfs_path}\")\n",
                        "    print(f\"CVMFS contents: {os.listdir(cvmfs_path)[:10]}\")  # Show first 10 items\n",
                        "else:\n",
                        "    print(\"CVMFS not accessible\")"
                    ]
                },
                {
                    "cell_type": "code",
                    "execution_count": null,
                    "metadata": {},
                    "outputs": [],
                    "source": [
                        "# Test EOS access\n",
                        "eos_path = \"/eos\"\n",
                        "if os.path.exists(eos_path):\n",
                        "    print(f\"EOS is accessible at: {eos_path}\")\n",
                        "    print(f\"EOS contents: {os.listdir(eos_path)[:10]}\")  # Show first 10 items\n",
                        "else:\n",
                        "    print(\"EOS not accessible\")"
                    ]
                }
            ],
            "metadata": {
                "kernelspec": {
                    "display_name": "Python 3",
                    "language": "python",
                    "name": "python3"
                },
                "language_info": {
                    "name": "python",
                    "version": "3.8.0"
                }
            },
            "nbformat": 4,
            "nbformat_minor": 4
        };
        
        // Save sample notebook to temporary directory
        const notebookDir = path.join(os.tmpdir(), 'purdue-af-notebooks');
        if (!fs.existsSync(notebookDir)) {
            fs.mkdirSync(notebookDir, { recursive: true });
        }
        
        const notebookFile = path.join(notebookDir, 'purdue-af-sample.ipynb');
        fs.writeFileSync(notebookFile, JSON.stringify(sampleNotebook, null, 2));
        
        // Open the sample notebook
        const notebookUri = vscode.Uri.file(notebookFile);
        await vscode.commands.executeCommand('vscode.openWith', notebookUri, 'jupyter-notebook');
        
        vscode.window.showInformationMessage('Sample notebook created and opened! You can now test the remote kernel connection.');
        
    } catch (error) {
        console.error('Failed to create sample notebook:', error);
        throw error;
    }
}

async function showNotebookInstructions(): Promise<void> {
    const instructions = `
Notebook Rendering Configured!

You can now work with Jupyter notebooks in VS Code:

## Features Available:
- **Remote Kernel Execution**: Run code on JupyterHub kernels
- **Interactive Window**: Use the interactive Python window
- **Notebook Editor**: Full notebook editing capabilities
- **Rich Output**: Support for plots, images, and HTML output

## How to Use:

1. **Open Notebooks**: 
   - Open .ipynb files directly in VS Code
   - Use Command Palette: "Jupyter: Create New Notebook"

2. **Select Kernel**:
   - Click kernel selector in notebook toolbar
   - Choose from available JupyterHub kernels

3. **Run Cells**:
   - Use Shift+Enter to run cells
   - Use Ctrl+Enter to run cell without advancing

4. **Interactive Window**:
   - Use Command Palette: "Python: Start REPL"
   - Run code interactively with remote kernel

## File Access:
- Home directory: /home/jupyter
- CVMFS: /cvmfs (shared software)
- EOS: /eos (data storage)
- Depot: /depot/cms (additional data)

All notebook operations use the SSH tunnel for secure remote execution.
    `;
    
    await vscode.window.showInformationMessage(instructions);
}

export function deactivate() {
    console.log('Purdue AF extension is now deactivated');
    if (isConnected) {
        disconnectFromBroker();
    }
}