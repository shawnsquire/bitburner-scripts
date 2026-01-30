// ═══════════════════════════════════════════════════════════════════════════════
// BITBURNER STOCK TRADER
// ═══════════════════════════════════════════════════════════════════════════════
// Usage: run stock-trader.js [--simulation]
//   --simulation: Track hypothetical trades without executing real orders
// ═══════════════════════════════════════════════════════════════════════════════
import { COLORS } from '/lib/utils.js';

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1: CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════
// Tweak these values to adjust the trading strategy

const CONFIG = {
  // Portfolio allocation
  maxPortfolioPercent: 0.8,      // Max % of cash to invest (keep some reserve)
  maxPositionsLong: 4,           // Max number of long positions
  maxPositionsShort: 4,          // Max number of short positions  
  maxSharesPerStock: 0.25,       // Max % of a stock's available shares to hold

  // Entry thresholds (when to buy)
  longForecastMin: 0.55,         // Minimum forecast to go long (>50% = bullish)
  shortForecastMax: 0.45,        // Maximum forecast to go short (<50% = bearish)
  minExpectedReturn: 0.0005,     // Minimum expected return per tick to enter

  // Exit thresholds (when to sell)
  longExitForecast: 0.50,        // Exit long if forecast drops below this
  shortExitForecast: 0.50,       // Exit short if forecast rises above this
  opportunityCostThreshold: 0.002,  // Exit if better opportunity exceeds current EV by this much
  opportunityCostForecast: 0.53,    // Only consider opportunity cost if forecast below this

  // Risk management
  minProfitToSell: 0.02,         // Minimum profit % to consider selling (covers commission)
  
  // Simulation starting capital (only used in simulation mode)
  simulationStartingCash: 100_000_000_000, // $100b

  // Permission / Accesses
  hasWSE: true,
  hasTIX: true,
  has4S: true,
  has4STIX: true,
  canShort: false,
};

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: ANSI COLORS (for pretty terminal output)
// ═══════════════════════════════════════════════════════════════════════════════

const C = COLORS;

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3: SIMULATION STATE
// ═══════════════════════════════════════════════════════════════════════════════
// This module tracks hypothetical trades when running in simulation mode.
// Can be easily removed/replaced when switching to real trading.

