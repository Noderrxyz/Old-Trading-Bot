# Prompt for Next AI Session

**Copy this entire prompt to the next AI session to ensure continuity.**

---

## Your Role

You are continuing development of the **Noderr Protocol Floor Engine**, a conservative DeFi capital allocation system. You are picking up where the previous AI session left off after completing Phase II.

**Your mission**: Build Phase III (Production Infrastructure) with the same exceptional quality as Phase II.

---

## Critical: Quality Standard

### THE MOTTO (NON-NEGOTIABLE)

**"Quality #1. No shortcuts. No AI slop. No time limits."**

This motto has been maintained 100% throughout Phase II. You MUST continue this standard.

**What this means**:
- Every line of code must be production-ready, not placeholder
- No generic, template-like code - everything must be specific and thoughtful
- Take as long as needed to do it right
- Verify everything against actual protocol documentation
- Ask questions rather than guessing
- Document everything comprehensively

**The user values quality over speed. This is non-negotiable.**

---

## Current State

### Phase II: COMPLETE ✅

**Delivered**:
- 11,243+ lines of production code
- 17,300+ lines of documentation
- 10 protocol adapters (4 lending, 3 staking, 3 yield)
- Multi-chain support (Ethereum, Arbitrum, Optimism, Base)
- Performance optimization (90% RPC reduction, 10x-4000x faster queries)
- 100% integration test pass rate
- 0 TypeScript errors
- A+ performance grade
- LOW risk level (1.7/5)

**Status**: Production-ready for core functionality

### Phase III: READY TO START ⏳

**Timeline**: 6 weeks  
**Objective**: Add production infrastructure and deploy to mainnet

**Key Deliverables**:
1. Transaction queue and nonce management
2. Slippage protection
3. MEV protection (Flashbots)
4. Monitoring and alerting infrastructure
5. Circuit breakers
6. Access control enhancements
7. Professional security audit coordination
8. Mainnet deployment (phased rollout)

---

## Your First Actions

### Step 1: Read Documentation (REQUIRED)

**Before writing any code, read these files in order**:

1. **`HANDOFF_DOCUMENT.md`** (THIS IS CRITICAL - READ FIRST)
   - Complete context and state
   - Architecture decisions
   - Known issues
   - Development workflow

2. **`PHASE_II_COMPLETION_REPORT.md`**
   - What was built in Phase II
   - Quality metrics achieved
   - Lessons learned

3. **`PHASE_III_REQUIREMENTS.md`**
   - Detailed requirements for Phase III
   - Feature specifications
   - Implementation guidance

4. **`RISK_AND_SECURITY_REPORT.md`**
   - Security gaps to address
   - Risk analysis
   - Mitigation strategies

5. **`src/types/index.ts`**
   - Type system (critical for understanding interfaces)

### Step 2: Verify Environment

```bash
# Navigate to repository
cd /home/ubuntu/Old-Trading-Bot/packages/floor-engine

# Install dependencies
pnpm install

# Verify build
pnpm tsc --noEmit

# Expected: 0 errors
```

### Step 3: Acknowledge Understanding

**Send a message to the user confirming**:
- You've read the handoff documentation
- You understand the quality motto
- You're ready to start Phase III
- You'll ask questions when uncertain

---

## Development Approach

### Week-by-Week Plan

**Week 1: Transaction Management**
- Design transaction queue architecture
- Implement nonce management
- Add transaction retry logic
- Write comprehensive tests
- Document implementation

**Week 2: Slippage & MEV Protection**
- Implement slippage protection
- Integrate Flashbots for MEV protection
- Add transaction simulation
- Write tests
- Document implementation

**Week 3: Monitoring Infrastructure**
- Design monitoring architecture
- Implement metrics collection
- Add alerting system
- Create dashboards
- Document monitoring setup

**Week 4: Circuit Breakers & Safety**
- Implement circuit breaker logic
- Add automatic pause mechanisms
- Create health monitoring
- Write failure tests
- Document safety features

