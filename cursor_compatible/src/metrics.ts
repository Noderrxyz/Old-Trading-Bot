// Minimal Prometheus metrics endpoint for Express
import express from 'express';
const router = express.Router();

// Example custom metrics (replace with real trading metrics)
let tradeCount = 0;
let lastErrorCount = 0;

router.get('/metrics', (req, res) => {
  res.set('Content-Type', 'text/plain');
  res.send(
    `# HELP noderr_trade_count Total number of trades\n` +
    `# TYPE noderr_trade_count counter\n` +
    `noderr_trade_count ${tradeCount}\n` +
    `# HELP noderr_error_count Total number of errors\n` +
    `# TYPE noderr_error_count counter\n` +
    `noderr_error_count ${lastErrorCount}\n`
  );
});

export default router; 