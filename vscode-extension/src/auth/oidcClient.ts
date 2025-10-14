import * as crypto from 'crypto';
import * as express from 'express';
import { Server } from 'http';

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
        const authUrl = this.buildAuthUrl(codeChallenge, encodedState);
        
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

    private async exchangeCodeForTokens(_code: string, _codeVerifier: string): Promise<TokenSet> {
        // This would normally make an HTTP request to the broker's /auth/callback endpoint
        // For now, return mock tokens
        return {
            accessToken: 'mock-access-token',
            refreshToken: 'mock-refresh-token',
            expiresIn: 900,
            tokenType: 'Bearer'
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

    private buildAuthUrl(codeChallenge: string, state: string): string {
        const params = new URLSearchParams({
            response_type: 'code',
            client_id: 'vscode-extension',
            redirect_uri: 'http://localhost:3000/callback',
            scope: 'openid email profile',
            state,
            code_challenge: codeChallenge,
            code_challenge_method: 'S256'
        });

        return `https://cilogon.org/oauth2/authorize?${params.toString()}`;
    }
}
