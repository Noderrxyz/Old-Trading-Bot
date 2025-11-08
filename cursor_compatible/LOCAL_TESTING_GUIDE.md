# 🚀 Noderr Protocol - Local Testing Guide

This guide will help you set up and test the Noderr Protocol trading system locally on your laptop.

## 📋 Prerequisites

- **Node.js** v16.0.0 or higher
- **npm** or **yarn** package manager
- **Windows 10/11** (based on your setup)

## 🛠️ Quick Start

### Option 1: Using NPM Scripts (Recommended)

```bash
# Install dependencies
npm install

# Start local test
npm run dev

# Or with auto-restart on changes
npm run dev:watch
```

### Option 2: Using Startup Scripts

#### Windows Command Prompt:
```cmd
start-local.bat
```

#### PowerShell:
```powershell
.\start-local.ps1
```

#### Direct TypeScript:
```bash
npx ts-node test-local.ts
```

## 🎮 Interactive Commands

Once the system is running, you can use these keyboard commands:

- **`s`** - Show detailed system status
- **`p`** - Pause trading (switch to PAUSED mode)
- **`r`** - Resume trading (switch back to SIMULATION mode)
- **`q`** - Quit gracefully

## 📊 What Happens During Local Testing

1. **System Initialization**
   - Safety controller starts in SIMULATION mode
   - Capital manager initializes with $100,000 test capital
   - Data connectors prepare for Binance testnet connection
   - Test momentum strategy is registered

2. **Simulated Trading**
   - Test signals are generated every 5 seconds
   - Alpha orchestrator processes signals
   - Test trades are executed (no real money)
   - Performance metrics are tracked

3. **Status Updates**
   - System status displayed every 30 seconds
   - Shows uptime, signals processed, capital status
   - Displays data feed connections

## 🔧 Configuration

The test configuration is in `test-local.ts`:

```typescript
const testConfig: SystemConfig = {
  mode: 'local',
  tradingMode: 'SIMULATION',
  initialCapital: 100000,  // $100k test capital
  
  dataConnectors: {
    binance: {
      enabled: true,
      testnet: true,
      symbols: ['BTC-USDT', 'ETH-USDT', 'BNB-USDT']
    }
  },
  
  strategies: {
    enabled: ['test-momentum'],
    config: {
      'test-momentum': {
        riskPerTrade: 0.02,
        stopLoss: 0.03,
        takeProfit: 0.05,
        minConfidence: 0.65
      }
    }
  }
};
```

## 🛡️ Safety Features

During local testing:
- **No real trades** are executed
- **No real money** is at risk
- All trades are simulated
- Safety controller enforces SIMULATION mode

## 📈 Understanding the Output

```
📈 System Status Update:
   Uptime: 5m 23s
   Trading Mode: SIMULATION
   Alpha Signals: 64
   Alpha Events: 12
   Capital - Total: $100,000
   Capital - Available: $89,500
   Data Feeds: Binance(connected), Coinbase(disabled)
```

- **Uptime**: How long the system has been running
- **Trading Mode**: Current safety mode (SIMULATION/PAUSED/LIVE)
- **Alpha Signals**: Raw signals received from all sources
- **Alpha Events**: Filtered signals sent to strategies
- **Capital**: Total and available capital for trading
- **Data Feeds**: Connection status of exchanges

## 🐛 Troubleshooting

### Common Issues

1. **"Cannot find module" errors**
   ```bash
   npm install
   npm run build
   ```

2. **"Permission denied" on scripts**
   ```powershell
   # Run as Administrator
   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
   ```

3. **TypeScript errors**
   ```bash
   npm install -g typescript ts-node
   ```

4. **Port already in use**
   - Check if another instance is running
   - Kill any zombie Node.js processes

### Debug Mode

For more detailed logging:
```bash
# Set debug environment variable
set LOG_LEVEL=debug
npm run dev
```

## 🎯 Next Steps

1. **Monitor Performance**
   - Watch the status updates
   - Check simulated P&L
   - Review trade execution logs

2. **Modify Configuration**
   - Add more trading pairs
   - Adjust strategy parameters
   - Change capital allocation

3. **Test Safety Features**
   - Try emergency stop (Ctrl+C)
   - Test mode switching
   - Verify all safety checks

4. **Prepare for Production**
   - Review all configurations
   - Set up real API keys (when ready)
   - Complete safety checklist

## 🚨 Important Notes

- This is **SIMULATION MODE** - no real trading occurs
- To enable live trading, multiple safety checks must pass
- Never commit API keys or sensitive data to git
- Always test thoroughly before considering production use

## 📞 Support

If you encounter issues:
1. Check the console output for error messages
2. Review log files in the `logs/` directory
3. Ensure all dependencies are installed
4. Verify your Node.js version is compatible

---

**Remember**: This local test environment is designed for safe experimentation. Take your time to understand how the system works before considering any real trading deployment. 