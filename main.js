const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const pdfToPrinter = require('pdf-to-printer');
//const dotenv = require('dotenv');
//dotenv.config();
const si = require('systeminformation'); // Import the library

function logMetrics(action, details) {
    log(`[Metrics] ${action}: ${JSON.stringify(details)}`);
}
const { PDFDocument } = require('pdf-lib');
// Constants and Configuration
const FIXED_PAPER_SIZES = ['A4', 'A5', 'Letter', 'Legal'];
const JOB_HISTORY_FILE = path.join(app.getPath('userData'), 'jobHistory.json');
const METRICS_FILE = path.join(app.getPath('userData'), 'metrics.json');
const PRINTER_INFO_FILE = path.join(app.getPath('userData'), 'printerInfo.json');
const SUPABASE_URL = 'https://gxbdltjmtvrtsomvbrgv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd4YmRsdGptdHZydHNvbXZicmd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjI3NzA1MzMsImV4cCI6MjAzODM0NjUzM30.pUmy3OF_GeMPxQ0L9ysFgya44SZYybXBe4V8avM_5s0';
const SHOP_ID = 3;
const BUCKET_NAME = 'combined-pdfs';


// Global Variables
let isConnected = false;
let mainWindow;
let webSocket;
let supabase;
let jobHistory = [];
let printerInfo = {
    paperLevels: {},
    discardedPrinters: []
};
let metrics = {};
let printerQueueIndex = 0;
let printerQueues = {};
let processedJobs = new Set();
let currentlyProcessingJobs = new Set();

function getCurrentDate() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// Function to get printers using systeminformation
async function getPrintersUsingSystemInformation() {
    try {
        const printers = await si.printer();
        return printers;
    } catch (error) {
        log(`Error fetching printers: ${error.message}`);
        return [];
    }
}

// Logging
function log(message) {
    console.log(`[${new Date().toISOString()}] ${message}`);
    if (mainWindow) {
        mainWindow.webContents.send('log-message', message);
    }
}
async function getLastPageNumber(filePath) {
    try {
        const pdfBytes = await fs.promises.readFile(filePath);
        const pdfDoc = await PDFDocument.load(pdfBytes);
        return pdfDoc.getPageCount();
    } catch (error) {
        log(`Error getting PDF page count: ${error.message}`);
        throw error;
    }
}
// File Operations
function loadJobHistory() {
    try {
        if (fs.existsSync(JOB_HISTORY_FILE)) {
            const data = fs.readFileSync(JOB_HISTORY_FILE, 'utf8');
            jobHistory = JSON.parse(data);
            jobHistory = Object.values(jobHistory.reduce((acc, job) => {
                acc[job.job_id] = job;
                return acc;
            }, {}));
            log(`Loaded ${jobHistory.length} unique jobs from history`);
        } else {
            log('No job history file found. Starting with an empty history.');
            jobHistory = [];
            saveJobHistory();
        }
    } catch (error) {
        log(`Error loading job history: ${error.message}`);
        jobHistory = [];
    }
}

function saveJobHistory() {
    try {
        fs.writeFileSync(JOB_HISTORY_FILE, JSON.stringify(jobHistory, null, 2));
        log(`Saved ${jobHistory.length} unique jobs to history`);
    } catch (error) {
        log(`Error saving job history: ${error.message}`);
    }
}

function loadPrinterInfo() {
    try {
        if (fs.existsSync(PRINTER_INFO_FILE)) {
            const data = fs.readFileSync(PRINTER_INFO_FILE, 'utf8');
            printerInfo = JSON.parse(data);
            log('Loaded printer information from file');
        } else {
            log('No printer information file found. Starting with empty printer info.');
            printerInfo = { paperLevels: {}, discardedPrinters: [] };
            savePrinterInfo();
        }
    } catch (error) {
        log(`Error loading printer information: ${error.message}`);
        printerInfo = { paperLevels: {}, discardedPrinters: [] };
    }
}

function savePrinterInfo() {
    fs.writeFileSync(PRINTER_INFO_FILE, JSON.stringify(printerInfo, null, 2));
    log('Saved printer information to file');
}

