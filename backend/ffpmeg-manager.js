const { spawn } = require('child_process');
const fs = require('fs');

class FFmpegManager {
    constructor() {
        this.activeStreams = new Map(); // streamKey -> process
    }

    startStream(config) {
        const {
            streamKey,
            inputImage,
            rtmpUrl,
            fps = 1,
            preset = 'veryfast',
            bitrate = '500k',
            resolution = null
        } = config;

        // Check if stream already exists
        if (this.activeStreams.has(streamKey)) {
            throw new Error(`Stream ${streamKey} is already running`);
        }

        // Check if input image exists
        if (!fs.existsSync(inputImage)) {
            throw new Error(`Input image not found: ${inputImage}`);
        }

        const ffmpegArgs = [
            '-re',
            '-loop', '1',
            '-framerate', String(fps),
            '-i', inputImage,

            // Video encoding
            '-c:v', 'libx264',
            '-preset', preset,
            '-tune', 'stillimage',
            '-pix_fmt', 'yuv420p',
            '-b:v', bitrate,
            '-maxrate', bitrate,
            '-bufsize', String(parseInt(bitrate) * 2) + 'k',
            '-g', String(fps * 2), // Keyframe interval

            // Scaling (optional)
            ...(resolution ? ['-s', resolution] : []),

            // Output format
            '-f', 'flv',
            '-flvflags', 'no_duration_filesize',

            rtmpUrl
        ];

        console.log(`🎬 Starting FFmpeg stream: ${streamKey}`);
        console.log(`   Command: ffmpeg ${ffmpegArgs.join(' ')}`);

        const ffmpegProcess = spawn('ffmpeg', ffmpegArgs);

        // Handle output
        ffmpegProcess.stdout.on('data', (data) => {
            console.log(`[${streamKey}] stdout: ${data}`);
        });

        ffmpegProcess.stderr.on('data', (data) => {
            const msg = data.toString();
            // Only log important messages (skip frame info spam)
            if (msg.includes('error') || msg.includes('Error') || msg.includes('Stream')) {
                console.log(`[${streamKey}] ${msg.trim()}`);
            }
        });

        ffmpegProcess.on('close', (code) => {
            console.log(`[${streamKey}] FFmpeg process exited with code ${code}`);
            this.activeStreams.delete(streamKey);
        });

        ffmpegProcess.on('error', (err) => {
            console.error(`[${streamKey}] FFmpeg error:`, err);
            this.activeStreams.delete(streamKey);
        });

        this.activeStreams.set(streamKey, {
            process: ffmpegProcess,
            pid: ffmpegProcess.pid,
            startTime: Date.now(),
            config
        });

        return {
            pid: ffmpegProcess.pid,
            streamKey,
            rtmpUrl
        };
    }

    stopStream(streamKey) {
        const stream = this.activeStreams.get(streamKey);

        if (!stream) {
            throw new Error(`Stream ${streamKey} not found`);
        }

        console.log(`⏹️ Stopping stream: ${streamKey} (PID: ${stream.pid})`);

        stream.process.kill('SIGTERM');

        // Force kill after 5 seconds
        setTimeout(() => {
            if (this.activeStreams.has(streamKey)) {
                console.log(`⚠️ Force killing stream: ${streamKey}`);
                stream.process.kill('SIGKILL');
                this.activeStreams.delete(streamKey);
            }
        }, 5000);

        return true;
    }

    getStreamStatus(streamKey) {
        const stream = this.activeStreams.get(streamKey);

        if (!stream) {
            return { running: false };
        }

        return {
            running: true,
            pid: stream.pid,
            uptime: Date.now() - stream.startTime,
            config: stream.config
        };
    }

    getAllStreams() {
        const streams = [];

        for (const [key, stream] of this.activeStreams) {
            streams.push({
                streamKey: key,
                pid: stream.pid,
                uptime: Date.now() - stream.startTime,
                rtmpUrl: stream.config.rtmpUrl
            });
        }

        return streams;
    }

    stopAllStreams() {
        console.log(`⏹️ Stopping all streams (${this.activeStreams.size})`);

        for (const streamKey of this.activeStreams.keys()) {
            try {
                this.stopStream(streamKey);
            } catch (err) {
                console.error(`Error stopping ${streamKey}:`, err.message);
            }
        }
    }

    isStreamRunning(streamKey) {
        return this.activeStreams.has(streamKey);
    }
}

module.exports = FFmpegManager;