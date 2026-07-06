'use strict';

//================================
//  Electron — Main Process
//================================

const { app, BrowserWindow, ipcMain} = require('electron');
const path = require('path');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

/** @type {BrowserWindow | null} */
let mainWindow = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        resizable: true,
        autoHideMenuBar: true,
        title: 'TomatoFlow',
        icon: path.join(__dirname, 'build/icon.ico'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: true,
            contextIsolation: true,
            webSecurity: false,
            allowRunningInsecureContent: true,
            autoplayPolicy: 'no-user-gesture-required',
            devTools: !app.isPackaged
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

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

ipcMain.handle('get-app-version', () => {
    return app.getVersion(); 
});

if (app.isPackaged) {
        Menu.setApplicationMenu(null);

        mainWindow.webContents.on('before-input-event', (event, input) => {
            const isControlI = input.control && input.key.toLowerCase() === 'i';
            const isF12 = input.key === 'F12';

            if (isControlI || isF12) {
                event.preventDefault(); 
            }
        });
    }