const { ipcRenderer } = require('electron');

let isConnected = false;
let printerList = [];
let discardedPrinters = [];
let printerQueues = {};
let printerPaperLevels = {};
let metrics = {
    totalPages: 0,
    monochromeJobs: 0,
    colorJobs: 0,
    totalIncome: 0
};
let jobHistory = [];
let currentView = 'printer';

document.addEventListener('DOMContentLoaded', () => {
    initializeUI();
    fetchAndDisplayPrinters();
    setupEventListeners();
    fetchJobHistory();
    loadMetrics();
    document.getElementById('signOut').addEventListener('click', () => {
        ipcRenderer.send('sign-out');
    });
});

// UI and View Management
function initializeUI() {
    updateButtonText();
    renderMetrics();
}
async function loadMetrics() {
    console.log('[Metrics UI] Starting metrics load');
    try {
        metrics = await ipcRenderer.invoke('get-metrics');
        console.log('[Metrics UI] Received metrics from main process:', metrics);
        renderMetrics();
    } catch (error) {
        console.error('[Metrics UI] Error loading metrics:', error);
        showNotification('Failed to load metrics', 'error');
    }
}

function updateButtonText() {
    const button = document.getElementById('statusText');
    const toggleSwitch = document.getElementById('toggleWebSocket');
    button.innerHTML = isConnected ? 'ONLINE' : 'OFFLINE';
    button.classList.toggle('connected', isConnected);
    toggleSwitch.checked = isConnected;
}
function switchView(view) {
    currentView = view;
    const views = {
        printer: document.getElementById('printerView'),
        transaction: document.getElementById('transactionView'),
        statistics: document.getElementById('statisticsView')
    };
    const discardedPrintersContainer = document.getElementById('discardedPrinters');

    Object.values(views).forEach(viewElement => {
        viewElement.style.display = 'none';
    });
    discardedPrintersContainer.style.display = 'none';

    views[view].style.display = 'block';

    if (view === 'printer') {
        discardedPrintersContainer.style.display = 'flex';
    }

    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });
    document.getElementById(`${view}Nav`).classList.add('active');

    if (view === 'transaction') {
        renderTransactionTable(jobHistory);
    } else if (view === 'statistics') {
        renderStatistics();
    }
}

// Event Listener Setup
function setupEventListeners() {
    document.getElementById('toggleWebSocket').addEventListener('click', toggleWebSocket);
    document.getElementById('dashboardNav').addEventListener('click', () => switchView('printer'));
    document.getElementById('transactionNav').addEventListener('click', () => switchView('transaction'));
    document.getElementById('statisticsNav').addEventListener('click', () => switchView('statistics'));
    document.getElementById('filterButton').addEventListener('click', filterTransactions);

    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('add-paper-btn')) {
            const [printerName, paperSize, amount] = e.target.dataset.info.split('|');
            addPages(printerName, paperSize, parseInt(amount));
        } else if (e.target.classList.contains('discard-printer-btn')) {
            discardPrinter(e.target.dataset.printer);
        } else if (e.target.classList.contains('restore-printer-btn')) {
            restorePrinter(e.target.dataset.printer);
        }
    });
}

// Printer and Job Management
async function fetchAndDisplayPrinters() {
    try {
        const { printers, printerInfo } = await ipcRenderer.invoke('get-printers');
        printerList = printers;
        discardedPrinters = printerInfo.discardedPrinters || [];
        printerPaperLevels = printerInfo.paperLevels || {};

        if (printerList.length === 0) {
            showNotification('No physical printers found. Please connect a printer and try again.', 'warning');
            document.getElementById('printersContainer').innerHTML = `
                <div class="no-printers-message">
                    <h3>No Physical Printers Found</h3>
                    <p>Please ensure that:</p>
                    <ul>
                        <li>Your printer is properly connected</li>
                        <li>Printer drivers are installed</li>
                        <li>The printer is turned on</li>
                    </ul>
                </div>
            `;
        } else {
            renderPrinters();
            updateDiscardedPrinters();
            checkAndUpdatePrinterStatus();
        }
    } catch (error) {
        console.error(`Error fetching printers: ${error.message}`);
        showNotification('Failed to fetch printers', 'error');
    }
}

