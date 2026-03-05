const { spawn } = require('child_process');
const path = require('path');

let cameraProcess = null;

/**
 * Starts the Python live_camera_sync.py script
 */
const startCamera = () => {
    if (cameraProcess) {
        console.log('📷 Camera process is already running.');
        try {
            require('./socket').getIo().emit('camera:log', { type: 'info', text: 'Backend: Camera process is already active.' });
        } catch (e) { }
        return;
    }

    console.log('🚀 Starting Camera Monitor (live_camera_sync.py)...');
    try {
        require('./socket').getIo().emit('camera:log', { type: 'info', text: 'Backend: Spawning live_camera_sync.py process...' });
    } catch (e) { }

    const rootPath = path.join(__dirname, '../../');
    const scriptPath = path.join(rootPath, 'live_camera_sync.py');

    // On Windows, explicitly try to use the virtual environment's python executable
    let pythonCmd = process.platform === 'win32'
        ? path.join(rootPath, '.venv', 'Scripts', 'python.exe')
        : 'python3';

    try {
        require('./socket').getIo().emit('camera:log', { type: 'info', text: `Backend: Found Python executable at ${pythonCmd}` });
    } catch (e) { }

    const fs = require('fs');
    if (process.platform === 'win32' && !fs.existsSync(pythonCmd)) {
        pythonCmd = 'python'; // Fallback if no .venv exists
    }

    // Spawn without shell. Node will safely quote spaces in args under the hood.
    cameraProcess = spawn(pythonCmd, ['-u', scriptPath], {
        cwd: rootPath,
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
        shell: false
    });

    cameraProcess.stdout.on('data', (data) => {
        const text = data.toString().trim();
        console.log(`[CAMERA] ${text}`);
        try {
            require('./socket').getIo().emit('camera:log', { type: 'info', text });
        } catch (e) { /* ignore if socket not ready */ }
    });

    cameraProcess.stderr.on('data', (data) => {
        const text = data.toString().trim();
        console.error(`[CAMERA ERROR] ${text}`);
        try {
            require('./socket').getIo().emit('camera:log', { type: 'error', text });
        } catch (e) { /* ignore if socket not ready */ }
    });

    cameraProcess.on('error', (error) => {
        console.error(`[CAMERA SPAWN ERROR] ${error.message}`);
        try {
            require('./socket').getIo().emit('camera:log', { type: 'error', text: `Failed to start camera process: ${error.message}` });
        } catch (e) { /* ignore */ }
    });

    cameraProcess.on('close', (code) => {
        console.log(`📷 Camera process exited with code ${code}`);
        try {
            require('./socket').getIo().emit('camera:log', { type: 'info', text: `Camera process exited (code ${code})` });
        } catch (e) { /* ignore */ }
        cameraProcess = null;
    });
};

/**
 * Stops the Python live_camera_sync.py script
 */
const stopCamera = () => {
    if (cameraProcess) {
        console.log('🛑 Stopping Camera Monitor...');
        const pid = cameraProcess.pid;
        if (process.platform === 'win32') {
            const { exec } = require('child_process');
            // Node's spawn PID on Windows is unreliable, so we kill any python process running our script
            exec(`wmic process where "name='python.exe' and commandline like '%live_camera_sync.py%'" call terminate`, (err) => {
                if (err) console.error(`Failed to kill process tree via wmic: ${err}`);
            });
        } else {
            cameraProcess.kill('SIGINT'); // Graceful python exit for Linux/Mac
        }
        cameraProcess = null;
        try {
            require('./socket').getIo().emit('camera:log', { type: 'info', text: 'Backend: Camera stopped via teacher action.' });
        } catch (e) { }
    } else {
        console.log('📷 No active camera process to stop.');
    }
};

module.exports = {
    startCamera,
    stopCamera
};
