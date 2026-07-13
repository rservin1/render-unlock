import express from 'express';
import fetch from 'node-fetch';
import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Recreate __dirname for ES Modules syntax
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
// Priority given to process.env.PORT for cloud deployments (Render/Railway/Vercel)
const PORT = process.env.PORT || 3000;

// Enable CORS and JSON parsing middleware
app.use(express.json());
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Dynamic Path Resolution
const exportDir = path.join(__dirname, 'csv_exports');
const csvExportPath = path.join(exportDir, 'Todays_Pitchers.csv');
const psScriptPath = path.join(__dirname, 'fetch_slate.ps1');

// Ensure destination exports directory exists
if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
}

// Helper: Safely trigger PowerShell script execution
function runPowerShellScript(dateString, callback) {
    // Check OS platform before spawning PowerShell
    if (process.platform !== 'win32') {
        console.warn(`[WARN] Non-Windows OS (${process.platform}). Skipping PowerShell script execution.`);
        return callback(null, "Skipped PowerShell on non-Windows deployment host", "");
    }

    const cmd = `powershell.exe -ExecutionPolicy Bypass -File "${psScriptPath}" -Date "${dateString}"`;
    console.log(`[SERVER] Executing slate script for target date: ${dateString}...`);

    exec(cmd, (error, stdout, stderr) => {
        if (error) {
            console.error(`[ERROR] PowerShell Execution Failed: ${error.message}`);
            return callback(error, null, stdout);
        }
        return callback(null, stdout, stderr);
    });
}

// ============================================================================
// 1. ENDPOINT: /api/dk_odds (Used by Excel DK_Odds query)
// ============================================================================
app.get('/api/dk_odds', (req, res) => {
    const targetDate = req.query.date || new Date().toISOString().split('T')[0];

    runPowerShellScript(targetDate, (err, stdout) => {
        if (err) {
            return res.status(500).json({
                status: 'error',
                message: 'PowerShell execution failed',
                details: err.message
            });
        }

        if (fs.existsSync(csvExportPath)) {
            res.json({
                status: 'success',
                date: targetDate,
                csv_path: csvExportPath,
                message: 'Slate processed successfully.'
            });
        } else {
            // Return warning status to prevent 404/500 errors in Excel on off-days
            res.json({
                status: 'warning',
                date: targetDate,
                message: 'Slate file not generated or off-day.'
            });
        }
    });
});

// ============================================================================
// 2. ENDPOINT: /api/stats (Used by Excel Stats query)
// ============================================================================
app.get('/api/stats', (req, res) => {
    const targetDate = req.query.date || new Date().toISOString().split('T')[0];
    res.json({
        status: 'success',
        date: targetDate,
        file_ready: fs.existsSync(csvExportPath)
    });
});

// ============================================================================
// 3. ENDPOINT: /api/list_columns (Used by Excel List Columns query)
// ============================================================================
app.get('/api/list_columns', (req, res) => {
    res.json({
        columns: [
            "GameDate",
            "Team",
            "Side",
            "PitcherName",
            "MLBAM_ID",
            "FanGraphs_ID",
            "BRef_ID",
            "Retrosheet_ID"
        ]
    });
});

// Root Health Check Route (Used by Render/Railway to confirm service uptime)
app.get('/', (req, res) => {
    res.send('DraftKings MLB Proxy Server is running and active.');
});

// Start Express Server
app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`DraftKings Proxy Server running on port ${PORT}`);
    console.log(`====================================================`);
});