function renderPrinters() {
    const printersContainer = document.getElementById('printersContainer');
    printersContainer.innerHTML = '';

    printerList.forEach(printer => {
        if (discardedPrinters.includes(printer.name)) return;
        const printerCard = createPrinterCard(printer);
        printersContainer.appendChild(printerCard);
    });
}

function createPrinterCard(printer) {
    const printerCard = document.createElement('div');
    printerCard.classList.add('printer-card', 'metallic-shine', 'physical-printer');

    const printerHeader = document.createElement('div');
    printerHeader.classList.add('printer-header');
    printerHeader.innerHTML = `
        <h2 class="printer-name">${printer.name}</h2>
        <span class="printer-type"></span>
        <button class="btn btn-small btn-danger discard-printer-btn" data-printer="${printer.name}">Discard</button>
    `;
    printerCard.appendChild(printerHeader);

    const paperLevelsDiv = createPaperLevelsDiv(printer);
    printerCard.appendChild(paperLevelsDiv);

    const jobList = createJobList(printer.name);
    printerCard.appendChild(jobList);

    return printerCard;
}

function createPaperLevelsDiv(printer) {
    const paperLevelsDiv = document.createElement('div');
    paperLevelsDiv.classList.add('paper-levels');

    printer.capabilities.paperSizes.forEach(size => {
        const paperLevel = document.createElement('div');
        paperLevel.classList.add('paper-level');
        const currentLevel = printerPaperLevels[printer.name]?.[size] || 0;
        paperLevel.innerHTML = `
            <span>${size}: <span id="${printer.name}-${size}" class="paper-level-value">${currentLevel}</span> pages</span>
            <div class="paper-level-buttons">
                <button class="btn btn-small btn-secondary add-paper-btn" data-info="${printer.name}|${size}|100">+100</button>
                <button class="btn btn-small btn-secondary add-paper-btn" data-info="${printer.name}|${size}|500">+500</button>
            </div>
        `;
        paperLevelsDiv.appendChild(paperLevel);
    });

    return paperLevelsDiv;
}

function createJobList(printerName) {
    const jobList = document.createElement('div');
    jobList.classList.add('job-list');

    if (printerQueues[printerName]) {
        printerQueues[printerName].forEach(job => {
            file = job.file ? job.file : job.combined_file;
            const jobItem = document.createElement('div');
            jobItem.classList.add('job-item', job.status);
            jobItem.textContent = `Job ID: ${job.job_id} - ${job.file} - Status: ${job.status}`;
            jobList.appendChild(jobItem);
        });
    }

    return jobList;
}

function discardPrinter(printerName) {
    if (!discardedPrinters.includes(printerName)) {
        discardedPrinters.push(printerName);
        updateDiscardedPrinters();
        renderPrinters();
        showNotification(`Printer ${printerName} discarded`, 'warning');
    }
}

function restorePrinter(printerName) {
    discardedPrinters = discardedPrinters.filter(name => name !== printerName);
    updateDiscardedPrinters();
    renderPrinters();
    showNotification(`Printer ${printerName} restored`, 'success');
}

function updateDiscardedPrinters() {
    ipcRenderer.send('update-discarded-printers', discardedPrinters);
    renderDiscardedPrinters();
}

function renderDiscardedPrinters() {
    const discardedPrintersContainer = document.getElementById('discardedPrinters');
    discardedPrintersContainer.innerHTML = '';

    if (discardedPrinters.length > 0) {
        discardedPrinters.forEach(printerName => {
            const button = document.createElement('button');
            button.classList.add('btn', 'btn-small', 'btn-secondary', 'restore-printer-btn');
            button.dataset.printer = printerName;
            button.textContent = `Restore ${printerName}`;
            discardedPrintersContainer.appendChild(button);
        });
    }

    discardedPrintersContainer.style.display = discardedPrinters.length > 0 ? 'flex' : 'none';
}

