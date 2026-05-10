const { spawn } = require('child_process');

console.log('Starting SPEDI Platform: Next.js Frontend + Fastify Backend');

// Start Fastify backend
const backend = spawn('node', ['dist/server.js'], { stdio: 'inherit', env: { ...process.env, PORT: process.env.BACKEND_PORT || '3001' } });

// Start Next.js standalone server
const frontend = spawn('node', ['server.js'], { stdio: 'inherit', env: { ...process.env, PORT: process.env.PORT || '3000', HOSTNAME: '0.0.0.0' } });

const cleanup = () => {
    backend.kill();
    frontend.kill();
    process.exit();
};

process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);
