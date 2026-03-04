const { spawn } = require('child_process');
const path = require('path');

let cameraProcess = null;

/**
 * Starts the Python live_camera_sync.py script
 */
const startCamera = () => {
    if (cameraProcess) {
        console.log('📷 Camera process is already running.');
        return;
    }

    console.log('🚀 Starting Camera Monitor (live_camera_sync.py)...');

    // The python script is located in the root of the project, one level up from backend
    const scriptPath = path.join(__dirname, '../../live_camera_sync.py');

    // Use 'py' on Windows, 'python3' on Mac/Linux
    const pythonCmd = process.platform === 'win32' ? 'py' : 'python3';

    // Spawn the python process (unbuffered output so we see logs immediately)
    cameraProcess = spawn(pythonCmd, ['-u', scriptPath], {
        cwd: path.join(__dirname, '../../'),
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
        shell: process.platform === 'win32' // often helps find 'py' on Windows
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
        cameraProcess.kill('SIGINT'); // Graceful python exit
        cameraProcess = null;
    } else {
        console.log('📷 No active camera process to stop.');
    }
};

module.exports = {
    startCamera,
    stopCamera
};
