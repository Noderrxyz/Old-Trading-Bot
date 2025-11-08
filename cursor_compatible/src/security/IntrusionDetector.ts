import { logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

export interface SecurityEvent {
  id: string;
  timestamp: number;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  source: string;
  details: any;
  actionTaken?: string;
}

export interface DetectionRule {
  id: string;
  name: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  condition: (event: any) => boolean;
  action: (event: SecurityEvent) => Promise<void>;
}

export class IntrusionDetector {
  private static instance: IntrusionDetector;
  private readonly EVENTS_FILE = 'data/security_events.jsonl';
  private readonly RULES_FILE = 'data/detection_rules.json';
  private rules: DetectionRule[] = [];
  private readonly THRESHOLDS = {
    highSeverityCount: 5,
    mediumSeverityCount: 10,
    timeWindow: 3600000 // 1 hour in milliseconds
  };

  private constructor() {
    this.ensureFiles();
    this.loadRules();
  }

  public static getInstance(): IntrusionDetector {
    if (!IntrusionDetector.instance) {
      IntrusionDetector.instance = new IntrusionDetector();
    }
    return IntrusionDetector.instance;
  }

  private ensureFiles() {
    const dir = path.dirname(this.EVENTS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.EVENTS_FILE)) {
      fs.writeFileSync(this.EVENTS_FILE, '');
    }
    if (!fs.existsSync(this.RULES_FILE)) {
      fs.writeFileSync(this.RULES_FILE, JSON.stringify([]));
    }
  }

  private loadRules() {
    try {
      const content = fs.readFileSync(this.RULES_FILE, 'utf-8');
      this.rules = JSON.parse(content);
    } catch (error) {
      logger.error('Failed to load detection rules:', error);
      this.rules = [];
    }
  }

  public async addRule(rule: DetectionRule): Promise<void> {
    try {
      this.rules.push(rule);
      await this.saveRules();
      logger.info(`Added new detection rule: ${rule.name}`);
    } catch (error) {
      logger.error('Failed to add detection rule:', error);
      throw error;
    }
  }

  private async saveRules(): Promise<void> {
    fs.writeFileSync(this.RULES_FILE, JSON.stringify(this.rules, null, 2));
  }

  public async detect(event: any): Promise<void> {
    try {
      for (const rule of this.rules) {
        if (rule.condition(event)) {
          const securityEvent: SecurityEvent = {
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            type: rule.name,
            severity: rule.severity,
            source: event.source || 'unknown',
            details: event
          };
          
          await this.recordEvent(securityEvent);
          await rule.action(securityEvent);
          
          await this.checkThresholds();
        }
      }
    } catch (error) {
      logger.error('Failed to process security event:', error);
    }
  }

  private async recordEvent(event: SecurityEvent): Promise<void> {
    fs.appendFileSync(
      this.EVENTS_FILE,
      JSON.stringify(event) + '\n'
    );
  }

  private async checkThresholds(): Promise<void> {
    const recentEvents = await this.getRecentEvents(this.THRESHOLDS.timeWindow);
    
    const highSeverityCount = recentEvents.filter(
      e => e.severity === 'high' || e.severity === 'critical'
    ).length;
    
    const mediumSeverityCount = recentEvents.filter(
      e => e.severity === 'medium'
    ).length;
    
    if (highSeverityCount >= this.THRESHOLDS.highSeverityCount) {
      await this.triggerEmergencyProtocol('high_severity_threshold');
    }
    
    if (mediumSeverityCount >= this.THRESHOLDS.mediumSeverityCount) {
      await this.triggerEmergencyProtocol('medium_severity_threshold');
    }
  }

  private async getRecentEvents(timeWindow: number): Promise<SecurityEvent[]> {
    const content = fs.readFileSync(this.EVENTS_FILE, 'utf-8');
    const events = content
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line) as SecurityEvent);
    
    const cutoff = Date.now() - timeWindow;
    return events.filter(e => e.timestamp >= cutoff);
  }

  private async triggerEmergencyProtocol(reason: string): Promise<void> {
    const event: SecurityEvent = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      type: 'emergency_protocol',
      severity: 'critical',
      source: 'system',
      details: { reason },
      actionTaken: 'Emergency protocol triggered'
    };
    
    await this.recordEvent(event);
    logger.critical(`Emergency protocol triggered: ${reason}`);
    
    // In a real implementation, this would trigger various emergency actions
    // such as isolating nodes, stopping trading, notifying operators, etc.
  }

  public getRules(): DetectionRule[] {
    return [...this.rules];
  }

  public async clearEvents(): Promise<void> {
    fs.writeFileSync(this.EVENTS_FILE, '');
  }
} 