function checkAndUpdatePrinterStatus() {
    let allPrintersLow = true;
    printerList.forEach(printer => {
        const paperLevels = printerPaperLevels[printer.name];
        if (paperLevels) {
            const allLevelsLow = Object.values(paperLevels).every(level => level < 10);
            if (allLevelsLow && !discardedPrinters.includes(printer.name)) {
                discardPrinter(printer.name);
            }
            if (!allLevelsLow) {
                allPrintersLow = false;
            }
        }
    });

    if (allPrintersLow && isConnected) {
        toggleWebSocket();
        showNotification('All printers have low paper levels. WebSocket disconnected.', 'warning');
    }
}

// Job History and Metrics
async function fetchJobHistory() {
    try {
        jobHistory = await ipcRenderer.invoke('get-job-history');
        console.log('Fetched job history:', jobHistory);
        if (currentView === 'statistics') {
            renderStatistics();
        }
    } catch (error) {
        console.error('Error fetching job history:', error);
        showNotification('Failed to fetch job history', 'error');
    }
}

function renderTransactionTable(transactions) {
    const tableBody = document.getElementById('transactionTableBody');
    tableBody.innerHTML = '';

    transactions.forEach(job => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${job.job_id}</td>
            <td>${new Date(job.processed_timestamp).toLocaleString()}</td>
            <td>${job.file}</td>
            <td>${job.assigned_printer || 'N/A'}</td>
            <td>${job.total_pages}</td>
            <td>${job.color_mode}</td>
            <td>${job.print_status}</td>
        `;
        tableBody.appendChild(row);
    });
}

async function renderStatistics() {
    const jobs = await ipcRenderer.invoke('get-job-history');
    console.log('Job history for statistics:', jobs);

    if (typeof Chart !== 'undefined') {
        renderJobsPerDayChart(jobs);
        renderJobTypeDistributionChart(jobs);
        renderPaperSizeDistributionChart(jobs);
        renderPrinterUsageChart(jobs);
        renderColorVsMonochromeChart(jobs);
    } else {
        console.error('Chart.js is not loaded. Unable to render charts.');
    }

    renderVolumeStats(jobs);
    renderEfficiencyStats(jobs);
}

function renderJobsPerDayChart(jobs) {
    const ctx = document.getElementById('jobsPerDayChart').getContext('2d');
    const jobsByDay = jobs.reduce((acc, job) => {
        const date = new Date(job.processed_timestamp).toLocaleDateString();
        acc[date] = (acc[date] || 0) + 1;
        return acc;
    }, {});

    new Chart(ctx, {
        type: 'line',
        data: {
            labels: Object.keys(jobsByDay),
            datasets: [{
                label: 'Jobs per Day',
                data: Object.values(jobsByDay),
                borderColor: 'rgb(75, 192, 192)',
                tension: 0.1
            }]
        },
        options: {
            responsive: true,
            plugins: {
                title: {
                    display: true,
                    text: 'Jobs per Day'
                }
            }
        }
    });
}

function renderJobTypeDistributionChart(jobs) {
    const ctx = document.getElementById('jobTypeDistributionChart').getContext('2d');
    const jobTypes = jobs.reduce((acc, job) => {
        acc[job.color_mode] = (acc[job.color_mode] || 0) + 1;
        return acc;
    }, {});

    new Chart(ctx, {
        type: 'pie',
        data: {
            labels: Object.keys(jobTypes),
            datasets: [{
                data: Object.values(jobTypes),
                backgroundColor: ['rgb(255, 99, 132)', 'rgb(54, 162, 235)']
            }]
        },
        options: {
            responsive: true,
            plugins: {
                title: {
                    display: true,
                    text: 'Job Type Distribution'
                }
            }
        }
    });
}

function renderPaperSizeDistributionChart(jobs) {
    const ctx = document.getElementById('paperSizeDistributionChart').getContext('2d');
    const paperSizes = jobs.reduce((acc, job) => {
        acc[job.paper_size] = (acc[job.paper_size] || 0) + 1;
        return acc;
    }, {});

    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: Object.keys(paperSizes),
            datasets: [{
                label: 'Number of Jobs',
                data: Object.values(paperSizes),
                backgroundColor: 'rgb(75, 192, 192)'
            }]
        },
        options: {
            responsive: true,
            plugins: {
                title: {
                    display: true,
                    text: 'Paper Size Distribution'
                }
            }
        }
    });
}

function renderPrinterUsageChart(jobs) {
    const ctx = document.getElementById('printerUsageChart').getContext('2d');
    const printerUsage = jobs.reduce((acc, job) => {
        acc[job.assigned_printer] = (acc[job.assigned_printer] || 0) + 1;
        return acc;
    }, {});

    new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: Object.keys(printerUsage),
            datasets: [{
                data: Object.values(printerUsage),
                backgroundColor: [
                    'rgb(255, 99, 132)',
                    'rgb(54, 162, 235)',
                    'rgb(255, 206, 86)',
                    'rgb(75, 192, 192)'
                ]
            }]
        },
        options: {
            responsive: true,
            plugins: {
                title: {
                    display: true,
                    text: 'Printer Usage'
                }
            }
        }
    });
}

function renderColorVsMonochromeChart(jobs) {
    const ctx = document.getElementById('colorVsMonochromeChart').getContext('2d');
    const colorJobs = jobs.filter(job => job.color_mode === 'Color').length;
    const monoJobs = jobs.filter(job => job.color_mode === 'Monochrome').length;

    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Color', 'Monochrome'],
            datasets: [{
                label: 'Number of Jobs',
                data: [colorJobs, monoJobs],
                backgroundColor: ['rgb(255, 99, 132)', 'rgb(54, 162, 235)']
            }]
        },
        options: {
            responsive: true,
            plugins: {
                title: {
                    display: true,
                    text: 'Color vs Monochrome Jobs'
                }
            }
        }
    });
}

function renderVolumeStats(jobs) {
    const volumeStats = document.getElementById('volumeStats');
    const totalPages = jobs.reduce((sum, job) => sum + job.total_pages, 0);
    const averagePagesPerJob = (totalPages / jobs.length).toFixed(2);

    volumeStats.innerHTML = `
        <h3>Volume Statistics</h3>
        <p>Total Jobs: ${jobs.length}</p>
        <p>Total Pages Printed: ${totalPages}</p>
        <p>Average Pages per Job: ${averagePagesPerJob}</p>
    `;
}

function renderEfficiencyStats(jobs) {
    const efficiencyStats = document.getElementById('efficiencyStats');
    const completedJobs = jobs.filter(job => job.print_status === 'completed').length;
    const successRate = ((completedJobs / jobs.length) * 100).toFixed(2);

    efficiencyStats.innerHTML = `
        <h3>Efficiency Statistics</h3>
        <p>Completed Jobs: ${completedJobs}</p>
        <p>Success Rate: ${successRate}%</p>
    `;
}

// Job and Printer Updates
function addPages(printerName, paperSize, amount) {
    if (!printerPaperLevels[printerName]) {
        printerPaperLevels[printerName] = {};
    }
    if (!printerPaperLevels[printerName][paperSize]) {
        printerPaperLevels[printerName][paperSize] = 0;
    }
    printerPaperLevels[printerName][paperSize] += amount;
    document.getElementById(`${printerName}-${paperSize}`).textContent = printerPaperLevels[printerName][paperSize];
    ipcRenderer.send('update-printer-paper-levels', { printerName, levels: printerPaperLevels[printerName] });
    checkAndUpdatePrinterStatus();
    showNotification(`Added ${amount} pages to ${printerName} (${paperSize})`, 'success');
}


function renderMetrics() {
    console.log('[Metrics UI] Rendering metrics:', metrics);
    document.getElementById('totalPages').textContent = metrics.totalPages.toLocaleString();
    document.getElementById('monochromeJobs').textContent = metrics.monochromeJobs.toLocaleString();
    document.getElementById('colorJobs').textContent = metrics.colorJobs.toLocaleString();
    document.getElementById('totalIncome').textContent = `₹${metrics.totalIncome.toLocaleString()}`;
    console.log('[Metrics UI] Metrics rendered successfully');
}

// WebSocket Management
function toggleWebSocket() {
    const newState = !isConnected;
    isConnected = newState;
    ipcRenderer.send('toggle-websocket', newState);
    updateButtonText();
    showNotification(`WebSocket ${newState ? 'connected' : 'disconnected'}`, newState ? 'success' : 'info');
}
// Transaction Filtering
function filterTransactions() {
    const startDate = new Date(document.getElementById('startDate').value);
    const endDate = new Date(document.getElementById('endDate').value);
    endDate.setHours(23, 59, 59);

    const filteredJobs = jobHistory.filter(job => {
        const jobDate = new Date(job.processed_timestamp);
        return jobDate >= startDate && jobDate <= endDate;
    });

    renderTransactionTable(filteredJobs);
}

// Event Listeners for IPC

ipcRenderer.on('metrics-updated', (_event, updatedMetrics) => {
    console.log('[Metrics UI] Received metrics update:', updatedMetrics);
    metrics = updatedMetrics;
    renderMetrics();
});

ipcRenderer.on('force-toggle-websocket', (event, state) => {
    isConnected = state;
    updateButtonText();
    if (!state) {
        showNotification('WebSocket connection lost', 'warning');
    }
});

ipcRenderer.on('job-history-updated', () => {
    fetchJobHistory();
    if (currentView === 'transaction') {
        renderTransactionTable(jobHistory);
    }
});

ipcRenderer.on('websocket-status', (event, status) => {
    isConnected = status === 'connected';
    updateButtonText();
    showNotification(`WebSocket ${status}`, status === 'connected' ? 'success' : 'warning');
});

ipcRenderer.on('update-dashboard', (event, { printerName, job }) => {
    if (!printerQueues[printerName]) {
        printerQueues[printerName] = [];
    }

    const jobIndex = printerQueues[printerName].findIndex(j => j.job_id === job.job_id);

    if (jobIndex > -1) {
        printerQueues[printerName][jobIndex] = job;
    } else {
        printerQueues[printerName].push(job);
    }
    renderPrinters();
});

ipcRenderer.on('print-job', (event, job) => {
    ipcRenderer.send('process-print-job', job);
    showNotification(`New print job received: ${job.job_id}`, 'info');
});

ipcRenderer.on('print-complete', (event, jobId) => {
    showNotification(`Print job completed: ${jobId}`, 'success');
});

ipcRenderer.on('print-failed', (event, jobId) => {
    showNotification(`Print job failed: ${jobId}`, 'error');
});

ipcRenderer.on('update-paper-levels', (event, { printerName, paperSize, pagesUsed }) => {
    if (printerPaperLevels[printerName] && printerPaperLevels[printerName][paperSize]) {
        printerPaperLevels[printerName][paperSize] -= pagesUsed;
        renderPrinters();

        if (printerPaperLevels[printerName][paperSize] < 10) {
            showNotification(`Low paper alert: ${printerName} (${paperSize})`, 'warning');
            if (!discardedPrinters.includes(printerName)) {
                discardPrinter(printerName);
            }
        }

        checkAndUpdatePrinterStatus();
    }
});

ipcRenderer.on('log-message', (event, message) => {
    console.log(`[Main Process] ${message}`);
});

// Error Handling
window.onerror = function (message, source, lineno, colno, error) {
    showNotification(`An error occurred: ${message}`, 'error');
    return false;
};

window.onunhandledrejection = function (event) {
    showNotification(`An error occurred: ${event.reason}`, 'error');
};

// Periodic Refresh
setInterval(() => {
    loadMetrics();
    fetchAndDisplayPrinters();
    checkAndUpdatePrinterStatus();
}, 6000);
