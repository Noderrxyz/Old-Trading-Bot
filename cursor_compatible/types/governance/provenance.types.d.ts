export interface VoteRecord {
    agentDid: string;
    signature: string;
    vote: 'yes' | 'no' | 'abstain';
    role: 'validator' | 'guardian' | 'builder';
    weight: number;
    timestamp: number;
    verified?: boolean;
}
export interface QuorumSummary {
    totalVotes: number;
    requiredQuorum: number;
    roles: {
        [role: string]: {
            required: number;
            casted: number;
            met: boolean;
        };
    };
    passed: boolean;
}
//# sourceMappingURL=provenance.types.d.ts.map