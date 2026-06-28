'use strict';

//================================
//  Electron — Main Process
//================================

const { app, BrowserWindow } = require('electron');
const path = require('path');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

/** @type {BrowserWindow | null} */
let mainWindow = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        resizable: true,
        autoHideMenuBar: true,
        title: 'TomatoFlow',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: false,              // Nécessaire pour file:// → API externe
            allowRunningInsecureContent: true,
        },
    });

    mainWindow.maximize();
    mainWindow.loadFile('index.html');

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

// Quitte l'application quand toutes les fenêtres sont fermées (sauf sur macOS).
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});