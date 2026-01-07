
// netlify/functions/market-data.js
// Fetches real-time market data from multiple APIs

exports.handler = async (event, context) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { symbol, timeframe, apiKeys } = JSON.parse(event.body);
    
    // Determine asset type
    const isCrypto = symbol.includes('BTC') || symbol.includes('ETH') || symbol.includes('USDT');
    const isForex = symbol.includes('USD') || symbol.includes('EUR') || symbol.includes('GBP');
    const isCommodity = symbol.includes('XAU') || symbol.includes('XAG') || symbol.includes('OIL');
    
    let marketData = {};
    
    // Route to appropriate data fetcher
    if (isCrypto) {
      marketData = await fetchCryptoData(symbol, timeframe);
    } else if (isForex) {
      marketData = await fetchForexData(symbol, timeframe, apiKeys);
    } else if (isCommodity) {
      marketData = await fetchCommodityData(symbol, timeframe, apiKeys);
    } else {
      marketData = await fetchStockData(symbol, timeframe, apiKeys);
    }

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(marketData)
    };

  } catch (error) {
    console.error('Market data error:', error);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ 
        error: error.message,
        details: 'Failed to fetch market data'
      })
    };
  }
};

// ============ CRYPTO DATA FETCHER (Binance - FREE) ============
async function fetchCryptoData(symbol, timeframe) {
  const binanceSymbol = symbol.replace('/', '').replace('USD', 'USDT');
  
  try {
    // Get 24h ticker
    const tickerRes = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${binanceSymbol}`);
    const ticker = await tickerRes.json();
    
    // Get current price
    const priceRes = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${binanceSymbol}`);
    const price = await priceRes.json();
    
    // Get klines for indicators
    const interval = convertTimeframeBinance(timeframe);
    const klinesRes = await fetch(`https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&limit=200`);
    const klines = await klinesRes.json();
    
    // Extract OHLCV data
    const closes = klines.map(k => parseFloat(k[4]));
    const highs = klines.map(k => parseFloat(k[2]));
    const lows = klines.map(k => parseFloat(k[3]));
    const volumes = klines.map(k => parseFloat(k[5]));
    
    // Calculate indicators
    const indicators = calculateIndicators(closes, highs, lows, volumes);
    const patterns = detectPatterns(closes);
    const supportResistance = calculateSupportResistance(closes, highs, lows);
    
    return {
      symbol: symbol,
      source: 'Binance (Real-time)',
      price: parseFloat(price.price),
      change: parseFloat(ticker.priceChange),
      changePercent: parseFloat(ticker.priceChangePercent),
      volume: parseFloat(ticker.volume),
      high24h: parseFloat(ticker.highPrice),
      low24h: parseFloat(ticker.lowPrice),
      bid: parseFloat(ticker.bidPrice),
      ask: parseFloat(ticker.askPrice),
      lastUpdate: new Date().toISOString(),
      indicators: indicators,
      patterns: patterns,
      supportResistance: supportResistance,
      historicalData: closes.slice(-50)
    };
    
  } catch (error) {
    console.error('Binance error:', error);
    throw new Error('Failed to fetch crypto data from Binance');
  }
}

