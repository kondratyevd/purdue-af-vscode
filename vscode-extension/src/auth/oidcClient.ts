import * as crypto from 'crypto';
import * as express from 'express';
import { Server } from 'http';
import fetch from 'node-fetch';

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
        const brokerUrl = process.env.BROKER_URL || 'http://localhost:8083';
        
        // Make HTTP request to broker's /auth/callback endpoint
        const response = await fetch(`${brokerUrl}/auth/callback`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                code,
                codeVerifier,
                state: 'extension-state' // We'll need to pass the actual state
            })
        });

        if (!response.ok) {
            throw new Error(`Token exchange failed: ${response.statusText}`);
        }

        const tokens = await response.json() as any;
        return {
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            expiresIn: tokens.expires_in,
            tokenType: tokens.token_type || 'Bearer'
        };
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
        const brokerUrl = process.env.BROKER_URL || 'http://localhost:8083';
        
        // Get auth URL from broker
        const response = await fetch(`${brokerUrl}/auth/start`);
        if (!response.ok) {
            throw new Error(`Failed to get auth URL: ${response.statusText}`);
        }
        
        const data = await response.json() as any;
        return data.auth_url;
    }
}
