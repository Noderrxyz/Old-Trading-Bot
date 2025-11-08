import { 
  RawHeadline, 
  ClassificationResult, 
  HeadlineCategory,
  Entity, 
  EntityType,
  ClassifiedHeadline
} from '../types';

/**
 * HeadlineClassifier
 * 
 * Classifies headlines into categories, extracts entities, 
 * and identifies asset mentions to provide context
 */
export class HeadlineClassifier {
  private categoryKeywords: Record<HeadlineCategory, string[]>;
  private entityPatterns: Record<EntityType, RegExp[]>;
  private cryptoTickers: Set<string>;
  private cryptoNames: Record<string, string>; // Maps names to tickers

  constructor() {
    // Initialize category keywords
    this.categoryKeywords = {
      'Regulatory': [
        'sec', 'regulation', 'regulator', 'compliance', 'legal', 'law', 'ban', 'approve',
        'reject', 'filing', 'rule', 'sanction', 'legislat', 'govern', 'policy', 'cftc',
        'congress', 'senate', 'regulatory', 'approval', 'license', 'authorize', 'court',
        'judge', 'ruling', 'decision', 'regulators', 'lawsuit', 'sue', 'etf', 'illegal'
      ],
      'Market': [
        'price', 'market', 'trade', 'trading', 'volatility', 'rally', 'crash', 'surge',
        'plummet', 'drop', 'jump', 'plunge', 'rise', 'fall', 'bull', 'bear', 'volume',
        'liquidity', 'momentum', 'resistance', 'support', 'trend', 'correction', 'ath',
        'all-time high', 'all time high', 'all-time low', 'all time low', 'record high', 
        'record low', 'market cap', 'marketcap', 'valuation', 'overbought', 'oversold'
      ],
      'Hack': [
        'hack', 'exploit', 'vulnerability', 'attack', 'stolen', 'theft', 'breach', 'security',
        'compromise', 'malicious', 'phishing', 'scam', 'fraud', 'ransomware', 'heist',
        'drain', 'steal', 'loss', 'million', 'billion', 'funds', 'vulnerability', 'bug',
        'cyber', 'launder', 'recover', 'patch', 'loophole'
      ],
      'Adoption': [
        'adopt', 'use', 'accept', 'integration', 'implement', 'deploy', 'launch', 'roll out',
        'introduce', 'support', 'enable', 'onboard', 'merchant', 'payment', 'service',
        'platform', 'app', 'application', 'solution', 'retail', 'institution', 'bank',
        'enterprise', 'corporate', 'business', 'consumer', 'customer', 'user', 'client'
      ],
      'Technology': [
        'update', 'upgrade', 'release', 'version', 'protocol', 'network', 'mainnet', 'testnet',
        'hard fork', 'soft fork', 'hardfork', 'softfork', 'fork', 'consensus', 'scaling',
        'layer', 'chain', 'crosschain', 'cross-chain', 'bridge', 'interoperability', 'smart contract',
        'defi', 'nft', 'dao', 'dex', 'wallet', 'mining', 'staking', 'validation'
      ],
      'Partnership': [
        'partner', 'collaborate', 'alliance', 'joint', 'team', 'agreement', 'deal', 'contract',
        'sign', 'strategic', 'relationship', 'cooperation', 'ecosystem', 'network', 'integrate',
        'work with', 'join forces', 'together', 'consortium'
      ],
      'Opinion': [
        'predict', 'expect', 'forecast', 'outlook', 'analysis', 'perspective', 'view', 
        'believe', 'think', 'suggests', 'indicates', 'points to', 'according to', 'says', 
        'claims', 'argues', 'argues', 'bullish', 'bearish', 'optimistic', 'pessimistic', 
        'could', 'might', 'may', 'should', 'would'
      ],
      'Other': []
    };

    // Initialize entity recognition patterns
    this.entityPatterns = {
      'Exchange': [
        /\b(?:Binance|Coinbase|Kraken|FTX|Gemini|Bitstamp|Bitfinex|OKEx|Huobi|KuCoin|BitMEX|Bybit|Bittrex|Poloniex)\b/gi,
      ],
      'Regulator': [
        /\b(?:SEC|Securities and Exchange Commission|CFTC|Commodity Futures Trading Commission|FCA|Financial Conduct Authority|FINMA|OCC|NYDFS|ASIC|MAS|RBI|FSA|CSA)\b/gi,
      ],
      'Company': [
        /\b(?:Grayscale|Microstrategy|Square|Tesla|Apple|Meta|Facebook|Google|Microsoft|JP Morgan|Goldman Sachs|BlackRock|Fidelity|NYDIG|Robinhood|PayPal|Visa|Mastercard)\b/gi,
      ],
      'Person': [
        /\b(?:Satoshi Nakamoto|Vitalik Buterin|Elon Musk|Michael Saylor|Brian Armstrong|Sam Bankman-Fried|SBF|CZ|Changpeng Zhao|Gary Gensler|Jerome Powell|Janet Yellen|Jack Dorsey|Mark Cuban|Cathie Wood)\b/gi,
      ],
      'Cryptocurrency': [
        /\b(?:Bitcoin|Ethereum|Ripple|XRP|Litecoin|Cardano|Solana|Avalanche|Polkadot|Chainlink|Tether|USDT|USDC|BNB|Binance Coin|Matic|Polygon|Dogecoin|Shiba Inu)\b/gi,
      ],
      'Protocol': [
        /\b(?:Uniswap|Aave|Compound|MakerDAO|Curve|SushiSwap|PancakeSwap|DeFi|DAO|DEX|NFT|Lightning Network|Layer 2|Arbitrum|Optimism|Sidechain|dApp)\b/gi,
      ],
      'Country': [
        /\b(?:US|USA|United States|China|India|Russia|UK|United Kingdom|EU|European Union|Japan|South Korea|Singapore|Switzerland|Germany|Brazil|Canada|Australia)\b/gi,
      ],
      'Other': [
        /\b(?:Web3|Metaverse|ICO|IEO|STO|IPO|ATH|ATL|HODL|FUD|FOMO|Whale|Bull|Bear|Mining|Staking|Halving|Wallet|Cold Storage|Smart Contract|Token)\b/gi,
      ]
    };

    // Initialize crypto ticker recognition
    this.cryptoTickers = new Set([
      'BTC', 'ETH', 'XRP', 'LTC', 'ADA', 'SOL', 'DOT', 'AVAX', 'LINK', 'MATIC',
      'DOGE', 'SHIB', 'UNI', 'AAVE', 'CRV', 'SUSHI', 'COMP', 'MKR', 'YFI', 'SNX',
      'NEAR', 'FTM', 'ATOM', 'ALGO', 'XLM', 'BCH', 'ETC', 'TRX', 'EOS', 'CAKE',
      'FIL', 'HBAR', 'VET', 'SAND', 'MANA', 'GALA', 'AXS', 'ICP', 'XTZ', 'KSM',
      'GRT', 'CHZ', 'BAT', 'LRC', 'CRO', 'FTT', 'NEXO', 'CEL', 'EGLD', 'XMR'
    ]);

    // Map of cryptocurrency names to their tickers
    this.cryptoNames = {
      'bitcoin': 'BTC',
      'ethereum': 'ETH',
      'ripple': 'XRP',
      'litecoin': 'LTC',
      'cardano': 'ADA',
      'solana': 'SOL',
      'polkadot': 'DOT',
      'avalanche': 'AVAX',
      'chainlink': 'LINK',
      'polygon': 'MATIC',
      'matic': 'MATIC',
      'dogecoin': 'DOGE',
      'shiba inu': 'SHIB',
      'uniswap': 'UNI',
      'aave': 'AAVE',
      'curve': 'CRV',
      'sushiswap': 'SUSHI',
      'compound': 'COMP',
      'maker': 'MKR',
      'yearn': 'YFI',
      'synthetix': 'SNX',
      'near protocol': 'NEAR',
      'fantom': 'FTM',
      'cosmos': 'ATOM',
      'algorand': 'ALGO',
      'stellar': 'XLM',
      'bitcoin cash': 'BCH',
      'ethereum classic': 'ETC',
      'tron': 'TRX',
      'eos': 'EOS',
      'pancakeswap': 'CAKE',
      'filecoin': 'FIL',
      'hedera': 'HBAR',
      'vechain': 'VET',
      'the sandbox': 'SAND',
      'decentraland': 'MANA',
      'gala': 'GALA',
      'axie infinity': 'AXS',
      'internet computer': 'ICP',
      'tezos': 'XTZ',
      'kusama': 'KSM',
      'the graph': 'GRT',
      'chiliz': 'CHZ',
      'basic attention token': 'BAT',
      'loopring': 'LRC',
      'cronos': 'CRO',
      'ftx token': 'FTT',
      'nexo': 'NEXO',
      'celsius': 'CEL',
      'elrond': 'EGLD',
      'monero': 'XMR'
    };
  }

