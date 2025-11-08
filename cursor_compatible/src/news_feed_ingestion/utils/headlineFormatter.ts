import { RawHeadline, EnrichedHeadline, Entity } from '../../altdata/types.js';
import { createLogger } from '../../common/logger.js';

const logger = createLogger('HeadlineFormatter');

/**
 * Utilities for processing and formatting headlines
 */
export class HeadlineFormatter {
  /**
   * Extract asset mentions from headline text
   * This is a simple implementation that looks for common crypto ticker patterns
   * A more sophisticated version would use NLP or a predefined list of assets
   */
  public static extractAssetMentions(text: string): string[] {
    // Simple regex to match potential crypto tickers
    // Looking for uppercase words 2-5 letters long, potentially preceded by $
    const tickerRegex = /\$?([A-Z]{2,5})\b/g;
    const matches = text.match(tickerRegex);
    
    if (!matches) return [];
    
    // Remove $ prefix if present and deduplicate
    return [...new Set(
      matches.map(match => match.startsWith('$') ? match.substring(1) : match)
    )];
  }

  /**
   * Clean and normalize headline text
   */
  public static normalizeHeadlineText(text: string): string {
    // Remove excessive whitespace
    let normalized = text.replace(/\s+/g, ' ').trim();
    
    // Remove common prefixes often found in news headlines
    const prefixesToRemove = [
      'BREAKING: ',
      'JUST IN: ',
      'UPDATE: ',
      'EXCLUSIVE: ',
      'REPORT: '
    ];
    
    for (const prefix of prefixesToRemove) {
      if (normalized.startsWith(prefix)) {
        normalized = normalized.substring(prefix.length);
      }
    }
    
    return normalized;
  }

  /**
   * Format a date string to ISO format
   */
  public static formatDateToISO(dateStr: string): string {
    try {
      const date = new Date(dateStr);
      return date.toISOString();
    } catch (e) {
      logger.warn(`Failed to parse date: ${dateStr}`);
      return new Date().toISOString(); // Return current date as fallback
    }
  }

  /**
   * Generate a unique ID for a headline if not provided
   */
  public static generateHeadlineId(headline: RawHeadline): string {
    if (headline.id) return headline.id;
    
    // Create an ID based on source and title hash
    const sourcePrefix = headline.source
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .substring(0, 10);
    
    const titleHash = this.simpleHash(headline.title);
    const timestamp = new Date(headline.publishedAt).getTime();
    
    return `${sourcePrefix}-${titleHash}-${timestamp}`;
  }

  /**
   * Create a simple hash from a string
   */
  private static simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16);
  }

  /**
   * Detect duplicates or near-duplicates in a set of headlines
   * Returns headline IDs that are likely duplicates
   */
  public static detectDuplicates(headlines: RawHeadline[]): string[] {
    const duplicateIds: string[] = [];
    const titleMap = new Map<string, string[]>();
    
    // Process each headline to create a normalized version for comparison
    headlines.forEach(headline => {
      const normalizedTitle = this.normalizeHeadlineText(headline.title)
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '') // Remove special chars
        .trim();
      
      if (titleMap.has(normalizedTitle)) {
        // This is a duplicate - add its ID to the list
        titleMap.get(normalizedTitle)!.push(headline.id);
        duplicateIds.push(headline.id);
      } else {
        // First occurrence
        titleMap.set(normalizedTitle, [headline.id]);
      }
    });
    
    return duplicateIds;
  }
} 