function updateMetrics(job) {
    logMetrics('Starting metric update for job', { jobId: job.job_id });
    
    if (job.status=== 'success') {
        const pagesUsed = (job.end_page - job.start_page + 1) * job.copies;
        logMetrics('Calculated pages used', { pagesUsed, job });
        
        metrics.totalPages += pagesUsed;
        
        if (job.color_mode.toLowerCase() === 'color') {
            metrics.colorJobs++;
            metrics.totalIncome += pagesUsed * 10;
            logMetrics('Updated color job metrics', { 
                totalPages: metrics.totalPages,
                colorJobs: metrics.colorJobs,
                income: metrics.totalIncome 
            });
        } else {
            metrics.monochromeJobs++;
            metrics.totalIncome += pagesUsed * 3;
            logMetrics('Updated monochrome job metrics', { 
                totalPages: metrics.totalPages,
                monoJobs: metrics.monochromeJobs,
                income: metrics.totalIncome 
            });
        }
        
        saveMetrics();
        mainWindow.webContents.send('metrics-updated', metrics);
        logMetrics('Metrics update completed', metrics);
    } else {
        logMetrics('Skipping metrics update - job not completed', { 
            jobId: job.job_id,
            status: job.print_status 
        });
    }
}

function saveMetrics() {
    try {
        logMetrics('Starting metrics save');
        const currentDate = getCurrentDate();
        let allMetrics = {};
        
        if (fs.existsSync(METRICS_FILE)) {
            const data = fs.readFileSync(METRICS_FILE, 'utf8');
            allMetrics = JSON.parse(data);
            logMetrics('Loaded existing metrics file', { date: currentDate });
        }
        
        allMetrics[currentDate] = metrics;
        fs.writeFileSync(METRICS_FILE, JSON.stringify(allMetrics, null, 2));
        logMetrics('Saved metrics successfully', { date: currentDate, metrics });
    } catch (error) {
        log(`Error saving metrics: ${error.message}`);
        logMetrics('Failed to save metrics', { error: error.message });
    }
}

function loadMetrics() {
    try {
        logMetrics('Starting metrics load');
        if (fs.existsSync(METRICS_FILE)) {
            const data = fs.readFileSync(METRICS_FILE, 'utf8');
            const allMetrics = JSON.parse(data);
            const currentDate = getCurrentDate();
            metrics = allMetrics[currentDate] || {
                totalPages: 0,
                monochromeJobs: 0,
                colorJobs: 0,
                totalIncome: 0
            };
            logMetrics('Loaded metrics successfully', { date: currentDate, metrics });
        } else {
            logMetrics('No metrics file found, initializing new metrics');
            metrics = {
                totalPages: 0,
                monochromeJobs: 0,
                colorJobs: 0,
                totalIncome: 0
            };
            saveMetrics();
        }
    } catch (error) {
        log(`Error loading metrics: ${error.message}`);
        logMetrics('Failed to load metrics', { error: error.message });
        metrics = {
            totalPages: 0,
            monochromeJobs: 0,
            colorJobs: 0,
            totalIncome: 0
        };
    }
}
// Printer Management

// Updated initializePrinters function
async function initializePrinters() {
    try {
        const allPrinters = await getPrintersUsingSystemInformation();
        const physicalPrinters = filterPhysicalPrinters(allPrinters);

        physicalPrinters.forEach(printer => {
            if (!printerInfo.paperLevels[printer.name]) {
                printerInfo.paperLevels[printer.name] = {};
                FIXED_PAPER_SIZES.forEach(size => {
                    printerInfo.paperLevels[printer.name][size] = 0;
                });
                log(`Added new printer: ${printer.name}`);
            }
        });

        Object.keys(printerInfo.paperLevels).forEach(printerName => {
            if (!physicalPrinters.some(p => p.name === printerName)) {
                delete printerInfo.paperLevels[printerName];
                printerInfo.discardedPrinters = printerInfo.discardedPrinters.filter(p => p !== printerName);
                log(`Removed non-existent printer: ${printerName}`);
            }
        });

        savePrinterInfo();
    } catch (error) {
        log(`Error initializing printers: ${error.message}`);
    }
}

