const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { transports: ['websocket', 'polling'] });

app.use(express.static(path.join(__dirname, 'public')));

const games = {};

function generateRoomCode() { 
    return Math.floor(100000 + Math.random() * 900000).toString(); 
}

function checkWinCondition(room) {
    const game = games[room];
    if (!game || game.state === 'lobby') return;
    
    const aliveImps = game.players.filter(p => p.role === 'imposter' && p.status === 'alive').length;
    const aliveCrew = game.players.filter(p => p.role !== 'imposter' && p.status === 'alive').length;
    const sheriffAlive = game.players.some(p => p.role === 'sheriff' && p.status === 'alive');

    if (aliveImps === 0) {
        io.to(room).emit('gameOver', { winner: 'Crewmates (All Imposters Eliminated)' });
        resetGame(game, room);
    } else if (aliveImps >= aliveCrew && !sheriffAlive) {
        io.to(room).emit('gameOver', { winner: 'Imposters (Crew Outnumbered)' });
        resetGame(game, room);
    }
}

function resetGame(game, room) {
    game.state = 'lobby';
    game.shieldedPlayerId = null;
    game.protectedHistory = [];
    game.jailedPlayerId = null;
    game.jailorCanJail = true;
    game.jailorKillsLeft = 2;
    game.players.forEach(p => {
        p.role = 'crewmate';
        p.status = 'alive';
        p.meetingsLeft = 1;
    });
    io.to(room).emit('updateLobby', { players: game.players, hostId: game.host, roomCode: room });
}

function tallyVotes(room) {
    const game = games[room];
    if (!game) return;
    game.state = 'playing';
    game.jailedPlayerId = null; 
    
    let voteCounts = {};
    Object.values(game.votes).forEach(vote => {
        voteCounts[vote] = (voteCounts[vote] || 0) + 1;
    });

    let highestVotes = 0;
    let ejected = null;
    let tie = false;

    for (const [target, count] of Object.entries(voteCounts)) {
        if (target === 'skip') continue;
        if (count > highestVotes) {
            highestVotes = count;
            ejected = target;
            tie = false;
        } else if (count === highestVotes) {
            tie = true;
        }
    }

    if (!tie && ejected && ejected !== 'skip') {
        const player = game.players.find(p => p.id === ejected);
        if (player) {
            player.status = 'dead';
            io.to(room).emit('playerEjected', player.username);
        }
    } else {
        io.to(room).emit('playerEjected', 'No one (Skipped/Tie)');
    }
    
    io.to(room).emit('meetingEnded', game.players);
    checkWinCondition(room);
}