  /**
   * Classifies a headline, extracting categories, entities, and assets
   * @param headline The raw headline to classify
   * @returns Classification result
   */
  public classify(headline: RawHeadline): ClassificationResult {
    const text = `${headline.title} ${headline.content || ''}`.toLowerCase();

    // Detect the primary category
    const category = this.detectCategory(text);
    
    // Extract tags
    const tags = this.extractTags(text, category);
    
    // Detect entities
    const entities = this.detectEntities(text);

    // Extract asset mentions
    const assetMentions = this.extractAssetMentions(text, entities);

    // Calculate confidence score
    const confidence = this.calculateConfidence(category, entities, assetMentions);

    return {
      category,
      tags,
      entities,
      assetMentions,
      confidence
    };
  }

  /**
   * Detects the primary category of a headline
   * @param text The headline text to analyze
   * @returns The detected category
   */
  private detectCategory(text: string): HeadlineCategory {
    const scores: Record<HeadlineCategory, number> = {
      'Regulatory': 0,
      'Market': 0,
      'Hack': 0,
      'Adoption': 0,
      'Technology': 0,
      'Partnership': 0,
      'Opinion': 0,
      'Other': 0
    };

    // Score each category based on keyword matches
    for (const [category, keywords] of Object.entries(this.categoryKeywords)) {
      for (const keyword of keywords) {
        // Use regex to find all occurrences, including word boundaries
        const regex = new RegExp(`\\b${keyword}\\w*\\b`, 'gi');
        const matches = text.match(regex);
        if (matches) {
          // Add more weight to matches in the title
          scores[category as HeadlineCategory] += matches.length;
        }
      }
    }

    // Find the category with the highest score
    let maxScore = 0;
    let maxCategory: HeadlineCategory = 'Other';

    for (const [category, score] of Object.entries(scores)) {
      if (score > maxScore) {
        maxScore = score;
        maxCategory = category as HeadlineCategory;
      }
    }

    // If no strong match found, set to 'Other'
    if (maxScore < 2) {
      maxCategory = 'Other';
    }

    return maxCategory;
  }