function filterPhysicalPrinters(allPrinters) {
    const virtualPrinterKeywords = [
        'pdf', 'onenote', 'xps', 'document', 'fax', 'remote',
        'virtual', 'cloud', 'microsoft', 'adobe', 'foxit', 'chrome',
        'edge', 'firefox', 'opera', 'cutepdf', 'bullzip', 'novapdf',
        'print to', 'save as', 'web', 'writer', 'image', 'scan'
    ];

    return allPrinters.filter(printer => {
        const printerNameLower = printer.name.toLowerCase();
        return !virtualPrinterKeywords.some(keyword =>
            printerNameLower.includes(keyword.toLowerCase())
        );
    });
}
function areAllPrintersDiscarded(discardedPrinters, paperLevels) {
    const totalPrinters = Object.keys(paperLevels).length;
    return totalPrinters > 0 && totalPrinters === discardedPrinters.length;
}
async function getPrinters() {
    try {
        await initializePrinters();
        return {
            printers: Object.keys(printerInfo.paperLevels).map(name => ({
                name,
                capabilities: {
                    color: true,
                    duplex: true,
                    paperSizes: FIXED_PAPER_SIZES,
                }
            })),
            printerInfo
        };
    } catch (error) {
        log(`Error getting printers: ${error.message}`);
        return { printers: [], printerInfo };
    }
}

function updateDiscardedPrinters(_event, updatedDiscardedPrinters) {
    printerInfo.discardedPrinters = updatedDiscardedPrinters;
    savePrinterInfo();
    log(`Updated discarded printers: ${updatedDiscardedPrinters.join(', ')}`);

    // Check if all printers are now discarded
    if (areAllPrintersDiscarded(updatedDiscardedPrinters, printerInfo.paperLevels)) {
        log('All printers are now discarded. Closing WebSocket connection...');
        closeWebSocket();
        mainWindow.webContents.send('all-printers-discarded');
    }
}

function updatePrinterPaperLevels(_event, { printerName, levels }) {
    printerInfo.paperLevels[printerName] = levels;
    savePrinterInfo();
    log(`Updated paper levels for ${printerName}: ${JSON.stringify(levels)}`);
}

function updatePaperLevels(printerName, paperSize, change) {
    if (printerInfo.paperLevels[printerName] && printerInfo.paperLevels[printerName][paperSize] !== undefined) {
        printerInfo.paperLevels[printerName][paperSize] += change;
        log(`Updated paper levels for ${printerName}: ${paperSize} - ${printerInfo.paperLevels[printerName][paperSize]} pages`);
        savePrinterInfo();
    } else {
        log(`Warning: Cannot update paper levels for ${printerName} (${paperSize})`);
    }
}

// Job Management
function getJobHistory() {
    return jobHistory;
}

function addOrUpdateJobInHistory(job, printerName, status) {
    const jobEntry = {
        ...job,
        assigned_printer: printerName,
        print_status: status,
        processed_timestamp: new Date().toISOString(),
        shop_id: SHOP_ID,
        pages_printed: job.end_page - job.start_page + 1,
        total_pages: (job.end_page - job.start_page + 1) * job.copies
    };

    const existingJobIndex = jobHistory.findIndex(j => j.job_id === job.job_id);

    if (existingJobIndex !== -1) {
        jobHistory[existingJobIndex] = jobEntry;
        log(`Updated job ${job.job_id} in history`);
    } else {
        jobHistory.push(jobEntry);
        log(`Added job ${job.job_id} to history`);
    }
    if (status === 'completed') {
        updateMetrics(job);
    }
    saveJobHistory();
    mainWindow.webContents.send('job-history-updated');
}

