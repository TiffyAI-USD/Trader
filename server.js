const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const app = express();

// === CONFIG ===
const PORT = process.env.PORT || 3000;
const DATA_FILE = 'data.json';
const ADMIN_KEY = 'tHisiSm17e2tkey1234567890987654321234567890987654321234567890987';
const SHARE_REWARD_BASE = 500; // TIFFYAI per valid share
const TRADE_FEE_BNB = 0.003; // Per trade
const MAX_TRADES_PER_USER = 2;

// === MIDDLEWARE ===
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// === DATA PERSISTENCE ===
let data = { users: {}, wallets: {}, shares: {}, trades: {} };
if (fs.existsSync(DATA_FILE)) {
  try {
    data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) { console.error('Data load failed:', e); }
}

// Save data every 30s
setInterval(() => {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}, 30000);

// === HELPERS ===
function getUser(id) {
  if (!data.users[id]) data.users[id] = { tiffy: 0, trades: 0, lastShare: 0, name: 'Honey' };
  return data.users[id];
}
function saveUser(id, updates) {
  data.users[id] = { ...data.users[id], ...updates };
}

function getWallet(addr) {
  if (!data.wallets[addr]) data.wallets[addr] = { tiffy: 0, bnb: 0, lastSync: 0 };
  return data.wallets[addr];
}

// === ROUTES ===

// Home
app.get('/', (req, res) => {
  res.send(`
    <h1>TIFFYAI Bucks Backend • Live</h1>
    <p>Share & Earn • Trade • Wallet Sync</p>
    <small>Protected by ${ADMIN_KEY.slice(0,10)}...</small>
  `);
});

// Wallet Balance
app.get('/wallets', (req, res) => {
  const { address } = req.query;
  if (!address) return res.status(400).json({ error: 'Address required' });
  const wallet = getWallet(address);
  res.json({ tiffy: wallet.tiffy, bnb: wallet.bnb, lastSync: wallet.lastSync });
});

// Share Reward Claim (1-Minute Anti-Cancel)
app.post('/trades', (req, res) => {
  const { action, userId, wallet, timestamp, count } = req.body;

  if (!userId || !action) return res.status(400).json({ success: false, error: 'Invalid request' });

  const user = getUser(userId);
  const now = Date.now();

  // === CLAIM SHARE REWARD ===
  if (action === 'claim_share_reward') {
    const lastShare = user.lastShare || 0;
    const timeSinceLast = now - lastShare;

    // Prevent spam: 5 min cooldown
    if (timeSinceLast < 300000) {
      return res.json({ success: false, error: 'Wait 5 mins between shares' });
    }

    // Check share status from client (anti-cancel)
    const shareKey = `share_${userId}`;
    const shareData = data.shares[shareKey] || {};
    const shareStart = shareData.start || 0;
    const shareStatus = shareData.status || 'none';

    // Only reward if pending and >60s passed without cancel
    if (shareStatus === 'pending' && (now - shareStart >= 60000)) {
      const amount = SHARE_REWARD_BASE;
      user.tiffy += amount;
      user.lastShare = now;
      saveUser(userId, user);

      // Update wallet if connected
      if (wallet) {
        const w = getWallet(wallet);
        w.tiffy += amount;
        data.wallets[wallet] = w;
      }

      // Clear share state
      delete data.shares[shareKey];

      return res.json({ success: true, amount, message: 'Share reward claimed!' });
    } else {
      return res.json({ success: false, error: 'Share canceled or invalid' });
    }
  }

  // === START TRADES (2 per user) ===
  if (action === 'start_trades') {
    if (!wallet) return res.status(400).json({ success: false, error: 'Wallet required' });

    const w = getWallet(wallet);
    const userTrades = user.trades || 0;

    if (userTrades >= MAX_TRADES_PER_USER) {
      return res.json({ success: false, error: 'Max 2 trades per session' });
    }

    const tradesToRun = Math.min(count || 1, MAX_TRADES_PER_USER - userTrades);
    const totalFee = tradesToRun * TRADE_FEE_BNB;

    if (w.bnb < totalFee) {
      return res.json({ success: false, error: `Need ${totalFee} BNB` });
    }

    // Deduct fee
    w.bnb -= totalFee;
    user.trades += tradesToRun;

    // Simulate profit (5-15% per trade)
    const profitPerTrade = 0.00015 + Math.random() * 0.0003; // ~$0.05-$0.10
    const totalProfit = profitPerTrade * tradesToRun;
    w.tiffy += totalProfit * 1000; // Convert to TIFFYAI

    saveUser(userId, user);
    data.wallets[wallet] = w;

    return res.json({
      success: true,
      message: `${tradesToRun} trade(s) completed! +${(totalProfit * 1000).toFixed(2)} TIFFYAI`,
      profit: totalProfit
    });
  }

  // === CLAIM ALL REWARDS ===
  if (action === 'claim_all') {
    if (!wallet) return res.status(400).json({ success: false, error: 'Connect wallet' });

    const w = getWallet(wallet);
    const pending = w.tiffy;

    if (pending > 0) {
      w.tiffy = 0;
      data.wallets[wallet] = w;
      return res.json({ success: true, message: `Claimed ${pending.toFixed(2)} TIFFYAI!` });
    } else {
      return res.json({ success: false, error: 'Nothing to claim' });
    }
  }

  res.status(400).json({ success: false, error: 'Unknown action' });
});

// === SHARE STATE ENDPOINT (Client sets this on share start/cancel) ===
app.post('/share-state', (req, res) => {
  const { userId, status } = req.body;
  if (!userId || !status) return res.status(400).json({ error: 'Invalid' });

  const key = `share_${userId}`;
  if (status === 'pending') {
    data.shares[key] = { start: Date.now(), status: 'pending' };
  } else if (status === 'canceled') {
    if (data.shares[key]) data.shares[key].status = 'canceled';
  } else if (status === 'clear') {
    delete data.shares[key];
  }

  res.json({ success: true });
});

// === ADMIN: Reset User (via key) ===
app.post('/admin/reset', (req, res) => {
  const { key, userId } = req.body;
  if (key !== ADMIN_KEY) return res.status(403).json({ error: 'Forbidden' });

  if (data.users[userId]) {
    delete data.users[userId];
    res.json({ success: true, message: 'User reset' });
  } else {
    res.json({ success: false, error: 'User not found' });
  }
});

// === START SERVER ===
app.listen(PORT, () => {
  console.log(`TIFFYAI Bucks Backend LIVE on port ${PORT}`);
  console.log(`Dashboard: https://tiffyai.github.io/Bucks`);
});