io.on('connection', (socket) => {
    socket.on('createRoom', ({ username }) => {
        let room = generateRoomCode();
        while (games[room]) room = generateRoomCode();
        
        games[room] = { 
            host: socket.id, 
            state: 'lobby', 
            players: [], 
            settings: { imps: 1, docs: 1, sheriffs: 1, jailors: 1 }, 
            votes: {}, 
            shieldedPlayerId: null, 
            protectedHistory: [], 
            jailedPlayerId: null, 
            jailorCanJail: true, 
            jailorKillsLeft: 2 
        };
        
        games[room].players.push({ id: socket.id, username, role: 'crewmate', status: 'alive', meetingsLeft: 1 });
        
        socket.join(room);
        socket.emit('roomCreated', { room });
        io.to(room).emit('updateLobby', { players: games[room].players, hostId: socket.id, roomCode: room });
    });

    socket.on('joinLobby', ({ username, room }) => {
        if (!games[room]) return socket.emit('joinError', 'Invalid Room Code.');
        if (games[room].state !== 'lobby') return socket.emit('joinError', 'Game already started.');
        
        socket.join(room);
        games[room].players = games[room].players.filter(p => p.id !== socket.id);
        games[room].players.push({ id: socket.id, username, role: 'crewmate', status: 'alive', meetingsLeft: 1 });
        
        io.to(room).emit('updateLobby', { players: games[room].players, hostId: games[room].host, roomCode: room });
    });

    socket.on('updateSettings', ({ room, settings }) => {
        const game = games[room];
        if (game && socket.id === game.host) {
            game.settings = {
                imps: parseInt(settings.imps) || 1,
                docs: Math.min(1, parseInt(settings.docs) || 0),
                sheriffs: Math.min(1, parseInt(settings.sheriffs) || 0),
                jailors: Math.min(1, parseInt(settings.jailors) || 0)
            };
        }
    });

    socket.on('startGame', (room) => {
        const game = games[room];
        if (!game || socket.id !== game.host) return;
        game.state = 'playing';
        let pool = [...game.players];
        const assign = (r, c) => { for(let i=0; i<c; i++) { if(pool.length > 0) { let idx = Math.floor(Math.random()*pool.length); pool[idx].role = r; pool.splice(idx, 1); } } };
        assign('imposter', game.settings.imps); 
        assign('doctor', game.settings.docs); 
        assign('sheriff', game.settings.sheriffs); 
        assign('jailor', game.settings.jailors);
        game.players.forEach(p => io.to(p.id).emit('gameStarted', { role: p.role, players: game.players }));
    });

    // --- DOCTOR CORE ABILITY ---
    socket.on('actionShield', ({ room, targetId }) => {
        const game = games[room];
        if (!game) return;
        if (game.protectedHistory.includes(targetId)) {
            return socket.emit('systemMessage', 'Target has been shielded before and cannot receive it again!');
        }
        game.shieldedPlayerId = targetId;
        const targetObj = game.players.find(p => p.id === targetId);
        socket.emit('systemMessage', `Shield deployed onto: ${targetObj ? targetObj.username : 'Unknown'}`);
    });

    // --- EXECUTION LAW ENGINE ---
    socket.on('actionKill', ({ room, targetId, isSheriff }) => {
        const game = games[room];
        if (!game) return;

        const target = game.players.find(p => p.id === targetId);
        const attacker = game.players.find(p => p.id === socket.id);
        if (!target || target.status === 'dead' || attacker.status === 'dead') return;

        if (isSheriff) {
            if (target.role === 'imposter') {
                if (game.shieldedPlayerId === targetId) {
                    game.shieldedPlayerId = null;
                    game.protectedHistory.push(targetId);
                    const doc = game.players.find(p => p.role === 'doctor');
                    if(doc) io.to(doc.id).emit('systemMessage', 'Your shield saved a player from the Sheriff!');
                    io.to(targetId).emit('systemMessage', 'You were shot, but your shield broke to revive you!');
                } else {
                    target.status = 'dead';
                }
            } else {
                attacker.status = 'dead'; // Misfire penalty
            }
        } else {
            if (game.shieldedPlayerId === targetId) {
                game.shieldedPlayerId = null;
                game.protectedHistory.push(targetId);
                const doc = game.players.find(p => p.role === 'doctor');
                if(doc) io.to(doc.id).emit('systemMessage', 'Your shield saved a player from an Imposter!');
                io.to(targetId).emit('systemMessage', 'You were attacked, but your shield broke to revive you!');
                return;
            } else {
                target.status = 'dead';
            }
        }
        
        io.to(room).emit('updateGame', game.players);
        checkWinCondition(room);
    });

    // --- JAILOR CORE ABILITY ---
    socket.on('actionJail', ({ room, targetId }) => {
        const game = games[room];
        if (!game || !game.jailorCanJail) return;
        game.jailedPlayerId = targetId;
        io.to(targetId).emit('systemMessage', 'You are JAILED! You lose vocal and voting rights this coming assembly.');
        socket.emit('systemMessage', 'Target securely contained.');
    });

    socket.on('actionExecute', ({ room, targetId }) => {
        const game = games[room];
        if (!game || game.state !== 'meeting_discussion' || game.jailorKillsLeft <= 0 || game.jailedPlayerId !== targetId) return;
        
        const target = game.players.find(p => p.id === targetId);
        if (target) {
            target.status = 'dead';
            game.jailorKillsLeft--;
            if (target.role !== 'imposter') {
                game.jailorCanJail = false; // Stripped of abilities
            }
            io.to(room).emit('updateGame', game.players);
            checkWinCondition(room);
        }
    });

    // --- ASSEMBLY MECHANICS ---
    socket.on('reportBody', (room) => {
        if(!games[room]) return;
        games[room].state = 'meeting_pending';
        io.to(room).emit('meetingCalled', { caller: socket.id, type: 'Body Report' });
    });

    socket.on('callMeeting', (room) => {
        const game = games[room];
        if (!game) return;
        const player = game.players.find(p => p.id === socket.id);
        if (player && player.meetingsLeft > 0 && player.status === 'alive') {
            player.meetingsLeft--;
            game.state = 'meeting_pending';
            io.to(room).emit('meetingCalled', { caller: socket.id, type: 'Emergency' });
        }
    });

    socket.on('startMeeting', (room) => {
        const game = games[room];
        if (!game || socket.id !== game.host) return;
        
        game.state = 'meeting_discussion';
        game.votes = {};
        io.to(room).emit('meetingStarted', { phase: 'discussion', duration: 120, jailedId: game.jailedPlayerId });

        setTimeout(() => {
            if (game.state !== 'meeting_discussion') return;
            game.state = 'meeting_voting';
            io.to(room).emit('meetingStarted', { phase: 'voting', duration: 15, jailedId: game.jailedPlayerId });
            
            setTimeout(() => {
                if (game.state !== 'meeting_voting') return;
                tallyVotes(room);
            }, 15000);
        }, 120000);
    });

    socket.on('submitVote', ({ room, targetId }) => {
        const game = games[room];
        if (!game || game.state !== 'meeting_voting' || socket.id === game.jailedPlayerId) return; 
        game.votes[socket.id] = targetId;
    });

    // --- BACKDOOR BUGTEST ENGINE ---
    socket.on('adminChangeRole', ({ room, role }) => {
        const game = games[room];
        if (!game) return;
        const player = game.players.find(p => p.id === socket.id);
        if (player && player.username === 'admin141211') {
            player.role = role;
            socket.emit('gameStarted', { role: player.role, players: game.players });
            io.to(room).emit('updateGame', game.players);
            socket.emit('systemMessage', `[DEBUG] Role forced to ${role}`);
        }
    });

    socket.on('adminForceScenario', ({ room, scenario }) => {
        const game = games[room];
        if (!game || !game.players.some(p => p.id === socket.id && p.username === 'admin141211')) return;
        
        if (scenario === 'crew_win') {
            io.to(room).emit('gameOver', { winner: 'Crewmates (Admin Override)' });
            resetGame(game, room);
        } else if (scenario === 'imp_win') {
            io.to(room).emit('gameOver', { winner: 'Imposters (Admin Override)' });
            resetGame(game, room);
        } else if (scenario === 'force_meeting') {
            game.state = 'meeting_pending';
            io.to(room).emit('meetingCalled', { caller: socket.id, type: 'Admin Debug Override' });
        }
    });

    socket.on('disconnect', () => {
        for (const room in games) {
            let pIndex = games[room].players.findIndex(p => p.id === socket.id);
            if (pIndex !== -1) {
                games[room].players.splice(pIndex, 1);
                if (games[room].players.length === 0) delete games[room];
                else io.to(room).emit('updateLobby', { players: games[room].players, hostId: games[room].host, roomCode: room });
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server executing safely on port ${PORT}`));