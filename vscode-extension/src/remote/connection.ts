import WebSocket from 'ws';
import { SessionInfo } from '../broker/brokerClient';

export interface TunnelMessage {
    type: string;
    payload: Record<string, unknown>;
}

export class RemoteConnection {
    private ws?: WebSocket;
    private session?: SessionInfo;
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 5;
    private reconnectDelay = 1000;

    async connect(session: SessionInfo): Promise<void> {
        this.session = session;
        await this.connectWebSocket();
    }

    async disconnect(): Promise<void> {
        if (this.ws) {
            this.ws!.close();
            this.ws = undefined;
        }
        this.session = undefined;
        this.reconnectAttempts = 0;
    }

    async sendCommand(command: string, args: string[] = []): Promise<string> {
        if (!this.ws || this.ws!.readyState !== WebSocket.OPEN) {
            throw new Error('WebSocket connection not available');
        }

        return new Promise((resolve, reject) => {
            const message: TunnelMessage = {
                type: 'exec',
                payload: {
                    command,
                    args,
                    stdin: false,
                    stdout: true,
                    stderr: true
                }
            };

            const timeout = setTimeout(() => {
                reject(new Error('Command timeout'));
            }, 30000);

            const onMessage = (data: WebSocket.Data) => {
                try {
                    const response = JSON.parse(data.toString()) as { type: string; payload: Record<string, unknown> };
                    if (response.type === 'exec_response') {
                        clearTimeout(timeout);
                        this.ws!.off('message', onMessage);
                        resolve((response.payload.stdout as string) || (response.payload.stderr as string));
                    } else if (response.type === 'error') {
                        clearTimeout(timeout);
                        this.ws!.off('message', onMessage);
                        reject(new Error(response.payload.error as string));
                    }
                } catch (error) {
                    clearTimeout(timeout);
                    this.ws!.off('message', onMessage);
                    reject(error);
                }
            };

            this.ws!.on('message', onMessage);
            this.ws!.send(JSON.stringify(message));
        });
    }

    async sendFileOperation(operation: string, path: string, content?: string): Promise<string> {
        if (!this.ws || this.ws!.readyState !== WebSocket.OPEN) {
            throw new Error('WebSocket connection not available');
        }

        return new Promise((resolve, reject) => {
            const message: TunnelMessage = {
                type: 'file',
                payload: {
                    operation,
                    path,
                    content
                }
            };

            const timeout = setTimeout(() => {
                reject(new Error('File operation timeout'));
            }, 30000);

            const onMessage = (data: WebSocket.Data) => {
                try {
                    const response = JSON.parse(data.toString()) as { type: string; payload: Record<string, unknown> };
                    if (response.type === 'file_response') {
                        clearTimeout(timeout);
                        this.ws!.off('message', onMessage);
                        if (response.payload.success) {
                            resolve(response.payload.content as string);
                        } else {
                            reject(new Error(response.payload.error as string));
                        }
                    } else if (response.type === 'error') {
                        clearTimeout(timeout);
                        this.ws!.off('message', onMessage);
                        reject(new Error(response.payload.error as string));
                    }
                } catch (error) {
                    clearTimeout(timeout);
                    this.ws!.off('message', onMessage);
                    reject(error);
                }
            };

            this.ws!.on('message', onMessage);
            this.ws!.send(JSON.stringify(message));
        });
    }

    onDisconnect(callback: () => void): void {
        if (this.ws) {
            this.ws!.on('close', callback);
        }
    }

    private async connectWebSocket(): Promise<void> {
        if (!this.session) {
            throw new Error('No session available');
        }

        return new Promise((resolve, reject) => {
            const wsUrl = `${this.session!.tunnelUrl}?token=${this.session!.sessionToken}`;
            this.ws = new WebSocket(wsUrl);

            this.ws!.on('open', () => {
                console.log('WebSocket connected');
                this.reconnectAttempts = 0;
                resolve();
            });

            this.ws!.on('error', (error) => {
                console.error('WebSocket error:', error);
                reject(error);
            });

            this.ws!.on('close', (code, reason) => {
                console.log(`WebSocket closed: ${code} ${reason}`);
                this.handleReconnect();
            });

            this.ws!.on('message', (data) => {
                // Handle incoming messages
                console.log('Received message:', data.toString());
            });
        });
    }

    private handleReconnect(): void {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('Max reconnection attempts reached');
            return;
        }

        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

        console.log(`Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);

        setTimeout(async () => {
            try {
                await this.connectWebSocket();
            } catch (error) {
                console.error('Reconnection failed:', error);
                this.handleReconnect();
            }
        }, delay);
    }
}
