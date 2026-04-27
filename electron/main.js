const { app, BrowserWindow } = require('electron');
const path   = require('path');
const http   = require('http');
const { spawn } = require('child_process');

let backendProcess = null;
let mainWindow     = null;

// ── Start Flask backend ───────────────────────────────────────────
function startBackend() {
  const backendDir  = path.join(__dirname, '../backend');
  const backendMain = path.join(backendDir, 'main.py');

  // Try 'python' on Windows, 'python3' elsewhere
  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

  backendProcess = spawn(pythonCmd, [backendMain], {
    cwd: backendDir,
    env: { ...process.env },
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
    const distIndex = path.join(__dirname, '../frontend/dist/frontend/browser/index.html');
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

  mainWindow.once('ready-to-show', () => mainWindow.show());
}

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
