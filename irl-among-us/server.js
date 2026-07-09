const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" },
    transports: ['websocket', 'polling']
});

app.use(express.static(path.join(__dirname, 'public')));

const games = {};

function checkWinCondition(room) {
    const game = games[room];
    if (!game) return;
    
    const aliveImps = game.players.filter(p => p.role === 'imposter' && p.status === 'alive').length;
    const aliveCrew = game.players.filter(p => p.role !== 'imposter' && p.status === 'alive').length;
    const sheriffAlive = game.players.some(p => p.role === 'sheriff' && p.status === 'alive');

    if (aliveImps === 0) {
        io.to(room).emit('gameOver', { winner: 'Crewmates' });
        resetGame(game);
    } else if (aliveImps >= aliveCrew && !sheriffAlive) {
        io.to(room).emit('gameOver', { winner: 'Imposters' });
        resetGame(game);
    }
}

function resetGame(game) {
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
}

io.on('connection', (socket) => {
    socket.on('joinLobby', ({ username, room }) => {
        const roomCode = room.trim().toUpperCase();
        socket.join(roomCode);
        
        if (!games[roomCode]) {
            games[roomCode] = {
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
        }
        
        // Remove existing session if same socket reconnected
        games[roomCode].players = games[roomCode].players.filter(p => p.id !== socket.id);
        
        games[roomCode].players.push({
            id: socket.id,
            username: username || `Player-${socket.id.slice(0,4)}`,
            role: 'crewmate',
            status: 'alive',
            meetingsLeft: 1
        });
        
        io.to(roomCode).emit('updateLobby', {
            players: games[roomCode].players,
            hostId: games[roomCode].host
        });
    });

    socket.on('updateSettings', ({ room, settings }) => {
        const game = games[room.toUpperCase()];
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
        const roomCode = room.toUpperCase();
        const game = games[roomCode];
        if (!game || socket.id !== game.host || game.state !== 'lobby') return;

        game.state = 'playing';
        let pool = [...game.players];
        
        const assignRole = (role, count) => {
            for(let i = 0; i < count; i++) {
                if(pool.length === 0) return;
                let idx = Math.floor(Math.random() * pool.length);
                pool[idx].role = role;
                pool.splice(idx, 1);
            }
        };
        
        assignRole('imposter', game.settings.imps);
        assignRole('doctor', game.settings.docs);
        assignRole('sheriff', game.settings.sheriffs);
        assignRole('jailor', game.settings.jailors);

        game.players.forEach(p => {
            io.to(p.id).emit('gameStarted', { role: p.role, players: game.players });
        });
    });

    socket.on('actionShield', ({ room, targetId }) => {
        const game = games[room.toUpperCase()];
        if (!game || game.protectedHistory.includes(targetId)) return;
        game.shieldedPlayerId = targetId;
        io.to(socket.id).emit('systemMessage', 'Shield assigned to target.');
    });

    socket.on('actionKill', ({ room, targetId, isSheriff }) => {
        const roomCode = room.toUpperCase();
        const game = games[roomCode];
        if (!game) return;

        const target = game.players.find(p => p.id === targetId);
        const attacker = game.players.find(p => p.id === socket.id);

        if (!target || target.status === 'dead' || attacker.status === 'dead') return;

        if (isSheriff) {
            if (target.role === 'imposter') {
                target.status = 'dead';
                if (game.shieldedPlayerId === targetId) {
                    target.status = 'alive'; // Revive immediately if shot while shielded
                    game.shieldedPlayerId = null;
                    game.protectedHistory.push(targetId);
                    const doc = game.players.find(p => p.role === 'doctor');
                    if(doc) io.to(doc.id).emit('systemMessage', 'Your shielded target was attacked but survived!');
                    io.to(targetId).emit('systemMessage', 'You were targeted but your shield saved you!');
                }
            } else {
                attacker.status = 'dead';
            }
        } else {
            if (game.shieldedPlayerId === targetId) {
                game.shieldedPlayerId = null;
                game.protectedHistory.push(targetId);
                const doctor = game.players.find(p => p.role === 'doctor');
                if(doctor) io.to(doctor.id).emit('systemMessage', 'Your shielded target was attacked but survived!');
                io.to(targetId).emit('systemMessage', 'You were attacked but your shield saved you!');
                return;
            } else {
                target.status = 'dead';
            }
        }
        
        io.to(roomCode).emit('updateGame', game.players);
        checkWinCondition(roomCode);
    });

    socket.on('actionJail', ({ room, targetId }) => {
        const game = games[room.toUpperCase()];
        if (!game || !game.jailorCanJail) return;
        game.jailedPlayerId = targetId;
        io.to(targetId).emit('systemMessage', 'You are JAILED! You cannot speak or vote next meeting.');
    });

    socket.on('actionExecute', ({ room, targetId }) => {
        const roomCode = room.toUpperCase();
        const game = games[roomCode];
        if (!game || game.state !== 'meeting_discussion' || game.jailorKillsLeft <= 0) return;
        
        const target = game.players.find(p => p.id === targetId);
        if (target && targetId === game.jailedPlayerId) {
            target.status = 'dead';
            game.jailorKillsLeft--;
            if (target.role !== 'imposter') {
                game.jailorCanJail = false;
            }
            io.to(roomCode).emit('updateGame', game.players);
            checkWinCondition(roomCode);
        }
    });

    socket.on('reportBody', (room) => {
        const roomCode = room.toUpperCase();
        if(!games[roomCode]) return;
        games[roomCode].state = 'meeting_pending';
        io.to(roomCode).emit('meetingCalled', { caller: socket.id, type: 'Body Report' });
    });

    socket.on('callMeeting', (room) => {
        const roomCode = room.toUpperCase();
        const game = games[roomCode];
        if (!game) return;
        const player = game.players.find(p => p.id === socket.id);
        if (player && player.meetingsLeft > 0 && player.status === 'alive') {
            player.meetingsLeft--;
            game.state = 'meeting_pending';
            io.to(roomCode).emit('meetingCalled', { caller: socket.id, type: 'Emergency' });
        }
    });

    socket.on('startMeeting', (room) => {
        const roomCode = room.toUpperCase();
        const game = games[roomCode];
        if (!game || socket.id !== game.host) return;
        
        game.state = 'meeting_discussion';
        game.votes = {};
        io.to(roomCode).emit('meetingStarted', { phase: 'discussion', duration: 120 });

        setTimeout(() => {
            if (game.state !== 'meeting_discussion') return;
            game.state = 'meeting_voting';
            io.to(roomCode).emit('meetingStarted', { phase: 'voting', duration: 15 });
            
            setTimeout(() => {
                if (game.state !== 'meeting_voting') return;
                tallyVotes(roomCode);
            }, 15000);
        }, 120000);
    });

    socket.on('submitVote', ({ room, targetId }) => {
        const roomCode = room.toUpperCase();
        const game = games[roomCode];
        if (!game || game.state !== 'meeting_voting') return;
        if (socket.id === game.jailedPlayerId) return; 
        
        game.votes[socket.id] = targetId;
    });

    function tallyVotes(room) {
        const game = games[room];
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

    socket.on('disconnect', () => {
        for (const room in games) {
            let game = games[room];
            let pIndex = game.players.findIndex(p => p.id === socket.id);
            if (pIndex !== -1) {
                game.players.splice(pIndex, 1);
                if (game.players.length === 0) {
                    delete games[room];
                } else {
                    if (game.host === socket.id) {
                        game.host = game.players[0].id;
                    }
                    io.to(room).emit('updateLobby', { players: game.players, hostId: game.host });
                }
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server executing safely on port ${PORT}`);
});