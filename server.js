const express = require('express');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

// Middleware for CORS and JSON handling
app.use(express.json());
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Helper function to safely execute PowerShell scripts
function runPowerShellScript(dateString, callback) {
    const psScript = 'C:\\Users\\rserv\\draftkings\\fetch_slate.ps1';
    const cmd = `powershell.exe -ExecutionPolicy Bypass -File "${psScript}" -Date "${dateString}"`;

    console.log(`[SERVER] Executing script for date: ${dateString}...`);

    exec(cmd, (error, stdout, stderr) => {
        if (error) {
            console.error(`[ERROR] PowerShell Execution Failed: ${error.message}`);
            return callback(error, null, stdout);
        }
        if (stderr && !stdout) {
            console.warn(`[WARN] PowerShell Stderr: ${stderr}`);
        }
        console.log(`[SUCCESS] PowerShell Logs:\n${stdout}`);
        return callback(null, stdout, stderr);
    });
}

// ============================================================================
// 1. ENDPOINT: /api/dk_odds (Triggered by Excel DK_Odds Query)
// ============================================================================
app.get('/api/dk_odds', (req, res) => {
    // Read ?date parameter from Power Query (default to today if empty)
    const targetDate = req.query.date || new Date().toISOString().split('T')[0];
    const csvExportPath = 'C:\\Users\\rserv\\draftkings\\csv_exports\\Todays_Pitchers.csv';

    runPowerShellScript(targetDate, (err, stdout) => {
        if (err) {
            return res.status(500).json({
                status: 'error',
                message: 'Failed to run PowerShell script.',
                details: err.message
            });
        }

        if (fs.existsSync(csvExportPath)) {
            res.json({
                status: 'success',
                date: targetDate,
                csv_path: csvExportPath,
                message: 'Slate fetched successfully.'
            });
        } else {
            res.status(404).json({
                status: 'error',
                message: 'Todays_Pitchers.csv output file was not found.',
                logs: stdout
            });
        }
    });
});

// ============================================================================
// 2. ENDPOINT: /api/stats (Triggered by Excel Stats Query)
// ============================================================================
app.get('/api/stats', (req, res) => {
    const targetDate = req.query.date || new Date().toISOString().split('T')[0];
    const csvExportPath = 'C:\\Users\\rserv\\draftkings\\csv_exports\\Todays_Pitchers.csv';

    if (fs.existsSync(csvExportPath)) {
        res.json({
            status: 'success',
            date: targetDate,
            endpoint: 'stats',
            file_ready: true
        });
    } else {
        // Return fallback schema to keep Power Query from throwing fatal 404 errors on off-days
        res.json({
            status: 'warning',
            date: targetDate,
            message: 'No stats available for selected date.',
            file_ready: false
        });
    }
});

// ============================================================================
// 3. ENDPOINT: /api/list_columns (Triggered by Excel List Columns Query)
// ============================================================================
app.get('/api/list_columns', (req, res) => {
    // Provides column definitions to prevent 'Download did not complete' errors in Excel
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

// Health check endpoint
app.get('/', (req, res) => {
    res.send('DraftKings MLB Proxy Server is Active and Running on Port 3000');
});

// Start Node Server
app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`DraftKings MLB Proxy Server running on http://localhost:${PORT}`);
    console.log(`Ready for Power Query requests...`);
    console.log(`====================================================`);
});
