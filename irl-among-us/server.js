const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { transports: ['websocket', 'polling'] });

app.use(express.static(path.join(__dirname, 'public')));

const games = {};

function generateRoomCode() { return Math.floor(100000 + Math.random() * 900000).toString(); }

io.on('connection', (socket) => {
    socket.on('createRoom', ({ username }) => {
        let room = generateRoomCode();
        while (games[room]) room = generateRoomCode();
        games[room] = { host: socket.id, state: 'lobby', players: [], settings: { imps: 1, docs: 1, sheriffs: 1, jailors: 1 }, votes: {}, shieldedPlayerId: null, protectedHistory: [], jailedPlayerId: null, jailorCanJail: true, jailorKillsLeft: 2 };
        games[room].players.push({ id: socket.id, username, role: 'crewmate', status: 'alive', meetingsLeft: 1 });
        socket.join(room);
        socket.emit('roomCreated', { room });
        io.to(room).emit('updateLobby', { players: games[room].players, hostId: socket.id });
    });

    socket.on('joinLobby', ({ username, room }) => {
        if (!games[room]) return socket.emit('joinError', 'Invalid Room Code.');
        if (games[room].state !== 'lobby') return socket.emit('joinError', 'Game already started.');
        socket.join(room);
        games[room].players.push({ id: socket.id, username, role: 'crewmate', status: 'alive', meetingsLeft: 1 });
        io.to(room).emit('updateLobby', { players: games[room].players, hostId: games[room].host });
    });

    socket.on('startGame', (room) => {
        const game = games[room];
        game.state = 'playing';
        let pool = [...game.players];
        const assign = (r, c) => { for(let i=0; i<c; i++) { let idx = Math.floor(Math.random()*pool.length); pool[idx].role = r; pool.splice(idx, 1); } };
        assign('imposter', game.settings.imps); assign('doctor', game.settings.docs); assign('sheriff', game.settings.sheriffs); assign('jailor', game.settings.jailors);
        game.players.forEach(p => io.to(p.id).emit('gameStarted', { role: p.role, players: game.players }));
    });

    socket.on('actionKill', ({ room, targetId, isSheriff }) => {
        const game = games[room];
        const target = game.players.find(p => p.id === targetId);
        if (game.shieldedPlayerId === targetId && !isSheriff) { game.shieldedPlayerId = null; return; }
        target.status = 'dead';
        io.to(room).emit('updateGame', game.players);
    });

    // Add your remaining meeting/voting logic from the previous step here
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));