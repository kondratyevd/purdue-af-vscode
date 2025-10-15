import * as crypto from 'crypto';
import * as express from 'express';
import { Server } from 'http';
import * as https from 'https';
import * as http from 'http';

export interface TokenSet {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    tokenType: string;
}

export class OIDCClient {
    private server?: Server;
    private callbackPromise?: Promise<TokenSet>;
    private callbackResolve?: (tokens: TokenSet) => void;
    private callbackReject?: (error: Error) => void;

    async startAuth(): Promise<string> {
        // Generate PKCE parameters
        const codeVerifier = this.generateCodeVerifier();
        const codeChallenge = this.generateCodeChallenge(codeVerifier);
        const state = this.generateState();

        // Store PKCE parameters for callback
        const stateData = {
            state,
            codeVerifier
        };
        const encodedState = Buffer.from(JSON.stringify(stateData)).toString('base64url');

        // Start callback server
        await this.startCallbackServer();

        // Build authorization URL
        const authUrl = await this.buildAuthUrl(codeChallenge, encodedState);
        
        return authUrl;
    }

    async waitForCallback(): Promise<TokenSet> {
        if (!this.callbackPromise) {
            throw new Error('Auth flow not started');
        }

        return this.callbackPromise;
    }

    private async startCallbackServer(): Promise<void> {
        return new Promise((resolve, _reject) => {
            const app = express.default();
            
            app.get('/callback', async (req: express.Request, res: express.Response) => {
                try {
                    const { code, state } = req.query;
                    
                    if (!code || !state) {
                        res.status(400).send('Missing code or state parameter');
                        return;
                    }

                    // Decode state to get PKCE parameters
                    const stateData = JSON.parse(Buffer.from(state as string, 'base64url').toString());
                    
                    // Exchange code for tokens
                    const tokens = await this.exchangeCodeForTokens(code as string, stateData.codeVerifier);
                    
                    // Resolve the callback promise
                    if (this.callbackResolve) {
                        this.callbackResolve(tokens);
                    }

                    res.send('Authentication successful! You can close this window.');
                    
                    // Close server
                    if (this.server) {
                        this.server.close();
                    }
                } catch (error) {
                    if (this.callbackReject) {
                        this.callbackReject(error as Error);
                    }
                    res.status(500).send('Authentication failed');
                }
            });

            // Find available port
            this.server = app.listen(0, 'localhost', () => {
                const port = (this.server!.address() as { port: number }).port;
                console.log(`Callback server listening on port ${port}`);
                resolve();
            });

            // Set up callback promise
            this.callbackPromise = new Promise((resolve, reject) => {
                this.callbackResolve = resolve;
                this.callbackReject = reject;
            });
        });
    }

    private async exchangeCodeForTokens(code: string, codeVerifier: string): Promise<TokenSet> {
        // Get broker URL from configuration
        const brokerUrl = process.env.BROKER_URL || 'http://localhost:8084';

        return new Promise((resolve, reject) => {
            const url = new URL(`${brokerUrl}/auth/callback`);
            const postData = JSON.stringify({
                code,
                codeVerifier,
                state: 'extension-state'
            });

            const options = {
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: url.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData)
                }
            };

            const client = url.protocol === 'https:' ? https : http;
            const req = client.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    try {
                        const tokens = JSON.parse(data);
                        resolve({
                            accessToken: tokens.access_token,
                            refreshToken: tokens.refresh_token,
                            expiresIn: tokens.expires_in,
                            tokenType: tokens.token_type || 'Bearer'
                        });
                    } catch (error) {
                        reject(new Error(`Failed to parse response: ${error}`));
                    }
                });
            });

            req.on('error', (error) => {
                reject(new Error(`Token exchange failed: ${error.message}`));
            });

            req.write(postData);
            req.end();
        });
    }

    private generateCodeVerifier(): string {
        return crypto.randomBytes(32).toString('base64url');
    }

    private generateCodeChallenge(verifier: string): string {
        return crypto.createHash('sha256').update(verifier).digest('base64url');
    }

    private generateState(): string {
        return crypto.randomBytes(16).toString('base64url');
    }

    private async buildAuthUrl(codeChallenge: string, state: string): Promise<string> {
        // Get broker URL from configuration
        const brokerUrl = process.env.BROKER_URL || 'http://localhost:8084';

        return new Promise((resolve, reject) => {
            const url = new URL(`${brokerUrl}/auth/start`);
            
            const options = {
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: url.pathname,
                method: 'GET'
            };

            const client = url.protocol === 'https:' ? https : http;
            const req = client.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    try {
                        const response = JSON.parse(data);
                        resolve(response.auth_url);
                    } catch (error) {
                        reject(new Error(`Failed to parse auth URL response: ${error}`));
                    }
                });
            });

            req.on('error', (error) => {
                reject(new Error(`Failed to get auth URL: ${error.message}`));
            });

            req.end();
        });
    }
}