async function processPrintJob(event, job) {
    log(`Received print job: ${JSON.stringify(job)}`);
    const file = job.file ? job.file : job.combined_file;
    try {
        if (processedJobs.has(job.job_id) || currentlyProcessingJobs.has(job.job_id)) {
            log(`Job ${job.job_id} has already been processed or is currently processing. Skipping.`);
            return;
        }

        currentlyProcessingJobs.add(job.job_id);
        const allPrinters = await getPrintersUsingSystemInformation();
        const validPrinters = filterValidPrinters(allPrinters, job);
        const suitablePrinter = findSuitablePrinter(validPrinters, job);

        if (!suitablePrinter) {
            log(`No suitable printer found for job ${job.job_id}`);
            addOrUpdateJobInHistory(job, null, 'failed');
            event.sender.send('print-failed', job.job_id);
            return;
        }

        log(`Selected printer for job ${job.job_id}: ${suitablePrinter.name}`);

        const filePath = await downloadFileFromSupabase(file);
        const printOptions = createPrintOptions(job, suitablePrinter);

        // Update job history before printing
        addOrUpdateJobInHistory(job, suitablePrinter.name, 'in-progress');
        addJobToQueue(suitablePrinter.name, { ...job, totalPages: await getLastPageNumber(filePath) });

        await processQueue(suitablePrinter.name, filePath, printOptions);

        addOrUpdateJobInHistory(job, suitablePrinter.name, 'completed');
        event.sender.send('print-complete', job.job_id);
        if (job.status === 'success') {
            log(`Job ${job.job_id} completed successfully`);
            updateMetrics(job);  // Make sure this is called after successful completion
        }


    } catch (error) {
        log(`Error processing print job ${job.job_id}: ${error.message}`);
        addOrUpdateJobInHistory(job, null, 'failed');
        event.sender.send('print-failed', job.job_id);
    } finally {
        currentlyProcessingJobs.delete(job.job_id);
    }
}

function filterValidPrinters(allPrinters, job) {
    log(`Filtering printers for job ${job.job_id}`);
    return allPrinters.filter(printer => {
        const isNotDiscarded = !printerInfo.discardedPrinters.includes(printer.name);
        const hasPaperLevels = !!printerInfo.paperLevels[printer.name];
        const hasEnoughPaper = printerInfo.paperLevels[printer.name] &&
            printerInfo.paperLevels[printer.name][job.paper_size] >= 10;
        log(`Printer ${printer.name}: isNotDiscarded=${isNotDiscarded}, hasPaperLevels=${hasPaperLevels}, hasEnoughPaper=${hasEnoughPaper}`);
        return isNotDiscarded && hasPaperLevels && hasEnoughPaper;
    });
}

function findSuitablePrinter(printers, job) {
    log(`Finding suitable printer for job ${job.job_id}`);
    const suitablePrinters = printers.filter(printer => {
        const supportsColor = job.color_mode === 'color' ? printer.capabilities.color : true;
        let supportsDuplex = true;
        if (job.duplex === 'horizontal' || job.duplex === 'vertical') {
            supportsDuplex = printer.capabilities.duplex || false;
        }
        log(`Printer ${printer.name}: supportsColor=${supportsColor}, supportsDuplex=${supportsDuplex}`);
        return supportsColor && supportsDuplex;
    });

    log(`Found ${suitablePrinters.length} suitable printers`);

    if (suitablePrinters.length > 0) {
        const selectedPrinter = suitablePrinters[printerQueueIndex % suitablePrinters.length];
        printerQueueIndex++;
        log(`Selected printer: ${selectedPrinter.name}`);
        return selectedPrinter;
    }

    log('No suitable printer found');
    return null;
}

function addJobToQueue(printerName, job) {
    if (!printerQueues[printerName]) {
        printerQueues[printerName] = [];
    }
    printerQueues[printerName].push({ ...job, status: 'in-progress' });
    log(`Added job ${job.job_id} to queue for printer ${printerName}`);
    mainWindow.webContents.send('update-dashboard', { printerName, job });
}

