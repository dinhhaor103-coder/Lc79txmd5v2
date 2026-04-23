// ============================================================================
// VI LONG SUPER AI - SERVER V9.2
// Express server fetch dữ liệu game LC79 và serve dự đoán Tài Xỉu
// ============================================================================
const express = require('express');
const path = require('path');
const fs = require('fs');
const { deepAnalysis, CAPITAL, updateLogicPerformance, logicPerformance } = require('./prediction');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== CẤU HÌNH GAME ====================
const GAMES = {
    lc79_hu: {
        name: 'TAI XIU HU',
        api: 'https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5'
    },
    lc79_md5: {
        name: 'TAI XIU MD5',
        api: 'https://wtxmd52.tele68.com/v1/txmd5/lite-sessions?cp=R&cl=R&pf=web&at=3959701241b686f12e01bfe9c3a319b8'
    }
};

// ==================== STATE PER GAME ====================
const STATE = {};
for (const gid of Object.keys(GAMES)) {
    STATE[gid] = {
        lastPhien: 0,
        lastTotal: 0,
        history: [],         // mảng nhị phân (1=Tài, 0=Xỉu) - mới nhất ở [0]
        totals: [],          // mảng tổng xúc xắc tương ứng
        diceData: [],        // [{d1, d2, d3, sid, ts}, ...] - mới nhất ở [0]
        currentPrediction: null,
        currentLogic: '',
        currentConfidence: 0,
        currentExpected: [],
        isReversal: false,
        reversalFrom: '',
        recentHistory: '',
        updatedAt: null,
        predLog: [],         // [{phien, prediction, confidence, logic, actual, correct, ts}]
        votes: { tai: 0, xiu: 0 },
        details: {}
    };
}

// ==================== PERSISTENCE (lưu lại sau restart) ====================
const DATA_FILE = path.join(__dirname, 'data.json');
function saveState() {
    try {
        const dump = {};
        for (const gid of Object.keys(STATE)) {
            const S = STATE[gid];
            dump[gid] = {
                lastPhien: S.lastPhien,
                predLog: S.predLog.slice(0, 200)
            };
        }
        fs.writeFileSync(DATA_FILE, JSON.stringify(dump));
    } catch (e) { /* ignore */ }
}
function loadState() {
    try {
        if (!fs.existsSync(DATA_FILE)) return;
        const dump = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
        for (const gid of Object.keys(dump)) {
            if (STATE[gid]) {
                STATE[gid].lastPhien = dump[gid].lastPhien || 0;
                STATE[gid].predLog = dump[gid].predLog || [];
            }
        }
        console.log('[STATE] Loaded persisted data');
    } catch (e) { console.log('[STATE] Load failed:', e.message); }
}
loadState();
setInterval(saveState, 30000);

