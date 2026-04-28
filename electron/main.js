const { app, BrowserWindow, ipcMain } = require('electron');
const path   = require('path');
const http   = require('http');
const { spawn } = require('child_process');

let backendProcess = null;
let mainWindow     = null;

// ── Start Flask backend ───────────────────────────────────────────
function startBackend() {
  // In packaged app, backend lives in resources/backend; in dev it's ../backend
  const backendDir  = app.isPackaged
    ? path.join(process.resourcesPath, 'backend')
    : path.join(__dirname, '../backend');
  const backendMain = path.join(backendDir, 'main.py');

  // Try 'python' on Windows, 'python3' elsewhere
  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

  // Store the local SQLite DB in the OS user-data folder so each terminal has
  // its own isolated database, separate from the cloud (Railway) DB.
  // e.g. C:\Users\<user>\AppData\Roaming\Destinity Inspire POS\restaurant.db
  const userDataPath = app.getPath('userData');
  const fs = require('fs');
  fs.mkdirSync(userDataPath, { recursive: true });

  backendProcess = spawn(pythonCmd, [backendMain], {
    cwd: backendDir,
    env: { ...process.env, DB_PATH: userDataPath },
    windowsHide: true,    // no console window on Windows
  });

  backendProcess.stdout.on('data', d => process.stdout.write(`[backend] ${d}`));
  backendProcess.stderr.on('data', d => process.stderr.write(`[backend] ${d}`));
  backendProcess.on('error', err  => console.error('Backend spawn error:', err.message));
  backendProcess.on('exit',  code => console.log(`Backend exited with code ${code}`));
}

function stopBackend() {
  if (!backendProcess) return;
  try {
    if (process.platform === 'win32') {
      // taskkill kills the whole process tree on Windows
      spawn('taskkill', ['/pid', String(backendProcess.pid), '/f', '/t']);
    } else {
      backendProcess.kill('SIGTERM');
    }
  } catch (_) {}
  backendProcess = null;
}

// ── Check whether a local URL is reachable ───────────────────────
function isReachable(url, timeoutMs = 3000) {
  return new Promise(resolve => {
    const req = http.get(url, res => { res.resume(); resolve(true); });
    req.on('error', () => resolve(false));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(false); });
  });
}

// ── Poll /health until Flask is ready ────────────────────────────
function waitForBackend(timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;

    const check = () => {
      const req = http.get('http://localhost:8000/health', res => {
        if (res.statusCode === 200) return resolve();
        retry();
      });
      req.on('error', retry);
      req.setTimeout(500, () => { req.destroy(); retry(); });
    };

    const retry = () => {
      if (Date.now() >= deadline) return reject(new Error('Backend did not start in time'));
      setTimeout(check, 400);
    };

    check();
  });
}

// ── Poll localhost:4200 until Angular dev server is ready ─────────
function waitForDevServer(timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;

    const check = () => {
      const req = http.get('http://localhost:4200', res => {
        res.resume();
        if (res.statusCode < 500) return resolve();
        retry();
      });
      req.on('error', retry);
      req.setTimeout(1000, () => { req.destroy(); retry(); });
    };

    const retry = () => {
      if (Date.now() >= deadline) return reject(new Error('Angular dev server did not start in time'));
      setTimeout(check, 1000);
    };

    check();
  });
}

// ── Create browser window ─────────────────────────────────────────
async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 800, minWidth: 800, minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Destinity Inspire POS',
    show: false,
  });

  // Use Angular dev server if it becomes ready within 2 min, otherwise load built dist
  const devServerUp = await isReachable('http://localhost:4200');
  if (devServerUp) {
    console.log('Angular dev server already up — loading http://localhost:4200');
    mainWindow.loadURL('http://localhost:4200');
    mainWindow.webContents.openDevTools();
  } else {
    const distIndex = app.isPackaged
      ? path.join(process.resourcesPath, 'frontend/dist/frontend/browser/index.html')
      : path.join(__dirname, '../frontend/dist/frontend/browser/index.html');
    const fs = require('fs');
    if (fs.existsSync(distIndex)) {
      const { pathToFileURL } = require('url');
      const distURL = pathToFileURL(distIndex).href;
      console.log('Loading from built dist:', distURL);
      mainWindow.loadURL(distURL);
    } else {
      // No dist build — wait for dev server
      console.log('No dist build found — waiting for Angular dev server (up to 2 min)...');
      mainWindow.loadURL('about:blank');
      mainWindow.once('ready-to-show', () => mainWindow.show());
      try {
        await waitForDevServer(120000);
        console.log('Angular dev server ready — loading http://localhost:4200');
        mainWindow.loadURL('http://localhost:4200');
        mainWindow.webContents.openDevTools();
        return;
      } catch (e) {
        console.error('Angular dev server never started:', e.message);
      }
    }
  }

  // Allow renderer to open popups (e.g. Customer Display window)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => ({
    action: 'allow',
    overrideBrowserWindowOptions: {
      width: 1280,
      height: 800,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    },
  }));

  mainWindow.once('ready-to-show', () => mainWindow.show());
}

// ── Open secondary windows (e.g. Customer Display) via IPC ───────
ipcMain.on('open-window', (event, url) => {
  const win = new BrowserWindow({
    width: 1280, height: 800,
    backgroundColor: '#0a0e1a',   // match customer display dark background — no white flash
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Customer Display',
  });
  win.loadURL(url);
  win.webContents.on('did-fail-load', (e, code, desc) =>
    console.error(`[customer-display] failed to load ${url}: ${code} ${desc}`)
  );
});

// ── App lifecycle ─────────────────────────────────────────────────
app.whenReady().then(async () => {
  startBackend();

  try {
    await waitForBackend(30000);
    console.log('Backend is ready');
  } catch (e) {
    console.error('Backend startup timeout — opening app anyway');
  }

  await createWindow();
});

app.on('before-quit', () => stopBackend());

app.on('window-all-closed', () => {
  stopBackend();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
  // createWindow is async but fire-and-forget is fine here
});
