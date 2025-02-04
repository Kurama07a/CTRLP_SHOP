const { ipcRenderer } = require('electron');
const fs = require('fs').promises;
const path = require('path');

let transactions = [];

document.addEventListener('DOMContentLoaded', () => {
    initializeUI();
    loadTransactions();
    setupEventListeners();
});

function initializeUI() {
    updateButtonText();
    renderMetrics();
}

function updateButtonText() {
    const button = document.getElementById('toggleWebSocket');
    const statusText = document.getElementById('statusText');
    button.checked = isConnected;
    statusText.textContent = isConnected ? 'ONLINE' : 'OFFLINE';
}

function setupEventListeners() {
    document.getElementById('toggleWebSocket').addEventListener('click', toggleWebSocket);
    
    // Add event listeners for navigation
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const page = e.currentTarget.querySelector('span').textContent.toLowerCase();
            navigateTo(page);
        });
    });
}

function navigateTo(page) {
    if (page === 'dashboard') {
        window.location.href = 'index.html';
    } else if (page === 'transaction') {
        window.location.href = 'transactions.html';
    }
    // Add more page conditions as needed
}

async function loadTransactions() {
    try {
        const data = await fs.readFile(path.join(__dirname, 'transactions.json'), 'utf-8');
        transactions = JSON.parse(data);
        renderTransactionsTable();
    } catch (error) {
        console.error('Error loading transactions:', error);
        transactions = [];
    }
}

function renderTransactionsTable() {
    const tableBody = document.getElementById('transactionsTableBody');
    tableBody.innerHTML = '';

    transactions.forEach(job => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${job.job_id}</td>
            <td>${job.file}</td>
            <td>${job.printer}</td>
            <td>${job.paper_size}</td>
            <td>${job.color_mode}</td>
            <td>${job.copies}</td>
            <td>${job.end_page - job.start_page + 1}</td>
            <td>${job.status}</td>
            <td>${new Date(job.timestamp).toLocaleString()}</td>
        `;
        tableBody.appendChild(row);
    });
}

function toggleWebSocket() {
    isConnected = !isConnected;
    ipcRenderer.send('toggle-websocket', isConnected);
    updateButtonText();
}

function renderMetrics() {
    // Implement metric rendering logic (similar to index.html)
}

// IPC event listeners
ipcRenderer.on('websocket-status', (event, status) => {
    isConnected = status === 'connected';
    updateButtonText();
});

ipcRenderer.on('update-transaction', (event, job) => {
    const existingIndex = transactions.findIndex(t => t.job_id === job.job_id);
    if (existingIndex > -1) {
        transactions[existingIndex] = job;
    } else {
        transactions.push(job);
    }
    saveTransactions();
    renderTransactionsTable();
});

async function saveTransactions() {
    try {
        await fs.writeFile(path.join(__dirname, 'transactions.json'), JSON.stringify(transactions, null, 2));
    } catch (error) {
        console.error('Error saving transactions:', error);
    }
}