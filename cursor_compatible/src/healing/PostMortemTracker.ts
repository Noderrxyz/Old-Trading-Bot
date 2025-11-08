import { logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

interface PostMortemEvent {
  timestamp: string;
  agentId: string;
  eventType: string;
  details: Record<string, any>;
  stackTrace?: string;
}

export class PostMortemTracker {
  private static instance: PostMortemTracker;
  private logFile: string;
  private readonly MAX_EVENTS_PER_AGENT = 100;

  private constructor() {
    this.logFile = path.join(process.cwd(), 'logs', 'postmortem_log.jsonl');
    this.ensureLogFile();
  }

  public static getInstance(): PostMortemTracker {
    if (!PostMortemTracker.instance) {
      PostMortemTracker.instance = new PostMortemTracker();
    }
    return PostMortemTracker.instance;
  }

  private ensureLogFile() {
    const logDir = path.dirname(this.logFile);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    if (!fs.existsSync(this.logFile)) {
      fs.writeFileSync(this.logFile, '');
    }
  }

  public logEvent(agentId: string, eventType: string, details: Record<string, any>, stackTrace?: string) {
    const event: PostMortemEvent = {
      timestamp: new Date().toISOString(),
      agentId,
      eventType,
      details,
      stackTrace
    };

    try {
      fs.appendFileSync(this.logFile, JSON.stringify(event) + '\n');
      this.cleanupOldEvents(agentId);
    } catch (error) {
      logger.error('Failed to log post-mortem event:', error);
    }
  }

  private cleanupOldEvents(agentId: string) {
    try {
      const events = this.readEvents();
      const agentEvents = events.filter(e => e.agentId === agentId);
      
      if (agentEvents.length > this.MAX_EVENTS_PER_AGENT) {
        const recentEvents = agentEvents.slice(-this.MAX_EVENTS_PER_AGENT);
        const otherEvents = events.filter(e => e.agentId !== agentId);
        const allEvents = [...otherEvents, ...recentEvents];
        
        fs.writeFileSync(this.logFile, allEvents.map(e => JSON.stringify(e)).join('\n') + '\n');
      }
    } catch (error) {
      logger.error('Failed to cleanup old events:', error);
    }
  }

  public readEvents(): PostMortemEvent[] {
    try {
      const content = fs.readFileSync(this.logFile, 'utf-8');
      return content
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line));
    } catch (error) {
      logger.error('Failed to read post-mortem events:', error);
      return [];
    }
  }

  public getAgentEvents(agentId: string): PostMortemEvent[] {
    return this.readEvents().filter(event => event.agentId === agentId);
  }

  public getRecentEvents(limit: number = 10): PostMortemEvent[] {
    return this.readEvents().slice(-limit);
  }

  public clearEvents(agentId?: string) {
    try {
      if (agentId) {
        const events = this.readEvents().filter(e => e.agentId !== agentId);
        fs.writeFileSync(this.logFile, events.map(e => JSON.stringify(e)).join('\n') + '\n');
      } else {
        fs.writeFileSync(this.logFile, '');
      }
    } catch (error) {
      logger.error('Failed to clear events:', error);
    }
  }
} 