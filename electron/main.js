import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import updaterPkg from 'electron-updater'
const { autoUpdater } = updaterPkg


const __dirname = dirname(fileURLToPath(import.meta.url))

let pyProcess = null

function createWindow() {
  // Use PNG for BrowserWindow icon (works on Windows for titlebar)
  // electron-builder handles ICO conversion for taskbar/installer icon automatically
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '../public/icon.png')

  const win = new BrowserWindow({
    width: 1920,
    height: 1080,
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, 'preload.mjs'),
    },
    autoHideMenuBar: true,
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    // In production, __dirname = .../resources/app.asar/dist-electron
    // dist/index.html is inside the same asar at dist-electron/../dist/index.html
    win.loadFile(join(__dirname, '../dist/index.html'))
  }

  // HTML <title> overrides BrowserWindow title — reset it after load
  const correctTitle = `AG ${app.getVersion()}`
  win.webContents.on('did-finish-load', () => {
    win.setTitle(correctTitle)
  })
  win.on('page-title-updated', (e) => {
    e.preventDefault()  // Prevent any title change from renderer
  })
}

function getSender(event) {
  const sender = event?.sender
  if (!sender || sender.isDestroyed()) {
    return null
  }
  return sender
}

function safeSend(event, channel, payload) {
  const sender = getSender(event)
  if (!sender) {
    return false
  }
  sender.send(channel, payload)
  return true
}

function stopPythonProcess() {
  if (pyProcess && !pyProcess.killed) {
    try {
      pyProcess.kill()
    } catch (_) {
      // Process already exited - ignore "not found" error
    }
  }
  pyProcess = null
}

function handlePythonJsonMessage(event, msg, options = {}) {
  if (msg.type === 'log') {
    safeSend(event, 'py-log', msg.message)
    return
  }

  if (msg.type === 'progress') {
    safeSend(event, 'py-progress', { done: msg.done, total: msg.total })
    return
  }

  if (msg.type === 'done') {
    safeSend(event, 'py-done')
    return
  }

  if (msg.type === 'error') {
    safeSend(event, 'py-error', msg.message)
    return
  }

  if (msg.type === 'story_update' && options.enableStoryUpdates) {
    safeSend(event, 'py-story-update', { idx: msg.idx, status: msg.status })
  }
}

function getPythonExe(pythonDir) {
  if (pythonDir && pythonDir.trim()) {
    const customExe = join(pythonDir.trim(), 'python.exe')
    if (fs.existsSync(customExe)) {
      return customExe
    }
    // Dir specified but python.exe not found there → fall back to system python
    console.warn(`[getPythonExe] python.exe not found at: ${customExe} — falling back to system python`)
  }
  return 'python'
}

function spawnPythonRunner(event, runnerPath, configPath, payload, options = {}) {
  return new Promise((resolve) => {
    let started = false
    let settled = false

    const settle = (result) => {
      if (!settled) {
        settled = true
        resolve(result)
      }
    }

    try {
      fs.writeFileSync(configPath, JSON.stringify(payload, null, 2))
    } catch (error) {
      settle({ success: false, error: `Failed to write temp mapping: ${error.message}` })
      return
    }

    stopPythonProcess()

    const child = spawn(getPythonExe(options.pythonDir), [runnerPath, configPath], {
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONWARNINGS: 'ignore::ResourceWarning',
        PYTHONUTF8: '1',
        // Merge user-specified site-packages dir into PYTHONPATH
        ...(options.sitePkgDir && options.sitePkgDir.trim() ? {
          PYTHONPATH: [
            options.sitePkgDir.trim(),
            process.env.PYTHONPATH || ''
          ].filter(Boolean).join(';')
        } : {})
      },
    })
    pyProcess = child

    child.stdout.on('data', (buffer) => {
      const lines = buffer.toString().split(/\r?\n/)
      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line) {
          continue
        }

        if (!started) {
          started = true
          settle({ success: true })
        }

        try {
          const msg = JSON.parse(line)
          handlePythonJsonMessage(event, msg, options)
        } catch {
          safeSend(event, 'py-log', line)
        }
      }
    })

    child.stderr.on('data', (buffer) => {
      const err = buffer.toString().trim()
      if (!err) {
        return
      }

      console.error(err)
      safeSend(event, 'py-log', `ERROR: ${err}`)

      if (!started) {
        settle({ success: false, error: err })
      }
    })

    child.on('error', (error) => {
      console.error(error)
      safeSend(event, 'py-error', error.message)
      if (!started) {
        settle({ success: false, error: error.message })
      }
      if (pyProcess === child) {
        pyProcess = null
      }
    })

    child.on('exit', (code) => {
      safeSend(event, 'py-log', `Python Backend exited (code ${code})`)
      if (!started) {
        settle({ success: false, error: `Python Backend exited early (code ${code})` })
      }
      if (pyProcess === child) {
        pyProcess = null
      }
    })
  })
}

