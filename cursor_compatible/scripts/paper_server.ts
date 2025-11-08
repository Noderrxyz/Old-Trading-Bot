/* Minimal paper-mode HTTP server (no external deps) */
import http from 'http';
// Standalone paper-mode routing (no workspace deps)
type Exchange = { id: string; latency: number };
type Decision = { venue: string | null; score: number; routes: any[] };

const PORT = parseInt(process.env.PORT || '3000', 10);

const logger: any = {
  info: (...args: any[]) => console.log('[SOR]', ...args),
  debug: (...args: any[]) => console.log('[SOR]', ...args),
  warn: (...args: any[]) => console.warn('[SOR]', ...args),
  error: (...args: any[]) => console.error('[SOR]', ...args),
};

function buildPaperExchanges(venueIds: string[]): Exchange[] {
  return venueIds.map((id) => ({ id, latency: 300 + Math.floor(Math.random() * 200) }));
}

function loadSorFlags() {
  const enabledCsv = process.env.SOR_ENABLED_VENUES || 'uniswap_v3,sushiswap,0x_api';
  return {
    useProduction: (process.env.SOR_USE_PRODUCTION || 'false').toLowerCase() === 'true',
    enabledVenues: enabledCsv.split(',').map((s) => s.trim()).filter(Boolean),
  };
}

async function routePaper(symbol: string, side: 'buy'|'sell', quantity: number): Promise<Decision> {
  const flags = loadSorFlags();
  const exchanges = buildPaperExchanges(flags.enabledVenues);
  // Simple synthetic pricing
  const base = symbol.startsWith('BTC') ? 30000 : 2000;
  const mid = base * (1 + (Math.random() - 0.5) * 0.002);
  const venues = exchanges.map((ex) => {
    const priceImpactPct = Math.min(10, 0.1 + (quantity * mid) / 100000 * (0.5 + Math.random() * 0.5));
    const slippageDir = side === 'buy' ? 1 : -1;
    const price = mid * (1 + slippageDir * priceImpactPct / 100);
    const score = 1 / (priceImpactPct + ex.latency / 1000);
    return { ex, price, priceImpactPct, score };
  }).sort((a, b) => b.score - a.score);
  const best = venues[0];
  return {
    venue: best?.ex.id || null,
    score: best?.score || 0,
    routes: venues.slice(0, 3).map(v => ({ venue: v.ex.id, price: v.price, priceImpactPct: v.priceImpactPct }))
  };
}

function send(res: http.ServerResponse, code: number, body: any) {
  const data = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  if (!req.url) return send(res, 404, { error: 'not found' });

  if (req.method === 'GET' && req.url === '/') {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Noderr Paper Mode</title>
  <style>
    body{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:20px;background:#0b1020;color:#e6edf3}
    .card{background:#111830;border:1px solid #22305e;border-radius:10px;padding:16px;max-width:900px}
    input,select,button{padding:8px 10px;border-radius:6px;border:1px solid #334073;background:#0f172a;color:#e6edf3}
    button{cursor:pointer}
    .row{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}
    pre{background:#0a0f1e;border:1px solid #25325f;border-radius:8px;padding:12px;overflow:auto;max-height:320px}
    .muted{color:#9fb3c8}
  </style>
</head>
<body>
  <h2>Noderr Protocol – Paper Mode Live</h2>
  <div class="card">
    <div class="row">
      <label>Base <input id="base" value="ETH" /></label>
      <label>Quote <input id="quote" value="USDC" /></label>
      <label>Amount <input id="amount" value="1" /></label>
      <label>Side
        <select id="side">
          <option value="buy" selected>buy</option>
          <option value="sell">sell</option>
        </select>
      </label>
    </div>
    <div class="row">
      <button id="quoteBtn">Quote Once</button>
      <button id="autoBtn">Start Auto</button>
      <span class="muted" id="status"></span>
    </div>
    <h4>Latest Decision</h4>
    <pre id="out">(no data yet)</pre>
  </div>
  <script>
    const $ = (id) => document.getElementById(id);
    let timer = null;
    async function quoteOnce(){
      const body = {
        base: $("base").value.trim(),
        quote: $("quote").value.trim(),
        amount: $("amount").value.trim(),
        side: $("side").value
      };
      $("status").textContent = 'requesting...';
      try{
        const res = await fetch('/api/trading/quote', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
        const json = await res.json();
        $("out").textContent = JSON.stringify(json, null, 2);
        $("status").textContent = res.ok ? 'ok' : 'error';
      }catch(e){
        $("out").textContent = String(e);
        $("status").textContent = 'error';
      }
    }
    function toggleAuto(){
      if(timer){
        clearInterval(timer); timer=null; $("autoBtn").textContent='Start Auto'; $("status").textContent='stopped'; return;
      }
      $("autoBtn").textContent='Stop Auto';
      $("status").textContent='auto running';
      timer = setInterval(()=>{
        // randomize side for variety
        $("side").value = Math.random()>0.5 ? 'buy':'sell';
        quoteOnce();
      }, 1500);
      quoteOnce();
    }
    $("quoteBtn").onclick = quoteOnce;
    $("autoBtn").onclick = toggleAuto;
  </script>
</body>
</html>`;
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(html);
  }

  if (req.method === 'GET' && req.url === '/health') {
    return send(res, 200, { status: 'healthy' });
  }

  if (req.method === 'POST' && req.url === '/api/trading/quote') {
    try {
      let buf = '';
      req.on('data', (chunk) => (buf += chunk));
      req.on('end', async () => {
        try {
          const body = buf ? JSON.parse(buf) : {};
          const { base, quote, amount, side } = body || {};
          if (!base || !quote || !amount || !side || !['buy', 'sell'].includes(String(side))) {
            return send(res, 400, { error: 'Invalid body. Required: base, quote, amount, side=buy|sell' });
          }
          const qty = Number(amount);
          if (!Number.isFinite(qty) || qty <= 0) {
            return send(res, 400, { error: 'amount must be a positive number' });
          }

          const symbol = `${base}/${quote}`;
          const decision = await routePaper(symbol, side, qty);
          console.log('[QUOTE]', JSON.stringify({ symbol, side, qty, venue: decision.venue, score: decision.score }));
          return send(res, 200, { ok: true, decision });
        } catch (e) {
          console.error(e);
          return send(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
        }
      });
    } catch (e) {
      console.error(e);
      return send(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
    }
    return;
  }

  return send(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log(JSON.stringify({ msg: 'paper-server started', port: PORT }));
});