// ==================== FETCH DATA TỪ API GỐC ====================
async function fetchGameData(gid) {
    const g = GAMES[gid];
    try {
        const res = await fetch(g.api, {
            signal: AbortSignal.timeout(8000),
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        if (!res.ok) return null;
        const data = await res.json();
        const list = data.list || data.data || (Array.isArray(data) ? data : []);
        if (!list || list.length === 0) return null;
        return list;
    } catch (e) {
        return null;
    }
}

// ==================== UPDATE STATE TỪ API ====================
async function updateGame(gid) {
    const S = STATE[gid];
    const list = await fetchGameData(gid);
    if (!list) return;

    // Build mảng nhị phân, totals, diceData từ list (mới nhất ở [0])
    const cap = Math.min(list.length, 100);
    const newHistory = [];
    const newTotals = [];
    const newDice = [];
    for (let i = 0; i < cap; i++) {
        const x = list[i];
        const d1 = x.dice1 || x.d1 || 0;
        const d2 = x.dice2 || x.d2 || 0;
        const d3 = x.dice3 || x.d3 || 0;
        let sum = d1 + d2 + d3;
        let bin;
        if (sum === 0 && (x.resultTruyenThong || x.result)) {
            const r = (x.resultTruyenThong || x.result || '').toString().toUpperCase();
            bin = r.includes('TAI') ? 1 : 0;
            sum = bin === 1 ? 14 : 7;
        } else {
            bin = sum > 10 ? 1 : 0;
        }
        newHistory.push(bin);
        newTotals.push(sum);
        newDice.push({ d1, d2, d3, sid: x.id || x.sid || 0, ts: Date.now() - i * 30000 });
    }
    S.history = newHistory;
    S.totals = newTotals;
    S.diceData = newDice;
    S.lastTotal = newTotals[0] || 0;
    S.recentHistory = newHistory.slice(0, 10).map(x => x === 1 ? 'T' : 'X').join('');

    const latestPhien = list[0].id || list[0].sid || 0;

    // Khi có phiên mới
    if (latestPhien > S.lastPhien) {
        const actual = (newHistory[0] === 1) ? 'TAI' : 'XIU';

        // Chốt dự đoán đang treo cho phiên này
        const pending = S.predLog.find(p => p.phien === latestPhien && p.actual === null);
        if (pending) {
            pending.actual = actual;
            pending.actualTotal = newTotals[0];
            pending.correct = pending.prediction === actual;
            // update performance từng logic dựa trên details
            const actualVN = actual === 'TAI' ? 'Tài' : 'Xỉu';
            for (const [logicName, predicted] of Object.entries(pending.details || {})) {
                updateLogicPerformance(logicName, predicted, actualVN);
            }
        }

        S.lastPhien = latestPhien;

        // Tính dự đoán cho phiên tới
        const result = deepAnalysis(gid, S);
        S.currentPrediction = result.prediction;
        S.currentLogic = result.logic;
        S.currentConfidence = result.confidence;
        S.currentExpected = result.expectedNumbers;
        S.isReversal = result.isReversal;
        S.reversalFrom = result.reversalFrom;
        S.votes = result.votes;
        S.details = result.details;
        S.updatedAt = new Date().toISOString();

        if (result.prediction) {
            S.predLog.unshift({
                phien: latestPhien + 1,
                prediction: result.prediction,
                confidence: result.confidence,
                logic: result.logic,
                isReversal: result.isReversal,
                expectedNumbers: result.expectedNumbers,
                votes: result.votes,
                details: result.details,
                actual: null,
                correct: null,
                ts: Date.now()
            });
            if (S.predLog.length > 605) S.predLog.length = 605;
        }

        console.log(`[${gid}] phien ${latestPhien} -> ${actual} | next ${latestPhien + 1}: ${result.prediction} ${result.confidence}% (${result.logic})`);
    }
}

// Khởi động loop
for (const gid of Object.keys(GAMES)) {
    updateGame(gid);
    setInterval(() => updateGame(gid), 3000);
}

// ==================== CORS MIDDLEWARE ====================
app.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// ==================== STATIC ====================
app.use(express.static(path.join(__dirname, 'public')));

// ==================== ROUTES ====================
app.get('/predict/:gameId', (req, res) => {
    const gid = req.params.gameId;
    if (!STATE[gid]) return res.status(404).json({ error: 'Game not found', games: Object.keys(GAMES) });
    const S = STATE[gid];
    res.json({
        game: GAMES[gid].name,
        phien: S.lastPhien + 1,
        historyCount: S.predLog.length,
        updatedAt: S.updatedAt,
        prediction: S.currentPrediction,
        confidence: S.currentConfidence,
        logic: S.currentLogic,
        isReversal: S.isReversal,
        reversalFrom: S.reversalFrom,
        expectedNumbers: S.currentExpected,
        lastTotal: S.lastTotal,
        recentHistory: S.recentHistory,
        votes: S.votes
    });
});

app.get('/history/:gameId', (req, res) => {
    const gid = req.params.gameId;
    if (!STATE[gid]) return res.status(404).json({ error: 'Game not found' });
    const S = STATE[gid];
    const completed = S.predLog.filter(p => p.actual !== null);
    const correct = completed.filter(p => p.correct).length;
    const total = completed.length;
    const accuracy = total > 0 ? `${((correct / total) * 100).toFixed(1)}%` : '--';
    res.json({
        game: GAMES[gid].name,
        accuracy,
        correct,
        total,
        history: S.predLog.slice(0, 50).map(p => ({
            phien: p.phien,
            prediction: p.prediction,
            confidence: p.confidence,
            logic: p.logic,
            isReversal: p.isReversal,
            expectedNumbers: p.expectedNumbers,
            actual: p.actual,
            actualTotal: p.actualTotal,
            correct: p.correct
        }))
    });
});

// API quản lý vốn (server-side calc)
app.get('/capital/calc', (req, res) => {
    const current = parseInt(req.query.current) || 0;
    const target = parseInt(req.query.target) || 1000000;
    const mode = req.query.mode || 'safe';
    const confidence = parseInt(req.query.confidence) || 80;
    res.json(CAPITAL.calculateBet(current, target, mode, confidence));
});

// Performance từng logic
app.get('/performance', (req, res) => {
    const out = {};
    for (const [k, v] of Object.entries(logicPerformance)) {
        if (v.total > 0) {
            out[k] = {
                total: Math.round(v.total),
                correct: Math.round(v.correct),
                accuracy: (v.accuracy * 100).toFixed(1) + '%',
                consistency: (v.consistency * 100).toFixed(1) + '%'
            };
        }
    }
    res.json(out);
});

app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime(), games: Object.keys(GAMES) }));

app.get('/', (req, res, next) => {
    if (fs.existsSync(path.join(__dirname, 'public', 'index.html'))) return next();
    res.send('<h1>VI LONG AI</h1><p>API: /predict/lc79_hu, /predict/lc79_md5, /history/...</p>');
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[VI LONG AI V9.2] Server running on port ${PORT}`);
    console.log(`[GAMES] ${Object.keys(GAMES).join(', ')}`);
});

process.on('SIGTERM', () => { saveState(); process.exit(0); });
process.on('SIGINT', () => { saveState(); process.exit(0); });
