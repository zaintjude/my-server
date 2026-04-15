const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);

// =====================
// FRONTEND ROUTING
// =====================
app.use(express.static(path.join(__dirname, '../public')));

// Health check - IMPORTANT: Render uses this to see if your app is alive
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// =====================
// WEBSOCKET SERVER
// =====================
const wss = new WebSocket.Server({ 
    server,
    // Add path to ensure the handshake is specific
    path: '/' 
});

let clients = {};

wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.username = null;

    // Log the incoming connection for debugging in Render logs
    console.log(`📡 New connection attempt from: ${req.socket.remoteAddress}`);

    ws.on('pong', () => {
        ws.isAlive = true;
    });

    ws.on('message', (msg) => {
        let data;
        try {
            data = JSON.parse(msg);
        } catch (err) {
            console.error("Invalid JSON:", msg);
            return;
        }

        if (data.type === 'register') {
            if (!data.username) return;
            ws.username = data.username;
            clients[data.username] = ws;
            console.log(`✅ User registered: ${data.username}`);
            
            broadcast({
                type: 'user_status',
                username: data.username,
                status: 'online'
            });
            return;
        }

        // Handle private messages and signaling
        if (data.type === 'message' || ['offer', 'answer', 'candidate'].includes(data.type)) {
            const target = data.target;
            if (target && clients[target] && clients[target].readyState === WebSocket.OPEN) {
                clients[target].send(JSON.stringify(data));
            }
        }
    });

    ws.on('close', () => {
        if (ws.username) {
            console.log(`🔴 User disconnected: ${ws.username}`);
            delete clients[ws.username];
            broadcast({
                type: 'user_status',
                username: ws.username,
                status: 'offline'
            });
        }
    });
});

function broadcast(data) {
    const msg = JSON.stringify(data);
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(msg);
        }
    });
}

// Heartbeat system (30s check)
const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            if (ws.username) delete clients[ws.username];
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

// =====================
// START SERVER
// =====================
// Render uses process.env.PORT. 0.0.0.0 is critical for Render to route traffic!
const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
    console.log(`
    🚀 PrimeChat Server Running
    ---------------------------
    Port: ${PORT}
    Environment: ${process.env.NODE_ENV || 'development'}
    `);
});