app.whenReady().then(() => {
  createWindow()

  // ── Auto-updater: tải ngầm, tự cài khi đóng app ──
  let updateReady = false

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true  // Tự cài khi quit!

  // Chỉ check khi đã đóng gói (không check trong dev)
  if (app.isPackaged) {
    autoUpdater.checkForUpdates().catch(() => {})
  }

  autoUpdater.on('update-available', () => {
    // Gửi thông báo nhẹ nhàng xuống UI (không popup)
    BrowserWindow.getAllWindows()[0]?.webContents.send('update-available')
  })

  autoUpdater.on('update-downloaded', () => {
    updateReady = true
    // Gửi thông báo nhẹ xuống UI: hiện badge/icon nhỏ
    BrowserWindow.getAllWindows()[0]?.webContents.send('update-ready')
  })

  // Khi user đóng app → tự install nếu có update
  app.on('before-quit', () => {
    if (updateReady) {
      // silent=true (không hiện window cài đặt), isForceRunAfter=false (không mở lại app)
      autoUpdater.quitAndInstall(true, false)
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  stopPythonProcess()
  if (process.platform !== 'darwin') {
    app.quit()
  }

})

ipcMain.handle('start-automation', async (event, config) => {
  const defaultRunnerPath = app.isPackaged
    ? join(process.resourcesPath, 'python', 'runner.py')
    : join(__dirname, '../python/runner.py')
  // If user specified a scripts folder, use it; otherwise fall back to default
  const runnerPath = (config.scriptsDir && config.scriptsDir.trim())
    ? join(config.scriptsDir.trim(), 'runner.py')
    : defaultRunnerPath
  const configPath = app.isPackaged
    ? join(app.getPath('userData'), 'temp_config.json')
    : join(__dirname, '../python/temp_config.json')
  const payload = {
    cookie_file: config.cookiePath,
    output_dir: config.outputDir,
    frame_count: config.frameCount,
    prompts_by_frame: config.promptsByFrame,
  }

  return spawnPythonRunner(event, runnerPath, configPath, payload, {
    pythonDir: config.pythonDir,
    sitePkgDir: config.sitePkgDir,
  })
})

ipcMain.handle('start-story-automation', async (event, config) => {
  const defaultRunnerPath = app.isPackaged
    ? join(process.resourcesPath, 'python', 'runner_story.py')
    : join(__dirname, '../python/runner_story.py')
  const runnerPath = (config.scriptsDir && config.scriptsDir.trim())
    ? join(config.scriptsDir.trim(), 'runner_story.py')
    : defaultRunnerPath
  const configPath = app.isPackaged
    ? join(app.getPath('userData'), 'temp_story_config.json')
    : join(__dirname, '../python/temp_story_config.json')
  const payload = {
    cookie_file: config.cookiePath,
    output_dir: config.outputDir,
    json_list: config.storyJsons,
    max_threads: config.maxThreads,
    outline_prompt: config.outlinePrompt,
    chapter_prompt: config.chapterPrompt,
  }

  return spawnPythonRunner(event, runnerPath, configPath, payload, {
    enableStoryUpdates: true,
    pythonDir: config.pythonDir,
    sitePkgDir: config.sitePkgDir,
  })
})

ipcMain.handle('stop-automation', () => {
  if (!pyProcess) {
    return { success: false }
  }
  stopPythonProcess()
  return { success: true }
})

ipcMain.handle('open-file-dialog', async () => {
  const win = BrowserWindow.getAllWindows()[0]
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [
      { name: 'JSON Files', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })

  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0]
  }
  return null
})

ipcMain.handle('open-dir-dialog', async () => {
  const win = BrowserWindow.getAllWindows()[0]
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'],
  })

  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0]
  }
  return null
})

ipcMain.handle('open-output-dir', async (event, pathStr) => {
  try {
    // Auto-create the directory if it doesn't exist
    if (!fs.existsSync(pathStr)) {
      fs.mkdirSync(pathStr, { recursive: true })
    }
    await shell.openPath(pathStr)
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('get-version', () => app.getVersion())

ipcMain.handle('install-deps', async (event, pythonDir) => {
  return new Promise((resolve) => {
    const pyExe = getPythonExe(pythonDir)
    const packages = ['nodriver']
    const args = ['-m', 'pip', 'install', '--upgrade', ...packages]
    const child = spawn(pyExe, args, { windowsHide: true })
    let output = ''
    let errOutput = ''

    child.stdout.on('data', (buf) => { output += buf.toString() })
    child.stderr.on('data', (buf) => { errOutput += buf.toString() })

    child.on('error', (err) => {
      resolve({ success: false, error: `Cannot run Python: ${err.message}` })
    })
    child.on('exit', (code) => {
      if (code === 0) {
        resolve({ success: true, output })
      } else {
        resolve({ success: false, error: errOutput || `pip exited with code ${code}` })
      }
    })
  })
})
