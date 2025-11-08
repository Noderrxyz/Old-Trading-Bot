import { TradeEvent, TradeData, OrderbookUpdate, GasPriceUpdate } from './types/replay.types.js';
import logger from '../utils/logger.js';
import fs from 'fs/promises';
import path from 'path';

export class ReplayEventLoader {
    private static instance: ReplayEventLoader;
    private events: TradeEvent[] = [];

    private constructor() {}

    public static getInstance(): ReplayEventLoader {
        if (!ReplayEventLoader.instance) {
            ReplayEventLoader.instance = new ReplayEventLoader();
        }
        return ReplayEventLoader.instance;
    }

    public async loadEvents(source: string): Promise<TradeEvent[]> {
        try {
            const files = await this.getEventFiles(source);
            for (const file of files) {
                await this.loadFile(file);
            }
            this.sortEvents();
            logger.info(`Loaded ${this.events.length} events from ${files.length} files`);
            return this.events;
        } catch (error) {
            logger.error('Failed to load events:', error);
            throw error;
        }
    }

    private async getEventFiles(source: string): Promise<string[]> {
        try {
            const files = await fs.readdir(source);
            return files
                .filter(file => file.endsWith('.json') || file.endsWith('.csv'))
                .map(file => path.join(source, file));
        } catch (error) {
            logger.error('Failed to read event files:', error);
            throw error;
        }
    }

    private async loadFile(filePath: string): Promise<void> {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const events = this.parseFileContent(content, path.extname(filePath));
            this.events.push(...events);
        } catch (error) {
            logger.error(`Failed to load file ${filePath}:`, error);
            throw error;
        }
    }

    private parseFileContent(content: string, extension: string): TradeEvent[] {
        if (extension === '.json') {
            return this.parseJsonContent(content);
        } else if (extension === '.csv') {
            return this.parseCsvContent(content);
        }
        throw new Error(`Unsupported file extension: ${extension}`);
    }

    private parseJsonContent(content: string): TradeEvent[] {
        const rawEvents = JSON.parse(content);
        return rawEvents.map((event: any) => this.normalizeEvent(event));
    }

    private parseCsvContent(content: string): TradeEvent[] {
        const lines = content.split('\n');
        const headers = lines[0].split(',');
        return lines.slice(1).map(line => {
            const values = line.split(',');
            const event: any = {};
            headers.forEach((header, index) => {
                event[header.trim()] = values[index]?.trim();
            });
            return this.normalizeEvent(event);
        });
    }

    private normalizeEvent(event: any): TradeEvent {
        const baseEvent = {
            timestamp: Number(event.timestamp),
            price: Number(event.price),
            volume: Number(event.volume),
            side: event.side,
            maker: event.maker,
            taker: event.taker,
            gasPrice: Number(event.gasPrice),
            success: event.success === 'true' || event.success === true
        };

        // Normalize event data based on type
        switch (event.type) {
            case 'trade':
                return {
                    ...baseEvent,
                    type: 'trade',
                    data: {
                        timestamp: Number(event.timestamp),
                        price: Number(event.price),
                        volume: Number(event.volume),
                        side: event.side,
                        maker: event.maker,
                        taker: event.taker,
                        gasPrice: Number(event.gasPrice),
                        gasUsed: Number(event.gasUsed),
                        slippage: event.slippage ? Number(event.slippage) : undefined,
                        status: event.status
                    } as TradeData
                };
            case 'orderbook_update':
                return {
                    ...baseEvent,
                    type: 'orderbook_update',
                    data: {
                        timestamp: Number(event.timestamp),
                        bids: JSON.parse(event.bids),
                        asks: JSON.parse(event.asks),
                        midPrice: Number(event.midPrice),
                        spread: Number(event.spread),
                        depth: Number(event.depth)
                    } as OrderbookUpdate
                };
            case 'gas_price_update':
                return {
                    ...baseEvent,
                    type: 'gas_price_update',
                    data: {
                        timestamp: Number(event.timestamp),
                        gasPrice: Number(event.gasPrice),
                        baseFee: Number(event.baseFee),
                        priorityFee: Number(event.priorityFee)
                    } as GasPriceUpdate
                };
            default:
                throw new Error(`Unknown event type: ${event.type}`);
        }
    }

    private sortEvents(): void {
        this.events.sort((a, b) => a.timestamp - b.timestamp);
    }

    public clearEvents(): void {
        this.events = [];
    }
} 