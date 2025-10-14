import axios, { AxiosInstance } from 'axios';
import * as vscode from 'vscode';

export interface SessionInfo {
    sessionId: string;
    username: string;
    namespace: string;
    pod: string;
    tunnelUrl: string;
    sessionToken: string;
}

export class BrokerClient {
    private client: AxiosInstance;
    private currentSession?: SessionInfo;

    constructor() {
        const config = vscode.workspace.getConfiguration('jupyterCluster');
        const brokerUrl = config.get<string>('brokerUrl', 'https://broker.example.org');

        this.client = axios.create({
            baseURL: brokerUrl,
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json'
            }
        });
    }

    async createSession(accessToken: string, refreshToken: string): Promise<SessionInfo> {
        try {
            const response = await this.client.post('/session', {
                access_token: accessToken,
                refresh_token: refreshToken
            });

            this.currentSession = response.data;
            return this.currentSession!;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                throw new Error(`Failed to create session: ${error.response?.data?.error || error.message}`);
            }
            throw error;
        }
    }

    async getSession(sessionId: string): Promise<SessionInfo> {
        try {
            const response = await this.client.get(`/session/${sessionId}`);
            return response.data;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                throw new Error(`Failed to get session: ${error.response?.data?.error || error.message}`);
            }
            throw error;
        }
    }

    async deleteSession(): Promise<void> {
        if (!this.currentSession) {
            return;
        }

        try {
            await this.client.delete(`/session/${this.currentSession.sessionId}`);
            this.currentSession = undefined;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                throw new Error(`Failed to delete session: ${error.response?.data?.error || error.message}`);
            }
            throw error;
        }
    }

    getCurrentSession(): SessionInfo | undefined {
        return this.currentSession;
    }

    async refreshSession(): Promise<SessionInfo> {
        if (!this.currentSession) {
            throw new Error('No active session to refresh');
        }

        try {
            const response = await this.client.get(`/session/${this.currentSession.sessionId}`);
            this.currentSession = response.data;
            return this.currentSession!;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                throw new Error(`Failed to refresh session: ${error.response?.data?.error || error.message}`);
            }
            throw error;
        }
    }
}