async function processQueue(printerName, filePath, printOptions) {
    const queue = printerQueues[printerName];
    if (!queue || queue.length === 0) {
        log(`No jobs in queue for printer ${printerName}`);
        return;
    }

    while (queue.length > 0) {
        const job = queue[0];

        if (processedJobs.has(job.job_id)) {
            log(`Job ${job.job_id} has already been processed. Removing from queue.`);
            queue.shift();
            continue;
        }

        log(`Processing job ${job.job_id} on printer ${printerName}`);

        try {
            queue.shift();
            mainWindow.webContents.send('update-dashboard', { printerName, job: { ...job, status: 'processing' } });

            // Print wrapper pages and content in sequence
            await printJobWithWrappers(filePath, printOptions, job);

            job.status = 'success';
            log(`Successfully printed job ${job.job_id} on printer ${printerName}`);
            mainWindow.webContents.send('print-complete', job.job_id);

            // Calculate total pages printed including wrapper pages
            const contentPages = (job.end_page - job.start_page + 1) * job.copies;
            const totalPagesUsed = contentPages + 2; // Add 2 for wrapper pages
            updatePaperLevels(printerName, job.paper_size, -totalPagesUsed);
            sendJobUpdate('JOB_COMPLETED', job.job_id);
            updateMetrics(job);

            // Delete the file after successful printing
            await deleteFile(filePath);

            processedJobs.add(job.job_id);
        } catch (error) {
            log(`Error processing print job ${job.job_id} on printer ${printerName}: ${error}`);
            job.status = 'failed';
            mainWindow.webContents.send('print-failed', job.job_id);
            sendJobUpdate('JOB_FAILED', job.job_id);
        }

        mainWindow.webContents.send('update-dashboard', { printerName, job });
    }
}

async function printJobWithWrappers(filePath, printOptions, job) {
    try {
        // 1. Print front wrapper page
        const frontPageOptions = {
            ...printOptions,
            pages: '1',
            copies: 1  // Always print one copy of wrapper pages
        };
        await pdfToPrinter.print(filePath, frontPageOptions);
        log(`Printed front wrapper page for job ${job.job_id}`);

        // 2. Print main content with adjusted page numbers
        const contentOptions = {
            ...printOptions,
            pages: `${parseInt(job.start_page) + 1}-${parseInt(job.end_page) + 1}`
        };
        await pdfToPrinter.print(filePath, contentOptions);
        log(`Printed main content for job ${job.job_id}`);

        // 3. Print back wrapper page
        const backPageOptions = {
            ...printOptions,
            pages: job.totalPages.toString(),
            copies: 1  // Always print one copy of wrapper pages
        };
        await pdfToPrinter.print(filePath, backPageOptions);
        log(`Printed back wrapper page for job ${job.job_id}`);

    } catch (error) {
        log(`Error in printJobWithWrappers for job ${job.job_id}: ${error.message}`);
        throw error;
    }
}

// Supabase Operations
async function downloadFileFromSupabase(fileName) {
    try {
        const { data, error } = await supabase.storage
            .from(BUCKET_NAME)
            .download(fileName);

        if (error) {
            log(`Supabase download error: ${JSON.stringify(error)}`);
            throw error;
        }

        if (!data) {
            log('No data received from Supabase');
            throw new Error('No data received from Supabase');
        }

        const filePath = path.join(app.getPath('downloads'), fileName);

        await fs.promises.writeFile(filePath, Buffer.from(await data.arrayBuffer()));

        log(`File downloaded successfully: ${fileName}`);
        return filePath;
    } catch (error) {
        log(`Error downloading file ${fileName} from Supabase: ${error.message}`);
        throw error;
    }
}

// Utility Functions
function createPrintOptions(job, printer) {
    return {
        printer: printer.name,
        pages: `${job.start_page}-${job.end_page}+${2}`,
        copies: job.copies,
        duplex: getDuplexMode(job.duplex),
        monochrome: job.color_mode === 'Monochrome',
        paperSize: validatePaperSize(job.paper_size),
        orientation: job.orientation.toLowerCase()
    };
}

function getDuplexMode(duplex) {
    switch (duplex) {
        case 'horizontal':
            return 'short-edge';
        case 'vertical':
            return 'long-edge';
        default:
            return 'one-sided';
    }
}

function validatePaperSize(paperSize) {
    return FIXED_PAPER_SIZES.includes(paperSize) ? paperSize : 'A4';
}

// WebSocket Operations
function toggleWebSocket(_event, connect) {
    if (connect) {
        initializeWebSocket();
    } else {
        closeWebSocket();
    }
    isConnected = connect;
}

async function deleteFile(filePath) {
    try {
        await fs.promises.unlink(filePath);
        log(`File deleted successfully: ${filePath}`);
    } catch (error) {
        log(`Error deleting file ${filePath}: ${error.message}`);
    }
}

