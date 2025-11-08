import logger from '../utils/logger.js';
import axios from 'axios';

/**
 * Discord message field
 */
interface DiscordField {
  name: string;
  value: string;
  inline?: boolean;
}

/**
 * Discord message
 */
interface DiscordMessage {
  title?: string;
  description?: string;
  fields?: DiscordField[];
  color?: number;
  timestamp?: string;
}

/**
 * Discord Webhook Manager
 */
export class DiscordWebhookManager {
  private webhookUrl: string;

  constructor(webhookUrl: string) {
    this.webhookUrl = webhookUrl;
  }

  /**
   * Send message to Discord
   */
  public async sendMessage(message: DiscordMessage): Promise<void> {
    try {
      const embed = {
        title: message.title,
        description: message.description,
        fields: message.fields,
        color: message.color || 0xff0000, // Default to red
        timestamp: message.timestamp || new Date().toISOString()
      };

      await axios.post(this.webhookUrl, {
        embeds: [embed]
      });

      logger.info('Discord notification sent successfully');
    } catch (error) {
      logger.error('Failed to send Discord notification:', error);
      throw error;
    }
  }

  /**
   * Send error message
   */
  public async sendError(title: string, description: string, error: any): Promise<void> {
    const message: DiscordMessage = {
      title: `❌ ${title}`,
      description,
      color: 0xff0000,
      fields: [
        {
          name: 'Error',
          value: error.message || 'Unknown error',
          inline: false
        },
        {
          name: 'Stack',
          value: error.stack || 'No stack trace',
          inline: false
        }
      ]
    };

    await this.sendMessage(message);
  }

  /**
   * Send success message
   */
  public async sendSuccess(title: string, description: string): Promise<void> {
    const message: DiscordMessage = {
      title: `✅ ${title}`,
      description,
      color: 0x00ff00
    };

    await this.sendMessage(message);
  }

  /**
   * Send warning message
   */
  public async sendWarning(title: string, description: string): Promise<void> {
    const message: DiscordMessage = {
      title: `⚠️ ${title}`,
      description,
      color: 0xffff00
    };

    await this.sendMessage(message);
  }

  /**
   * Send info message
   */
  public async sendInfo(title: string, description: string): Promise<void> {
    const message: DiscordMessage = {
      title: `ℹ️ ${title}`,
      description,
      color: 0x0000ff
    };

    await this.sendMessage(message);
  }
} 