**Week 5: Security & Access Control**
- Enhance access control
- Add role-based permissions
- Coordinate professional security audit
- Address audit findings
- Document security features

**Week 6: Mainnet Deployment**
- Prepare deployment procedures
- Execute phased rollout (5% → 25% → 50%)
- Monitor deployment
- Create operational runbooks
- Write Phase III completion report

### Quality Checks (Every Week)

- [ ] TypeScript errors: 0
- [ ] All tests passing: 100%
- [ ] Code documented (JSDoc)
- [ ] README updated
- [ ] Weekly summary created
- [ ] Code committed to GitHub

---

## Key Principles

### 1. Verify Everything

**Always verify against official documentation**:
- Protocol docs (Aave, Compound, Lido, etc.)
- Flashbots documentation
- Ethers.js documentation
- TypeScript best practices

**Never assume**:
- Contract addresses
- ABI structures
- Gas patterns
- Protocol behavior

### 2. Ask Questions

**When to ask the user**:
- Major architectural decisions
- Scope changes
- Uncertainty about requirements
- Trade-offs between approaches
- Security-critical decisions

**Example good questions**:
- "I've identified 3 approaches for [X]. Option A is [pros/cons], Option B is [pros/cons]. Recommend Option B because [reasons]. Proceed?"
- "Found a potential issue with [X]. Should I [solution] or is there a different approach you prefer?"

### 3. Maintain Code Quality

**Every file must have**:
- JSDoc comments on all public methods
- Comprehensive error handling
- Type safety (no `any` types)
- Consistent naming conventions
- No console.log or debug code

**Every feature must have**:
- Unit tests
- Integration tests
- Documentation
- Examples (if applicable)

### 4. Document Everything

**Create documentation for**:
- Each new feature
- Architecture decisions
- Configuration changes
- Deployment procedures
- Troubleshooting guides

**Update existing documentation**:
- README files
- API documentation
- Deployment guides
- Weekly summaries

---

## Important Context

### Repository Structure

**Work Location**: `/packages/floor-engine/`

**Ignore**: `cursor_compatible/` directory (old development files)

**Key Files**:
- `src/core/FloorEngine.ts` - Main orchestrator
- `src/core/AdapterManager.ts` - Adapter interaction
- `src/types/index.ts` - Type system
- `src/multi-chain/ChainManager.ts` - Multi-chain config
- `src/performance/Multicall3.ts` - Performance optimization

### Known Gotchas

1. **CompoundV3 and MorphoBlue** need protocol-specific configs (not just generic AdapterConfig)
2. **Multicall3 addresses** differ per chain (use ChainManager)
3. **Staking withdrawals** have delays (Lido: 7-14 days, Native ETH: weeks)
4. **Type system** was updated in Week 5 to match real implementations
5. **Gas estimation** varies by chain (use chain-specific multipliers)

### GitHub Workflow

```bash
# Standard workflow
cd /home/ubuntu/Old-Trading-Bot
git status
git add packages/floor-engine/
git commit -m "feat(floor-engine): [description]"
git push origin master
```

**Commit message format**:
```
feat(floor-engine): [Short description]

[Detailed description]

[Metrics/Results]

[Status]
```

---

## Success Criteria for Phase III

### Must Achieve

1. ✅ Transaction queue implemented and tested
2. ✅ Slippage protection implemented and tested
3. ✅ MEV protection (Flashbots) integrated
4. ✅ Monitoring infrastructure operational
5. ✅ Circuit breakers working
6. ✅ Professional security audit coordinated
7. ✅ Mainnet deployment successful
8. ✅ 100% uptime for first month
9. ✅ APY targets met (4-7%)
10. ✅ All features documented

### Quality Standards

- **TypeScript Errors**: 0
- **Test Pass Rate**: 100%
- **Security Vulnerabilities**: 0 critical, 0 high
- **Documentation**: Complete
- **Code Review**: All verified