function initializeWebSocket() {
    if (areAllPrintersDiscarded(printerInfo.discardedPrinters, printerInfo.paperLevels)) {
        log('Cannot initialize WebSocket: All printers are discarded');
        mainWindow.webContents.send('websocket-status', 'disabled');
        mainWindow.webContents.send('all-printers-discarded');
        return;
    }

    const wsUrl = `ws://157.245.107.94:8080/${SHOP_ID}`;
    //const wsUrl = `ws://localhost:8080/${SHOP_ID}`;
    webSocket = new WebSocket(wsUrl);

    webSocket.on('ping', () => {
        webSocket.pong(); // Automatically respond to server pings
    });

    webSocket.on('open', () => {
        log(`WebSocket connection established for shop ${SHOP_ID}`);
        mainWindow.webContents.send('websocket-status', 'connected');
        isConnected = true;
        const shopupdate = { type: 'SHOP_OPEN', shopid: [SHOP_ID] };
        webSocket.send(JSON.stringify(shopupdate));
        log(`Sent SHOP_OPEN update for shop ${SHOP_ID}`);
    });

    webSocket.on('message', async (data) => {
        const message = JSON.parse(data);
        log(`Received message from WebSocket server: ${JSON.stringify(message)}`);

        if (message.type === 'NEW_JOBS' && message.jobs) {
            for (const job of message.jobs) {
                mainWindow.webContents.send('print-job', job);
                try {
                    addOrUpdateJobInHistory(job, null, 'received');
                } catch (error) {
                    log(`Error adding job ${job.job_id} to history: ${error.message}`);
                }
            }

            const jobIds = message.jobs.map((job) => job.job_id);
            const jobUpdate = { type: 'JOB_RECEIVED', job_ids: jobIds };
            webSocket.send(JSON.stringify(jobUpdate));
            log(`Sent job received update for jobs: ${jobIds.join(', ')}`);
        }
    });

    webSocket.on('error', (error) => {
        log(`WebSocket error: ${error.message}`);
        mainWindow.webContents.send('websocket-status', 'error');
        mainWindow.webContents.send('force-toggle-websocket', false);
        isConnected = false;
    });

    webSocket.on('close', () => {
        //log(`WebSocket connection closed for shop ${SHOP_ID}. Code: ${code}, Reason: ${reason}`);
        mainWindow.webContents.send('websocket-status', 'disconnected');
        mainWindow.webContents.send('force-toggle-websocket', false);
        isConnected = false;
    });
}

function closeWebSocket() {
    if (webSocket) {
        if (webSocket.readyState === WebSocket.OPEN) {
            const shopupdate = { type: 'SHOP_CLOSED', shopid: [SHOP_ID] };
            webSocket.send(JSON.stringify(shopupdate));
            log(`Shop is now closed ${SHOP_ID}`);
        }
        webSocket.close();
        webSocket = null;
        log('WebSocket connection closed');
        mainWindow.webContents.send('websocket-status', 'disconnected');
    }
}

function sendJobUpdate(type, jobId) {
    if (webSocket && webSocket.readyState === WebSocket.OPEN) {
        const jobUpdate = { type, job_ids: [jobId] };
        webSocket.send(JSON.stringify(jobUpdate));
        log(`Sent ${type} update for job ${jobId}`);
    } else {
        log(`WebSocket is not open. Cannot send ${type} update.`);
    }
}

// Electron App Setup
function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 1920,
        height: 1080,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: false,
        },
    });

    mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    createMainWindow();
    loadJobHistory();
    getPrinters();
    initializePrinters();
    loadPrinterInfo();
    setupIpcHandlers();
    loadMetrics();
});

function setupIpcHandlers() {
    ipcMain.handle('get-printers', getPrinters);
    ipcMain.on('update-discarded-printers', updateDiscardedPrinters);
    ipcMain.on('update-printer-paper-levels', updatePrinterPaperLevels);
    ipcMain.on('process-print-job', processPrintJob);
    ipcMain.on('toggle-websocket', toggleWebSocket);
    ipcMain.handle('get-job-history', getJobHistory);
    ipcMain.handle('get-printer-info', () => printerInfo);
    ipcMain.handle('get-metrics', () => {
        log('IPC: Received get-metrics request');
        return metrics;
    });
    ipcMain.on('save-metrics', () => {
        log('IPC: Received save-metrics request');
        saveMetrics();
    });

}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});