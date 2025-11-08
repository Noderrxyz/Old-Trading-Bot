"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignalElection = void 0;
const events_1 = require("events");
const createLogger = (name) => ({
    info: (message, meta) => console.log(`[${name}] INFO:`, message, meta || ''),
    error: (message, error) => console.error(`[${name}] ERROR:`, message, error || ''),
    debug: (message, meta) => console.debug(`[${name}] DEBUG:`, message, meta || ''),
    warn: (message, meta) => console.warn(`[${name}] WARN:`, message, meta || '')
});
class SignalElection extends events_1.EventEmitter {
    logger;
    signalSources;
    activeSignals;
    electionHistory;
    conflictResolutions;
    electionInterval = null;
    constructor() {
        super();
        this.logger = createLogger('SignalElection');
        this.signalSources = new Map();
        this.activeSignals = new Map();
        this.electionHistory = [];
        this.conflictResolutions = [];
        this.initializeSignalSources();
    }
    initializeSignalSources() {
        // AI-based sources
        this.registerSource({
            id: 'transformer_signals',
            name: 'Transformer Model',
            type: 'AI',
            reliability: 0.85,
            weight: 0.25,
            latency: 100
        });
        this.registerSource({
            id: 'rl_signals',
            name: 'RL Agent',
            type: 'AI',
            reliability: 0.80,
            weight: 0.20,
            latency: 150
        });
        // Technical analysis
        this.registerSource({
            id: 'technical_indicators',
            name: 'Technical Indicators',
            type: 'TECHNICAL',
            reliability: 0.70,
            weight: 0.15,
            latency: 50
        });
        // Sentiment analysis
        this.registerSource({
            id: 'sentiment_analyzer',
            name: 'Social Sentiment',
            type: 'SENTIMENT',
            reliability: 0.65,
            weight: 0.10,
            latency: 500
        });
        // On-chain metrics
        this.registerSource({
            id: 'onchain_metrics',
            name: 'On-chain Analysis',
            type: 'ONCHAIN',
            reliability: 0.75,
            weight: 0.15,
            latency: 1000
        });
        // Fundamental analysis
        this.registerSource({
            id: 'fundamental_analyzer',
            name: 'Fundamental Analysis',
            type: 'FUNDAMENTAL',
            reliability: 0.72,
            weight: 0.15,
            latency: 2000
        });
    }
    registerSource(source) {
        this.signalSources.set(source.id, source);
        this.logger.info(`Registered signal source: ${source.name}`, {
            type: source.type,
            reliability: source.reliability,
            weight: source.weight
        });
    }
    async submitSignal(signal) {
        const source = this.signalSources.get(signal.source);
        if (!source) {
            this.logger.warn(`Signal from unknown source: ${signal.source}`);
            return;
        }
        // Store signal by symbol
        const symbolSignals = this.activeSignals.get(signal.symbol) || [];
        // Remove old signals from the same source
        const filteredSignals = symbolSignals.filter(s => s.source !== signal.source);
        filteredSignals.push(signal);
        this.activeSignals.set(signal.symbol, filteredSignals);
        this.logger.debug(`Signal submitted`, {
            symbol: signal.symbol,
            source: signal.source,
            direction: signal.direction,
            strength: signal.strength
        });
        this.emit('signal-submitted', signal);
        // Trigger immediate election if high priority
        if (signal.strength > 0.8 && signal.confidence > 0.8) {
            await this.runElection(signal.symbol);
        }
    }
    startElectionCycle(intervalMs = 5000) {
        if (this.electionInterval) {
            clearInterval(this.electionInterval);
        }
        this.electionInterval = setInterval(() => {
            this.runAllElections();
        }, intervalMs);
        this.logger.info(`Started election cycle with ${intervalMs}ms interval`);
    }
    stopElectionCycle() {
        if (this.electionInterval) {
            clearInterval(this.electionInterval);
            this.electionInterval = null;
            this.logger.info('Stopped election cycle');
        }
    }
    async runAllElections() {
        const symbols = Array.from(this.activeSignals.keys());
        for (const symbol of symbols) {
            await this.runElection(symbol);
        }
    }
    async runElection(symbol) {
        const signals = this.activeSignals.get(symbol);
        if (!signals || signals.length === 0) {
            return null;
        }
        // Filter out stale signals (older than 5 minutes)
        const freshSignals = signals.filter(s => (Date.now() - s.timestamp.getTime()) < 300000);
        if (freshSignals.length === 0) {
            this.activeSignals.delete(symbol);
            return null;
        }
        this.logger.info(`Running signal election for ${symbol}`, {
            signalCount: freshSignals.length
        });
        // Detect conflicts
        const hasConflict = this.detectConflicts(freshSignals);
        let electedSignal;
        if (hasConflict) {
            electedSignal = await this.resolveConflicts(symbol, freshSignals);
        }
        else {
            electedSignal = this.aggregateSignals(symbol, freshSignals);
        }
        // Store election result
        this.electionHistory.push(electedSignal);
        // Emit elected signal
        this.emit('signal-elected', electedSignal);
        // Clean up processed signals
        this.activeSignals.set(symbol, freshSignals);
        return electedSignal;
    }
    detectConflicts(signals) {
        const directions = signals.map(s => s.direction);
        const uniqueDirections = new Set(directions);
        // Conflict exists if we have both LONG and SHORT signals
        return uniqueDirections.has('LONG') && uniqueDirections.has('SHORT');
    }
    async resolveConflicts(symbol, signals) {
        const conflict = {
            symbol,
            conflictingSignals: signals,
            resolution: 'WEIGHTED_AVERAGE'
        };
        // Try different resolution strategies
        const resolutions = {
            weightedAverage: this.resolveByWeightedAverage(symbol, signals),
            majorityVote: this.resolveByMajorityVote(symbol, signals),
            highestConfidence: this.resolveByHighestConfidence(symbol, signals)
        };
        // Choose the resolution with highest confidence
        let bestResolution = resolutions.weightedAverage;
        let bestConfidence = bestResolution.confidence;
        for (const [method, resolution] of Object.entries(resolutions)) {
            if (resolution.confidence > bestConfidence) {
                bestResolution = resolution;
                bestConfidence = resolution.confidence;
                conflict.resolution = method.toUpperCase();
            }
        }
        conflict.resolvedSignal = bestResolution;
        this.conflictResolutions.push(conflict);
        this.logger.info(`Resolved signal conflict for ${symbol}`, {
            method: conflict.resolution,
            direction: bestResolution.aggregatedDirection,
            confidence: bestResolution.confidence
        });
        this.emit('conflict-resolved', conflict);
        return bestResolution;
    }
    aggregateSignals(symbol, signals) {
        return this.resolveByWeightedAverage(symbol, signals);
    }
    resolveByWeightedAverage(symbol, signals) {
        let weightedLong = 0;
        let weightedShort = 0;
        let weightedNeutral = 0;
        let totalWeight = 0;
        const sources = [];
        for (const signal of signals) {
            const source = this.signalSources.get(signal.source);
            if (!source)
                continue;
            const weight = source.weight * source.reliability * signal.confidence;
            switch (signal.direction) {
                case 'LONG':
                    weightedLong += weight * signal.strength;
                    break;
                case 'SHORT':
                    weightedShort += weight * signal.strength;
                    break;
                case 'NEUTRAL':
                    weightedNeutral += weight * signal.strength;
                    break;
            }
            totalWeight += weight;
            sources.push({
                sourceId: signal.source,
                signal,
                contribution: weight
            });
        }
        // Normalize
        if (totalWeight > 0) {
            weightedLong /= totalWeight;
            weightedShort /= totalWeight;
            weightedNeutral /= totalWeight;
        }
        // Determine direction
        let direction;
        let strength;
        if (weightedLong > weightedShort && weightedLong > weightedNeutral) {
            direction = 'LONG';
            strength = weightedLong;
        }
        else if (weightedShort > weightedLong && weightedShort > weightedNeutral) {
            direction = 'SHORT';
            strength = weightedShort;
        }
        else {
            direction = 'NEUTRAL';
            strength = weightedNeutral;
        }
        // Calculate confidence based on agreement
        const maxWeight = Math.max(weightedLong, weightedShort, weightedNeutral);
        const confidence = maxWeight; // Higher concentration = higher confidence
        return {
            symbol,
            aggregatedDirection: direction,
            confidence,
            strength,
            sources,
            electionId: `election_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestamp: new Date()
        };
    }
    resolveByMajorityVote(symbol, signals) {
        const votes = { LONG: 0, SHORT: 0, NEUTRAL: 0 };
        const sources = [];
        for (const signal of signals) {
            const source = this.signalSources.get(signal.source);
            if (!source)
                continue;
            votes[signal.direction]++;
            sources.push({
                sourceId: signal.source,
                signal,
                contribution: 1 / signals.length
            });
        }
        const direction = (Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0]);
        const strength = signals
            .filter(s => s.direction === direction)
            .reduce((sum, s) => sum + s.strength, 0) / signals.filter(s => s.direction === direction).length;
        const confidence = votes[direction] / signals.length;
        return {
            symbol,
            aggregatedDirection: direction,
            confidence,
            strength: strength || 0,
            sources,
            electionId: `election_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestamp: new Date()
        };
    }
    resolveByHighestConfidence(symbol, signals) {
        const highestConfidenceSignal = signals.sort((a, b) => b.confidence - a.confidence)[0];
        const source = this.signalSources.get(highestConfidenceSignal.source);
        return {
            symbol,
            aggregatedDirection: highestConfidenceSignal.direction,
            confidence: highestConfidenceSignal.confidence * (source?.reliability || 1),
            strength: highestConfidenceSignal.strength,
            sources: [{
                    sourceId: highestConfidenceSignal.source,
                    signal: highestConfidenceSignal,
                    contribution: 1
                }],
            electionId: `election_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestamp: new Date()
        };
    }
    getElectionHistory(symbol, limit = 100) {
        let history = this.electionHistory;
        if (symbol) {
            history = history.filter(e => e.symbol === symbol);
        }
        return history.slice(-limit);
    }
    getConflictHistory(limit = 50) {
        return this.conflictResolutions.slice(-limit);
    }
    updateSourceReliability(sourceId, newReliability) {
        const source = this.signalSources.get(sourceId);
        if (source) {
            source.reliability = Math.max(0, Math.min(1, newReliability));
            this.logger.info(`Updated source reliability: ${sourceId} = ${newReliability}`);
            this.emit('source-updated', source);
        }
    }
    getSourcePerformance() {
        const performance = new Map();
        for (const source of this.signalSources.values()) {
            // This would be calculated from historical performance in production
            performance.set(source.id, {
                accuracy: source.reliability,
                signalCount: Math.floor(Math.random() * 1000) // Placeholder
            });
        }
        return performance;
    }
}
exports.SignalElection = SignalElection;
//# sourceMappingURL=SignalElection.js.map