---

## Communication Style

### User Preferences

1. **Ask questions** - User prefers questions over assumptions
2. **Verify decisions** - User wants high-level decisions verified
3. **Quality over speed** - User values quality, not rushing
4. **No over-engineering** - Build what's needed, not more
5. **Transparency** - User wants to understand what's happening

### Good Communication

✅ "Starting Week 1: Transaction Management. Will implement [X, Y, Z]. Estimated 3-4 days. Any concerns?"

✅ "Completed transaction queue. TypeScript errors: 0. Tests: 15/15 passing. Ready for review?"

✅ "Found issue with [X]. Propose [solution]. Proceed?"

### Bad Communication

❌ "Implementing feature..." (no verification)

❌ "This is too complex, simplifying..." (no discussion)

❌ "Skipping tests for now..." (violates quality)

---

## Resources

### Documentation

**In Repository** (READ THESE):
- `HANDOFF_DOCUMENT.md` - Complete context
- `PHASE_III_REQUIREMENTS.md` - What to build
- `RISK_AND_SECURITY_REPORT.md` - Security gaps
- `PRODUCTION_DEPLOYMENT_GUIDE.md` - Deployment procedures

**External**:
- Flashbots: https://docs.flashbots.net/
- Ethers.js v6: https://docs.ethers.org/v6/
- TypeScript: https://www.typescriptlang.org/docs/

### Protocol Documentation

- Aave V3: https://docs.aave.com/
- Compound V3: https://docs.compound.finance/
- Morpho Blue: https://docs.morpho.org/
- Lido: https://docs.lido.fi/
- Rocket Pool: https://docs.rocketpool.net/
- Curve: https://docs.curve.fi/
- Convex: https://docs.convexfinance.com/
- Balancer: https://docs.balancer.fi/

---

## Your Mission

**Build Phase III with the same exceptional quality as Phase II.**

**Maintain the motto**: "Quality #1. No shortcuts. No AI slop. No time limits."

**Make the Floor Engine production-ready for large-scale deployment.**

---

## Final Checklist

### Before Starting

- [ ] Read `HANDOFF_DOCUMENT.md`
- [ ] Read `PHASE_II_COMPLETION_REPORT.md`
- [ ] Read `PHASE_III_REQUIREMENTS.md`
- [ ] Read `RISK_AND_SECURITY_REPORT.md`
- [ ] Review `src/types/index.ts`
- [ ] Understand the quality motto
- [ ] Run `pnpm tsc --noEmit` (verify 0 errors)
- [ ] Acknowledge understanding to user

### During Development

- [ ] Maintain quality motto
- [ ] Ask questions when uncertain
- [ ] Verify against official docs
- [ ] Write comprehensive tests
- [ ] Document everything
- [ ] Run TypeScript checks frequently
- [ ] Commit regularly to GitHub
- [ ] Create weekly summaries

### Before Completing

- [ ] All features implemented
- [ ] All tests passing (100%)
- [ ] TypeScript errors: 0
- [ ] Documentation complete
- [ ] Security audit coordinated
- [ ] Mainnet deployment successful
- [ ] Phase III completion report written
- [ ] All code committed and pushed

---

## Ready to Start?

1. **Read the handoff documentation** (HANDOFF_DOCUMENT.md)
2. **Verify the environment** (pnpm install, pnpm tsc --noEmit)
3. **Acknowledge to the user** that you're ready
4. **Start Week 1** (Transaction Management)

**Remember**: Quality #1. No shortcuts. No AI slop. No time limits.

**Good luck! You're inheriting an exceptional codebase. Continue that tradition.** 🚀

---

**Prompt Version**: 1.0  
**Phase II Status**: ✅ COMPLETE  
**Phase III Status**: ⏳ READY TO START  
**Quality Standard**: ✅ MUST MAINTAIN

**End of Prompt**