  /**
   * Extracts relevant tags from the headline text
   * @param text The headline text to analyze
   * @param category The detected primary category
   * @returns Array of tags
   */
  private extractTags(text: string, category: HeadlineCategory): string[] {
    const tags: Set<string> = new Set();

    // Add the category as a tag
    tags.add(category.toLowerCase());

    // Extract additional relevant tags based on content
    if (text.includes('price') || text.includes('market') || 
        text.includes('bull') || text.includes('bear')) {
      tags.add('price');
    }

    if (text.includes('etf')) {
      tags.add('etf');
    }

    if (text.includes('sec') || text.includes('regulation') || 
        text.includes('compliance') || text.includes('law')) {
      tags.add('regulation');
    }

    if (text.includes('hack') || text.includes('scam') || 
        text.includes('attack') || text.includes('breach')) {
      tags.add('security');
    }

    if (text.includes('adopt') || text.includes('partner') || text.includes('launch')) {
      tags.add('adoption');
    }

    if (text.includes('nft') || text.includes('token')) {
      tags.add('nft');
    }

    if (text.includes('defi') || text.includes('yield') || 
        text.includes('lending') || text.includes('loan')) {
      tags.add('defi');
    }

    if (text.includes('wallet') || text.includes('custod')) {
      tags.add('wallet');
    }

    if (text.includes('mining') || text.includes('hash') || text.includes('miner')) {
      tags.add('mining');
    }

    return Array.from(tags);
  }