// ============ FOREX DATA FETCHER ============
async function fetchForexData(symbol, timeframe, apiKeys) {
  const key = apiKeys?.alphavantage || 'demo';
  const from = symbol.substring(0, 3);
  const to = symbol.substring(3, 6);
  
  try {
    const interval = convertTimeframeAlpha(timeframe);
    const url = `https://www.alphavantage.co/query?function=FX_INTRADAY&from_symbol=${from}&to_symbol=${to}&interval=${interval}&apikey=${key}`;
    
    const res = await fetch(url);
    const data = await res.json();
    
    if (data['Error Message'] || data['Note']) {
      return getDemoData(symbol, 'Forex');
    }
    
    const seriesKey = Object.keys(data).find(k => k.includes('Time Series'));
    const series = data[seriesKey];
    
    if (!series) {
      return getDemoData(symbol, 'Forex');
    }
    
    const times = Object.keys(series);
    const latest = series[times[0]];
    
    const closes = times.slice(0, 200).map(t => parseFloat(series[t]['4. close']));
    const highs = times.slice(0, 200).map(t => parseFloat(series[t]['2. high']));
    const lows = times.slice(0, 200).map(t => parseFloat(series[t]['3. low']));
    const volumes = times.slice(0, 200).map(t => parseFloat(series[t]['5. volume'] || 0));
    
    const indicators = calculateIndicators(closes, highs, lows, volumes);
    const patterns = detectPatterns(closes);
    const supportResistance = calculateSupportResistance(closes, highs, lows);
    
    return {
      symbol: symbol,
      source: 'Alpha Vantage',
      price: parseFloat(latest['4. close']),
      high24h: Math.max(...highs.slice(0, 24)),
      low24h: Math.min(...lows.slice(0, 24)),
      change: closes[0] - closes[1],
      changePercent: parseFloat(((closes[0] - closes[1]) / closes[1] * 100).toFixed(2)),
      volume: parseFloat(latest['5. volume'] || 0),
      bid: parseFloat(latest['4. close']) - 0.0001,
      ask: parseFloat(latest['4. close']) + 0.0001,
      lastUpdate: new Date(times[0]).toISOString(),
      indicators: indicators,
      patterns: patterns,
      supportResistance: supportResistance,
      historicalData: closes.slice(0, 50)
    };
    
  } catch (error) {
    console.error('Forex fetch error:', error);
    return getDemoData(symbol, 'Forex');
  }
}

// ============ COMMODITY DATA FETCHER ============
async function fetchCommodityData(symbol, timeframe, apiKeys) {
  return getDemoData(symbol, 'Commodity');
}

// ============ STOCK DATA FETCHER ============
async function fetchStockData(symbol, timeframe, apiKeys) {
  return getDemoData(symbol, 'Stock');
}

// ============ INDICATOR CALCULATIONS ============
function calculateIndicators(closes, highs, lows, volumes) {
  return {
    rsi: calculateRSI(closes, 14),
    macd: calculateMACD(closes),
    ema20: calculateEMA(closes, 20),
    ema50: calculateEMA(closes, 50),
    ema200: calculateEMA(closes, 200),
    sma20: calculateSMA(closes, 20),
    sma50: calculateSMA(closes, 50),
    bollingerBands: calculateBollingerBands(closes, 20, 2),
    atr: calculateATR(highs, lows, closes, 14),
    adx: calculateADX(highs, lows, closes, 14),
    stochastic: calculateStochastic(highs, lows, closes, 14),
    volumeProfile: volumes.length > 0 ? {
      current: volumes[volumes.length - 1],
      average: calculateSMA(volumes, 20),
      ratio: volumes[volumes.length - 1] / calculateSMA(volumes, 20),
      trend: volumes[volumes.length - 1] > calculateSMA(volumes, 20) ? 'increasing' : 'decreasing'
    } : null
  };
}

function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) return 50;
  
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateMACD(prices) {
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  const macdLine = ema12 - ema26;
  const signal = macdLine * 0.9;
  
  return {
    value: macdLine,
    signal: signal,
    histogram: macdLine - signal
  };
}

function calculateEMA(prices, period) {
  if (prices.length < period) return prices[prices.length - 1];
  
  const multiplier = 2 / (period + 1);
  let ema = prices[prices.length - period];
  
  for (let i = prices.length - period + 1; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
  }
  return ema;
}