function createSimulationState(ns, startingCash) {
  return {
    cash: startingCash,
    positions: {},        // { SYM: { shares, avgPrice, type: 'long'|'short' } }
    totalCommissions: 0,
    trades: [],           // History of all trades
    startTime: Date.now(),
    startingCash: startingCash,

    // Get current portfolio value
    getPortfolioValue(ns) {
      let value = this.cash;
      for (const sym of Object.keys(this.positions)) {
        const pos = this.positions[sym];
        //const price = ns.stock.getPrice(sym);
        const askPrice = ns.stock.getAskPrice(sym);
        const bidPrice = ns.stock.getBidPrice(sym);
        const price = (askPrice + bidPrice) / 2;
        if (pos.type === 'long') {
          value += pos.shares * price;
        } else {
          // Short: profit = (avgPrice - currentPrice) * shares
          value += pos.shares * pos.avgPrice + pos.shares * (pos.avgPrice - price);
        }
      }
      return value;
    },

    // Get total profit/loss
    getPnL(ns) {
      return this.getPortfolioValue(ns) - this.startingCash;
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4: TRADE EXECUTION MODULE
// ═══════════════════════════════════════════════════════════════════════════════
// This module provides buy/sell functions that can be either MOCK (simulation)
// or REAL. The simulation flag determines which implementation is used.

function createTradeExecutor(ns, isSimulation, simState) {
  const commission = ns.stock.getConstants().StockMarketCommission;

  // ─────────────────────────────────────────────────────────────────────────────
  // MOCK implementations (simulation mode)
  // ─────────────────────────────────────────────────────────────────────────────
  
  const mockBuyLong = (sym, shares) => {
    const price = ns.stock.getAskPrice(sym);
    const cost = shares * price + commission;
    
    if (cost > simState.cash) {
      return { success: false, reason: 'Insufficient funds' };
    }

    simState.cash -= cost;
    simState.totalCommissions += commission;
    
    // Update or create position
    if (simState.positions[sym] && simState.positions[sym].type === 'long') {
      const pos = simState.positions[sym];
      const totalShares = pos.shares + shares;
      pos.avgPrice = (pos.avgPrice * pos.shares + price * shares) / totalShares;
      pos.shares = totalShares;
    } else {
      simState.positions[sym] = { shares, avgPrice: price, type: 'long' };
    }

    simState.trades.push({
      time: Date.now(),
      action: 'BUY_LONG',
      sym,
      shares,
      price,
      cost,
    });

    return { success: true, price, cost };
  };

  const mockSellLong = (sym, shares) => {
    const pos = simState.positions[sym];
    if (!pos || pos.type !== 'long' || pos.shares < shares) {
      return { success: false, reason: 'Insufficient shares' };
    }

    const price = ns.stock.getBidPrice(sym);
    const gain = shares * price - commission;
    const profit = shares * (price - pos.avgPrice) - commission;

    simState.cash += gain;
    simState.totalCommissions += commission;
    pos.shares -= shares;

    if (pos.shares === 0) {
      delete simState.positions[sym];
    }

    simState.trades.push({
      time: Date.now(),
      action: 'SELL_LONG',
      sym,
      shares,
      price,
      gain,
      profit,
    });

    return { success: true, price, gain, profit };
  };

  const mockBuyShort = (sym, shares) => {
    const price = ns.stock.getBidPrice(sym);
    const cost = shares * price + commission;

    if (cost > simState.cash) {
      return { success: false, reason: 'Insufficient funds' };
    }

    simState.cash -= cost;
    simState.totalCommissions += commission;

    if (simState.positions[sym] && simState.positions[sym].type === 'short') {
      const pos = simState.positions[sym];
      const totalShares = pos.shares + shares;
      pos.avgPrice = (pos.avgPrice * pos.shares + price * shares) / totalShares;
      pos.shares = totalShares;
    } else {
      simState.positions[sym] = { shares, avgPrice: price, type: 'short' };
    }

    simState.trades.push({
      time: Date.now(),
      action: 'BUY_SHORT',
      sym,
      shares,
      price,
      cost,
    });

    return { success: true, price, cost };
  };

  const mockSellShort = (sym, shares) => {
    const pos = simState.positions[sym];
    if (!pos || pos.type !== 'short' || pos.shares < shares) {
      return { success: false, reason: 'Insufficient shares' };
    }

    const price = ns.stock.getAskPrice(sym);
    // Short profit: you sold high (avgPrice), buying back low (price)
    const profit = shares * (pos.avgPrice - price) - commission;
    const gain = shares * pos.avgPrice + profit; // Return original + profit

    simState.cash += shares * pos.avgPrice + profit;
    simState.totalCommissions += commission;
    pos.shares -= shares;

    if (pos.shares === 0) {
      delete simState.positions[sym];
    }

    simState.trades.push({
      time: Date.now(),
      action: 'SELL_SHORT',
      sym,
      shares,
      price,
      profit,
    });

    return { success: true, price, profit };
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // REAL implementations (live trading)
  // ─────────────────────────────────────────────────────────────────────────────

  const realBuyLong = (sym, shares) => {
    const price = ns.stock.buyStock(sym, shares);
    if (price === 0) {
      return { success: false, reason: 'Trade failed' };
    }
    const cost = ns.stock.getPurchaseCost(sym, shares, 'Long');
    return { success: true, price, cost };
  };

  const realSellLong = (sym, shares) => {
    const price = ns.stock.sellStock(sym, shares);
    if (price === 0) {
      return { success: false, reason: 'Trade failed' };
    }
    const gain = ns.stock.getSaleGain(sym, shares, 'Long');
    return { success: true, price, gain };
  };

  const realBuyShort = (sym, shares) => {
    return { success: false, reason: 'Can not short' };
    /*
    const price = ns.stock.buyShort(sym, shares);
    if (price === 0) {
      return { success: false, reason: 'Trade failed' };
    }
    const cost = ns.stock.getPurchaseCostt(sym, shares, 'Short');
    return { success: true, price, cost };
    */
  };

  const realSellShort = (sym, shares) => {
    return { success: false, reason: 'Can not short' };
    /*
    const price = ns.stock.sellShort(sym, shares);
    if (price === 0) {
      return { success: false, reason: 'Trade failed' };
    }
    const gain = ns.stock.getSaleGain(sym, shares, 'Short');
    return { success: true, price, gain };
    */
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Return the appropriate implementation based on mode
  // ─────────────────────────────────────────────────────────────────────────────

  return {
    buyLong: isSimulation ? mockBuyLong : realBuyLong,
    sellLong: isSimulation ? mockSellLong : realSellLong,
    buyShort: isSimulation ? mockBuyShort : realBuyShort,
    sellShort: isSimulation ? mockSellShort : realSellShort,
    commission,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5: MARKET ANALYSIS MODULE
// ═══════════════════════════════════════════════════════════════════════════════
// Analyzes stocks and calculates expected returns, risk scores, etc.

function analyzeStock(ns, sym) {
  //const price = ns.stock.getPrice(sym);
  const askPrice = ns.stock.getAskPrice(sym);
  const bidPrice = ns.stock.getBidPrice(sym);
  const price = (askPrice + bidPrice) / 2;
  const volatility = ns.stock.getVolatility(sym);
  const forecast = ns.stock.getForecast(sym);
  const maxShares = ns.stock.getMaxShares(sym);
  const [sharesLong, avgLongPrice, sharesShort, avgShortPrice] = ns.stock.getPosition(sym);

  // Expected return per tick:
  // For longs: if forecast = 0.6 and volatility = 0.02, 
  //   expected move = 0.02 * (2 * 0.6 - 1) = 0.02 * 0.2 = 0.004 = 0.4%
  // For shorts: inverse, so forecast < 0.5 gives positive return
  const expectedReturn = volatility * (2 * forecast - 1);
  
  // Risk-adjusted return (like Sharpe ratio, higher is better)
  // Avoids division by zero with very low volatility
  const riskAdjustedReturn = volatility > 0.001 ? Math.abs(expectedReturn) / volatility : 0;

  // Price range prediction (1 standard deviation move)
  const minPrice = price * (1 - volatility);
  const maxPrice = price * (1 + volatility);

  // Direction signal
  const signal = forecast > 0.5 ? 'LONG' : forecast < 0.5 ? 'SHORT' : 'NEUTRAL';

  // Confidence: how far from 0.5 the forecast is
  const confidence = Math.abs(forecast - 0.5) * 2; // 0 to 1 scale

  return {
    sym,
    price,
    askPrice,
    bidPrice,
    spread: askPrice - bidPrice,
    volatility,
    forecast,
    maxShares,
    sharesLong,
    avgLongPrice,
    sharesShort,
    avgShortPrice,
    expectedReturn,
    riskAdjustedReturn,
    minPrice,
    maxPrice,
    signal,
    confidence,
  };
}

function rankStocks(analyses) {
  // Separate into long and short candidates
  const longCandidates = analyses
    .filter(a => a.forecast >= CONFIG.longForecastMin && a.expectedReturn >= CONFIG.minExpectedReturn)
    .sort((a, b) => b.expectedReturn - a.expectedReturn);

  const shortCandidates = analyses
    .filter(a => a.forecast <= CONFIG.shortForecastMax && -a.expectedReturn >= CONFIG.minExpectedReturn)
    .sort((a, b) => a.expectedReturn - b.expectedReturn); // Most negative first (best shorts)

  return { longCandidates, shortCandidates };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6: PORTFOLIO MANAGEMENT MODULE
// ═══════════════════════════════════════════════════════════════════════════════
// Decides what to buy/sell based on current positions and market analysis

function managePortfolio(ns, analyses, executor, isSimulation, simState) {
  const { longCandidates, shortCandidates } = rankStocks(analyses);
  const actions = [];
  const commission = executor.commission;

  // Get available cash
  let cash;
  if (isSimulation) {
    cash = simState.cash;
  } else {
    cash = ns.getServerMoneyAvailable('home');
  }

  // Get current positions
  const currentLongs = analyses.filter(a => a.sharesLong > 0 || 
    (isSimulation && simState.positions[a.sym]?.type === 'long'));
  const currentShorts = analyses.filter(a => a.sharesShort > 0 || 
    (isSimulation && simState.positions[a.sym]?.type === 'short'));

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 1: Exit positions that no longer meet criteria
  // ─────────────────────────────────────────────────────────────────────────────

  for (const analysis of analyses) {
    const sym = analysis.sym;
    
    // Check long positions
    let longShares, longAvgPrice;
    if (isSimulation) {
      const pos = simState.positions[sym];
      if (pos?.type === 'long') {
        longShares = pos.shares;
        longAvgPrice = pos.avgPrice;
      }
    } else {
      longShares = analysis.sharesLong;
      longAvgPrice = analysis.avgLongPrice;
    }

    if (longShares > 0) {
      const profitPercent = (analysis.bidPrice - longAvgPrice) / longAvgPrice;
      let shouldExit = analysis.forecast < CONFIG.longExitForecast;
      const hasSufficientProfit = profitPercent >= CONFIG.minProfitToSell;
    
      // Opportunity cost: if something much better is available, lower our exit threshold
      const bestAvailableEV = longCandidates[0]?.expectedReturn ?? 0;
      const currentEV = analysis.expectedReturn;
      const betterOpportunityExists = bestAvailableEV > currentEV + CONFIG.opportunityCostThreshold;
      if (betterOpportunityExists && analysis.forecast < CONFIG.opportunityCostForecast) {
        shouldExit = true; // More willing to exit for a better opportunity
      }
    
      if (shouldExit && (hasSufficientProfit || profitPercent < -0.1 || betterOpportunityExists)) {
        const result = executor.sellLong(sym, longShares);
        if (result.success) {
          const profit = longShares * (analysis.bidPrice - longAvgPrice) - executor.commission;
          actions.push({ action: 'SELL_LONG', sym, shares: longShares, result });
        }
      }
    }

    // Check short positions
    let shortShares, shortAvgPrice;
    if (isSimulation) {
      const pos = simState.positions[sym];
      if (pos?.type === 'short') {
        shortShares = pos.shares;
        shortAvgPrice = pos.avgPrice;
      }
    } else {
      shortShares = analysis.sharesShort;
      shortAvgPrice = analysis.avgShortPrice;
    }

    if (shortShares > 0) {
      const profitPercent = (shortAvgPrice - analysis.askPrice) / shortAvgPrice;
      const shouldExit = analysis.forecast > CONFIG.shortExitForecast;
      const hasSufficientProfit = profitPercent >= CONFIG.minProfitToSell;

      if (shouldExit && (hasSufficientProfit || profitPercent < -0.1)) {
        const result = executor.sellShort(sym, shortShares);
        if (result.success) {
          const profit = shortShares * (shortAvgPrice - analysis.askPrice) - executor.commission;
          actions.push({ action: 'SELL_SHORT', sym, shares: shortShares, result });
        }
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 2: Enter new positions if we have capacity
  // ─────────────────────────────────────────────────────────────────────────────

  // Update cash after sells
  if (isSimulation) {
    cash = simState.cash;
  } else {
    cash = ns.getServerMoneyAvailable('home');
  }

  const investableCash = cash * CONFIG.maxPortfolioPercent;
  const numCurrentLongs = isSimulation 
    ? Object.values(simState.positions).filter(p => p.type === 'long').length
    : currentLongs.length;
  const numCurrentShorts = isSimulation
    ? Object.values(simState.positions).filter(p => p.type === 'short').length
    : currentShorts.length;

  // Buy longs
  for (const candidate of longCandidates) {
    if (numCurrentLongs >= CONFIG.maxPositionsLong) break;
    
    const sym = candidate.sym;
    const alreadyHasPosition = isSimulation 
      ? simState.positions[sym]?.type === 'long'
      : candidate.sharesLong > 0;

    if (alreadyHasPosition) continue;

    // Calculate position size
    const maxAffordable = Math.floor((investableCash - commission) / candidate.askPrice);
    const maxAllowed = Math.floor(candidate.maxShares * CONFIG.maxSharesPerStock);
    const shares = Math.min(maxAffordable, maxAllowed);

    if (shares > 0 && shares * candidate.askPrice > commission * 2) {
      const result = executor.buyLong(sym, shares);
      if (result.success) {
        actions.push({ action: 'BUY_LONG', sym, shares, result });
        if (isSimulation) cash = simState.cash;
      }
    }
  }

  // Buy shorts (only if we have short selling enabled)
  //const canShort = ns.stock.purchaseWseAccount !== undefined; // Basic check
  const canShort = CONFIG.canShort;
  if (canShort) {
    for (const candidate of shortCandidates) {
      if (numCurrentShorts >= CONFIG.maxPositionsShort) break;

      const sym = candidate.sym;
      const alreadyHasPosition = isSimulation
        ? simState.positions[sym]?.type === 'short'
        : candidate.sharesShort > 0;

      if (alreadyHasPosition) continue;

      const maxAffordable = Math.floor((investableCash - commission) / candidate.bidPrice);
      const maxAllowed = Math.floor(candidate.maxShares * CONFIG.maxSharesPerStock);
      const shares = Math.min(maxAffordable, maxAllowed);

      if (shares > 0 && shares * candidate.bidPrice > commission * 2) {
        const result = executor.buyShort(sym, shares);
        if (result.success) {
          actions.push({ action: 'BUY_SHORT', sym, shares, result });
          if (isSimulation) cash = simState.cash;
        }
      }
    }
  }

  return actions;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7: DISPLAY MODULE
// ═══════════════════════════════════════════════════════════════════════════════
// Renders the trading dashboard to the terminal

function renderDashboard(ns, analyses, isSimulation, simState, actions, sessionStartValue, sessionRealizedPnL) {
  ns.clearLog();

  const constants = ns.stock.getConstants();
  const commission = constants.StockMarketCommission;
  const mode = isSimulation ? `${C.yellow}SIMULATION${C.reset}` : `${C.green}LIVE${C.reset}`;

  // Header
  ns.print(`${C.cyan}════════════════════════════════════════════════════════════════${C.reset}`);
  ns.print(`${C.cyan}  STOCK TRADER [${mode}${C.cyan}] - ${new Date().toLocaleTimeString()}${C.reset}`);
  ns.print(`${C.cyan}════════════════════════════════════════════════════════════════${C.reset}`);

  // Access status
  /*
  const accessBits = [
    ns.stock.hasWSEAccount() ? `${C.green}WSE${C.reset}` : `${C.red}WSE${C.reset}`,
    ns.stock.hasTIXAPIAccess() ? `${C.green}TIX${C.reset}` : `${C.red}TIX${C.reset}`,
    ns.stock.has4SData() ? `${C.green}4S${C.reset}` : `${C.yellow}4S${C.reset}`,
    ns.stock.has4SDataTIXAPI() ? `${C.green}4S-TIX${C.reset}` : `${C.yellow}4S-TIX${C.reset}`,
  ].join(`${C.dim} | ${C.reset}`);
  ns.print(`${C.dim}Access:${C.reset} ${accessBits}  ${C.dim}Commission:${C.reset} ${C.yellow}$${ns.formatNumber(commission)}${C.reset}`);
  */
  ns.print(`${C.dim}Commission:${C.reset} ${C.yellow}$${ns.formatNumber(commission)}${C.reset}`);


  // Portfolio summary
  let cash, portfolioValue, pnl;
  if (isSimulation) {
    cash = simState.cash;
    portfolioValue = simState.getPortfolioValue(ns);
    pnl = simState.getPnL(ns);
  } else {
    cash = ns.getServerMoneyAvailable('home');
    // Calculate real portfolio value
    portfolioValue = cash;
    for (const a of analyses) {
      portfolioValue += a.sharesLong * a.bidPrice;
      if (a.sharesShort > 0) {
        portfolioValue += a.sharesShort * (a.avgShortPrice - a.askPrice + a.avgShortPrice);
      }
    }
    pnl = portfolioValue - sessionStartValue;
  }

  const pnlColor = pnl >= 0 ? C.green : C.red;
  const pnlSign = pnl >= 0 ? '+' : '';
  const realizedColor = sessionRealizedPnL >= 0 ? C.green : C.red;
  const realizedSign = sessionRealizedPnL >= 0 ? '+' : '';

  ns.print(`${C.dim}Cash:${C.reset} ${C.white}$${ns.formatNumber(cash)}${C.reset}  ` +
           `${C.dim}Portfolio:${C.reset} ${C.white}$${ns.formatNumber(portfolioValue)}${C.reset}\n` +
           `${C.dim}Unrealized:${C.reset} ${pnlColor}${pnlSign}$${ns.formatNumber(pnl)}${C.reset}  ` +
           `${C.dim}Realized:${C.reset} ${realizedColor}${realizedSign}$${ns.formatNumber(sessionRealizedPnL ?? 0)}${C.reset}`);
  ns.print('');

  // Recent actions
  if (actions.length > 0) {
    ns.print(`${C.magenta}Recent Actions:${C.reset}`);
    for (const a of actions.slice(-3)) {
      const actionColor = a.action.includes('BUY') ? C.green : C.yellow;
      ns.print(`  ${actionColor}${a.action}${C.reset} ${a.sym} x${ns.formatNumber(a.shares, 0)}`);
    }
    ns.print('');
  }

  // Stock table header
  ns.print(`  ${C.dim}${'SYM'.padEnd(6)}${'PRICE'.padEnd(10)}${'VOL'.padEnd(7)}${'FCST'.padEnd(7)}${'EV'.padEnd(9)}${'RANGE'.padEnd(20)}${'SIGNAL'.padEnd(8)}${'POS'.padEnd(12)}${C.reset}`);
  ns.print(`  ${C.dim}${'─'.repeat(75)}${C.reset}`);

  // Sort by absolute expected return (most interesting first)
  const sorted = [...analyses].sort((a, b) => Math.abs(b.expectedReturn) - Math.abs(a.expectedReturn));

  for (const a of sorted) {
    const priceStr = ('$' + ns.formatNumber(a.price, 2)).padEnd(10);
    const volStr = ns.formatPercent(a.volatility, 1).padEnd(7);
    
    const fcstColor = a.forecast > 0.55 ? C.green : a.forecast < 0.45 ? C.red : C.white;
    const fcstStr = `${fcstColor}${ns.formatPercent(a.forecast, 0).padEnd(7)}${C.reset}`;

    const evColor = a.expectedReturn > 0 ? C.green : a.expectedReturn < 0 ? C.red : C.white;
    const evStr = `${evColor}${(a.expectedReturn >= 0 ? '+' : '') + ns.formatPercent(a.expectedReturn, 2).padEnd(9)}${C.reset}`;

    const rangeStr = `$${ns.formatNumber(a.minPrice, 0)}-$${ns.formatNumber(a.maxPrice, 0)}`.padEnd(20);

    const signalColor = a.signal === 'LONG' ? C.green : a.signal === 'SHORT' ? C.red : C.dim;
    const signalStr = `${signalColor}${a.signal.padEnd(8)}${C.reset}`;

    // Position info
    let posStr = '';
    if (isSimulation && simState.positions[a.sym]) {
      const pos = simState.positions[a.sym];
      const posColor = pos.type === 'long' ? C.green : C.red;
      posStr = `${posColor}${pos.type.toUpperCase()[0]}:${ns.formatNumber(pos.shares, 0)}${C.reset}`;
    } else if (a.sharesLong > 0) {
      posStr = `${C.green}L:${ns.formatNumber(a.sharesLong, 0)}${C.reset}`;
    } else if (a.sharesShort > 0) {
      posStr = `${C.red}S:${ns.formatNumber(a.sharesShort, 0)}${C.reset}`;
    }

    ns.print(`  ${C.white}${a.sym.padEnd(6)}${C.yellow}${priceStr}${C.white}${volStr}${fcstStr}${evStr}${rangeStr}${signalStr}${posStr}`);
  }

  // Footer with simulation stats
  if (isSimulation) {
    ns.print('');
    ns.print(`${C.dim}Simulation: ${simState.trades.length} trades | $${ns.formatNumber(simState.totalCommissions)} in fees${C.reset}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 8: MAIN LOOP
// ═══════════════════════════════════════════════════════════════════════════════

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog('ALL');
  ns.ui.openTail();
  ns.ui.resizeTail(800, 600);

  // Parse arguments
  const isSimulation = ns.args.includes('--simulation') || ns.args.includes('-s');
  const liquidateAll = ns.args.includes('--liquidate') || ns.args.includes('-l');

  // Verify access
  /**
  if (!ns.stock.hasWSEAccount() || !ns.stock.hasTIXAPIAccess()) {
    ns.tprint(`${C.red}ERROR: Need WSE Account and TIX API access${C.reset}`);
    return;
  }

  if (!ns.stock.has4SDataTIXAPI()) {
    ns.tprint(`${C.yellow}WARNING: No 4S Data TIX API - forecast/volatility data unavailable${C.reset}`);
    ns.tprint('Script will run but cannot make informed decisions');
  }
  */

  // Initialize
  const symbols = ns.stock.getSymbols();
  const simState = isSimulation 
    ? createSimulationState(ns, CONFIG.simulationStartingCash) 
    : null;
  const executor = createTradeExecutor(ns, isSimulation, simState);

  // Track starting portfolio value for session P&L (live mode)
  let sessionStartValue = null;
  let sessionRealizedPnL = 0;
  if (!isSimulation) {
    sessionStartValue = ns.getServerMoneyAvailable('home');
    for (const sym of symbols) {
      const [sharesLong, avgLong, sharesShort, avgShort] = ns.stock.getPosition(sym);
      sessionStartValue += sharesLong * ns.stock.getBidPrice(sym);
      // Add short value if you have shorts
    }
  }

  ns.tprint(`${C.green}Stock Trader started in ${isSimulation ? 'SIMULATION' : 'LIVE'} mode${C.reset}`);
  ns.tprint(`Commission per trade: $${ns.formatNumber(executor.commission)}`);

  if (liquidateAll && !isSimulation) {
    ns.tprint('Liquidating all positions...');
    for (const sym of symbols) {
      const [sharesLong, , sharesShort, ] = ns.stock.getPosition(sym);
      if (sharesLong > 0) {
        const result = executor.sellLong(sym, sharesLong);
        ns.tprint(`  Sold ${sym} LONG: ${sharesLong} shares - ${result.success ? 'OK' : 'FAILED'}`);
      }
      if (sharesShort > 0) {
        const result = executor.sellShort(sym, sharesShort);
        ns.tprint(`  Sold ${sym} SHORT: ${sharesShort} shares - ${result.success ? 'OK' : 'FAILED'}`);
      }
    }
    ns.tprint('Liquidation complete. Exiting.');
    return;
  }

  // Main loop
  while (true) {
    // Analyze all stocks
    const analyses = symbols.map(sym => analyzeStock(ns, sym));

    // Manage portfolio (make trades)
    const actions = managePortfolio(ns, analyses, executor, isSimulation, simState);

    // Tally realized P&L from sells
    if (!isSimulation) {
      for (const a of actions) {
        if (a.profit !== undefined) {
          sessionRealizedPnL += a.profit;
        }
      }
    }

    // Update display
    renderDashboard(ns, analyses, isSimulation, simState, actions, sessionStartValue, sessionRealizedPnL);

    // Wait for next market update
    await ns.stock.nextUpdate();
  }
}