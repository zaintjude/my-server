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

// Health check for Render deployment
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// =====================
// WEBSOCKET SERVER
// =====================
const wss = new WebSocket.Server({ 
    server,
    path: '/' 
});

// Track active users: { "username": ws_connection }
let clients = {};

wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.username = null;

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

        // 1. REGISTER USER & BROADCAST LIST
        if (data.type === 'register') {
            if (!data.username) return;
            
            ws.username = data.username;
            clients[data.username] = ws;
            
            console.log(`✅ User registered: ${data.username}`);
            
            // Send the full list of online users to EVERYONE
            // This ensures the "Messenger" sidebar stays updated
            broadcastUserList();
            return;
        }

        // 2. PRIVATE MESSAGING & WEBRTC SIGNALING
        // We route messages only to the specific target
        if (data.type === 'message' || ['offer', 'answer', 'candidate'].includes(data.type)) {
            const target = data.target;
            if (target && clients[target] && clients[target].readyState === WebSocket.OPEN) {
                clients[target].send(JSON.stringify(data));
            } else {
                console.log(`⚠️ Target ${target} is offline.`);
            }
        }
    });

    // 3. CLEANUP ON DISCONNECT
    ws.on('close', () => {
        if (ws.username) {
            console.log(`🔴 User disconnected: ${ws.username}`);
            delete clients[ws.username];
            
            // Update the sidebar for everyone else
            broadcastUserList();
        }
    });

    ws.on('error', (err) => {
        console.error(`WebSocket Error:`, err);
    });
});

// =====================
// HELPER FUNCTIONS
// =====================

/**
 * Sends the current list of online usernames to all connected clients
 */
function broadcastUserList() {
    const userListPayload = JSON.stringify({
        type: 'user_list',
        users: Object.keys(clients)
    });

    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(userListPayload);
        }
    });
}

/**
 * Heartbeat System: Check every 30s if clients are still responsive
 */
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

wss.on('close', () => {
    clearInterval(interval);
});

// =====================
// START SERVER
// =====================
const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
    console.log(`
    🚀 PrimeChat Messenger Server Running
    ---------------------------
    Port: ${PORT}
    Static Path: ${path.join(__dirname, '../public')}
    `);
});