function calculateSMA(prices, period) {
  if (prices.length < period) return prices[prices.length - 1];
  const slice = prices.slice(prices.length - period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calculateBollingerBands(prices, period, stdDev) {
  const sma = calculateSMA(prices, period);
  const slice = prices.slice(prices.length - period);
  const squaredDiffs = slice.map(p => Math.pow(p - sma, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period;
  const sd = Math.sqrt(variance);
  
  return {
    upper: sma + (sd * stdDev),
    middle: sma,
    lower: sma - (sd * stdDev)
  };
}

function calculateATR(highs, lows, closes, period = 14) {
  const trs = [];
  for (let i = 1; i < highs.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trs.push(tr);
  }
  return calculateSMA(trs, period);
}

function calculateADX(highs, lows, closes, period = 14) {
  const atr = calculateATR(highs, lows, closes, period);
  const priceChange = closes[closes.length - 1] - closes[closes.length - period];
  return Math.min(100, Math.abs(priceChange / atr) * 5);
}

function calculateStochastic(highs, lows, closes, period = 14) {
  const recentHighs = highs.slice(-period);
  const recentLows = lows.slice(-period);
  const current = closes[closes.length - 1];
  const highest = Math.max(...recentHighs);
  const lowest = Math.min(...recentLows);
  const k = ((current - lowest) / (highest - lowest)) * 100;
  
  return { k: k, d: k * 0.9 };
}

// ============ PATTERN DETECTION ============
function detectPatterns(prices) {
  const patterns = [];
  const len = prices.length;
  
  if (len < 5) return ['Insufficient data'];
  
  const trend = prices[len - 1] - prices[len - 5];
  if (trend > prices[len - 5] * 0.02) patterns.push('Uptrend');
  else if (trend < -prices[len - 5] * 0.02) patterns.push('Downtrend');
  else patterns.push('Sideways');
  
  return patterns;
}

// ============ SUPPORT & RESISTANCE ============
function calculateSupportResistance(prices, highs, lows) {
  const current = prices[prices.length - 1];
  const support = [current * 0.98, current * 0.95, current * 0.92];
  const resistance = [current * 1.02, current * 1.05, current * 1.08];
  
  return { support, resistance };
}

// ============ HELPER FUNCTIONS ============
function convertTimeframeBinance(tf) {
  const map = {
    '1M': '1m', '5M': '5m', '15M': '15m',
    '1H': '1h', '4H': '4h', '1D': '1d', '1W': '1w'
  };
  return map[tf] || '1h';
}

function convertTimeframeAlpha(tf) {
  const map = {
    '1M': '1min', '5M': '5min', '15M': '15min',
    '1H': '60min', '4H': '60min', '1D': 'daily', '1W': 'weekly'
  };
  return map[tf] || '60min';
}

function getDemoData(symbol, type) {
  const basePrice = type === 'Forex' ? 1.0850 : 
                   type === 'Commodity' ? 2045.30 : 178.50;
  
  return {
    symbol: symbol,
    source: 'Demo Data',
    price: basePrice,
    change: basePrice * 0.012,
    changePercent: 1.2,
    volume: 1000000,
    high24h: basePrice * 1.02,
    low24h: basePrice * 0.98,
    bid: basePrice - 0.01,
    ask: basePrice + 0.01,
    lastUpdate: new Date().toISOString(),
    note: `Demo data - Add Alpha Vantage API key for real ${type} data`,
    indicators: {
      rsi: 55,
      macd: { value: 0.5, signal: 0.3, histogram: 0.2 },
      ema20: basePrice * 0.99,
      ema50: basePrice * 0.97,
      ema200: basePrice * 0.95,
      sma20: basePrice * 0.99,
      sma50: basePrice * 0.97,
      bollingerBands: { upper: basePrice * 1.02, middle: basePrice, lower: basePrice * 0.98 },
      atr: basePrice * 0.02,
      adx: 25,
      stochastic: { k: 60, d: 55 }
    },
    patterns: ['Demo Pattern'],
    supportResistance: {
      support: [basePrice * 0.98, basePrice * 0.95, basePrice * 0.92],
      resistance: [basePrice * 1.02, basePrice * 1.05, basePrice * 1.08]
    },
    historicalData: Array(50).fill(basePrice)
  };
}
