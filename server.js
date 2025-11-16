const { PeerServer } = require('peer');
const express = require('express');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const PORT = 9000;

// Serve static files from current directory
app.use(express.static(__dirname));

// Explicit route for index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/index.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Create PeerServer
const peerServer = PeerServer({
    port: PORT,
    path: '/peerjs',
    proxied: true,
    ssl: false,
    debug: 1
});

peerServer.on('connection', (client) => {
    console.log(`✅ Client connected: ${client.getId()}`);
});

peerServer.on('disconnect', (client) => {
    console.log(`❌ Client disconnected: ${client.getId()}`);
});

console.log('\n🚀 PeerServer running on ws://localhost:' + PORT + '/peerjs');
console.log('📁 Static files served on http://localhost:' + PORT);
console.log('✅ Open http://localhost:' + PORT + '/index.html in your browser\n');

// Start server
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🟢 Server listening on http://localhost:${PORT}`);
    console.log(`   Press Ctrl+C to stop\n`);
}).on('error', (err) => {
    console.error('❌ Server error:', err);
    if (err.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use. Try killing the process or using a different port.`);
    }
});