  /**
   * Detects entities in the headline text
   * @param text The headline text to analyze
   * @returns Array of detected entities
   */
  private detectEntities(text: string): Entity[] {
    const entities: Entity[] = [];
    const seenEntities = new Set<string>();

    // For each entity type, apply the patterns and extract matches
    for (const [type, patterns] of Object.entries(this.entityPatterns)) {
      for (const pattern of patterns) {
        const matches = text.match(pattern);
        if (matches) {
          for (const match of matches) {
            const entityName = match.trim();
            
            // Skip duplicates
            if (seenEntities.has(entityName.toLowerCase())) {
              continue;
            }
            
            seenEntities.add(entityName.toLowerCase());
            
            entities.push({
              name: entityName,
              type: type as EntityType,
              confidence: 0.9 // Default confidence value
            });
          }
        }
      }
    }

    return entities;
  }

  /**
   * Extracts asset mentions (crypto tickers) from the headline
   * @param text The headline text
   * @param entities Detected entities
   * @returns Array of asset tickers
   */
  private extractAssetMentions(text: string, entities: Entity[]): string[] {
    const assetMentions: Set<string> = new Set();

    // Look for direct ticker mentions in the form of $BTC or BTC
    const tickerPattern = /\$?([A-Z]{2,5})\b/g;
    let match;
    while ((match = tickerPattern.exec(text)) !== null) {
      const ticker = match[1].toUpperCase();
      if (this.cryptoTickers.has(ticker)) {
        assetMentions.add(ticker);
      }
    }

    // Add cryptocurrencies from detected entities
    for (const entity of entities) {
      if (entity.type === 'Cryptocurrency') {
        const name = entity.name.toLowerCase();
        if (this.cryptoNames[name]) {
          assetMentions.add(this.cryptoNames[name]);
        }
      }
    }

    // Look for cryptocurrency names in the text
    for (const [name, ticker] of Object.entries(this.cryptoNames)) {
      if (text.toLowerCase().includes(name)) {
        assetMentions.add(ticker);
      }
    }

    return Array.from(assetMentions);
  }

  /**
   * Calculates the confidence score for the classification
   * @param category Detected category
   * @param entities Detected entities
   * @param assetMentions Detected asset mentions
   * @returns Confidence score (0-1)
   */
  private calculateConfidence(
    category: HeadlineCategory,
    entities: Entity[],
    assetMentions: string[]
  ): number {
    let confidence = 0.5; // Base confidence

    // Adjust confidence based on category
    if (category !== 'Other') {
      confidence += 0.1;
    }

    // Adjust confidence based on entities
    if (entities.length > 0) {
      confidence += Math.min(0.2, entities.length * 0.05);
    }

    // Adjust confidence based on asset mentions
    if (assetMentions.length > 0) {
      confidence += Math.min(0.2, assetMentions.length * 0.1);
    }

    // Cap at 1.0
    return Math.min(confidence, 1.0);
  }
}

/**
 * Singleton instance of headline classifier
 */
const classifier = new HeadlineClassifier();

/**
 * Classifies a headline using the singleton classifier instance
 * @param headline The raw headline to classify
 * @returns Classified headline with category, tags, entities and asset mentions
 */
export function classifyHeadline(headline: RawHeadline): ClassifiedHeadline {
  const classification = classifier.classify(headline);
  
  return {
    ...headline,
    ...classification
  };
} 