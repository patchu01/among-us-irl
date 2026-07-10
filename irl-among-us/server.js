const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('createRoom', (data) => {
        const roomCode = Math.floor(100000 + Math.random() * 900000).toString();
        rooms[roomCode] = {
            hostId: socket.id,
            players: [],
            state: 'lobby',
            votes: {},
            timer: null,
            tasksCompleted: 0,
            tasksRequired: 0,
            tasksPerPlayer: 3,
            // FIX: Defaults now strictly match the client-side UI to prevent unselected roles
            roleConfig: { imposters: 1, doctors: 0, sheriffs: 0, jailors: 0, jesters: 0 }
        };
        
        joinPlayerToRoom(socket, data.username, data.uuid, roomCode);
        socket.emit('roomCreated', { room: roomCode });
    });

    socket.on('joinLobby', (data) => {
        const room = rooms[data.room];
        if (!room) return socket.emit('joinError', 'Room not found.');
        if (room.state !== 'lobby' && room.state !== 'game_over') return socket.emit('joinError', 'Game already in progress.');
        
        joinPlayerToRoom(socket, data.username, data.uuid, data.room);
    });

    socket.on('updateRoleConfig', (data) => {
        const room = rooms[data.room];
        if (!room || room.hostId !== socket.id || room.state !== 'lobby') return;
        
        room.roleConfig = {
            imposters: parseInt(data.config.imposters) || 1,
            doctors: Math.min(parseInt(data.config.doctors) || 0, 1),
            sheriffs: Math.min(parseInt(data.config.sheriffs) || 0, 1),
            jailors: Math.min(parseInt(data.config.jailors) || 0, 1),
            jesters: Math.min(parseInt(data.config.jesters) || 0, 1)
        };
        
        io.to(data.room).emit('roleConfigUpdated', room.roleConfig);
    });

    socket.on('startGame', (roomCode) => {
        const room = rooms[roomCode];
        if (!room || room.hostId !== socket.id) return;

        room.state = 'running';
        room.tasksCompleted = 0;
        const players = room.players;
        
        // FIX: Prioritize imposters first, then fill optional roles, strictly enforcing counts
        let configuredRoles = [];
        for (let i = 0; i < room.roleConfig.imposters; i++) configuredRoles.push('imposter');
        
        let optionalRoles = [];
        for (let i = 0; i < room.roleConfig.doctors; i++) optionalRoles.push('doctor');
        for (let i = 0; i < room.roleConfig.sheriffs; i++) optionalRoles.push('sheriff');
        for (let i = 0; i < room.roleConfig.jailors; i++) optionalRoles.push('jailor');        for (let i = 0; i < room.roleConfig.jesters; i++) optionalRoles.push('jester');
        // Shuffle optional roles so they compete fairly if player count is lower than config
        optionalRoles.sort(() => Math.random() - 0.5);
        configuredRoles = configuredRoles.concat(optionalRoles);

        let rolePool = [];
        for (let i = 0; i < Math.min(configuredRoles.length, players.length); i++) {
            rolePool.push(configuredRoles[i]);
        }

        // Fill remaining slots with crewmates
        while (rolePool.length < players.length) {
            rolePool.push('crewmate');
        }

        // Final shuffle layout assignment
        rolePool.sort(() => Math.random() - 0.5);

        const totalCrews = room.players.length - room.players.filter(p => p.role === 'imposter').length;

        players.forEach((p, idx) => {
            p.role = rolePool[idx];
            p.status = 'alive';
            p.meetingsLeft = 1;
            p.jailorUses = (p.role === 'jailor') ? 2 : 0;
            p.jailedBy = null;
            p.tasksCompleted = 0;
            p.tasksRequired = (p.role === 'imposter' || p.role === 'jester') ? 0 : room.tasksPerPlayer;
            io.to(p.id).emit('gameStarted', { role: p.role, players, tasksRequired: p.tasksRequired });
        });

        io.to(roomCode).emit('updateGame', players);
        io.to(roomCode).emit('tasksUpdated', { players: room.players });
        
        checkWinConditions(roomCode);
    });

    socket.on('updateTasksPerPlayer', (data) => {
        const room = rooms[data.room];
        if (!room || room.hostId !== socket.id || room.state !== 'lobby') return;
        room.tasksPerPlayer = Math.max(1, parseInt(data.tasks) || 3);
    });

    socket.on('logTask', (roomCode) => {
        const room = rooms[roomCode];
        if (!room || room.state !== 'running') return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player || player.role === 'imposter' || player.status === 'dead') return;

        if (player.tasksCompleted < player.tasksRequired) {
            player.tasksCompleted += 1;
        }
        io.to(roomCode).emit('tasksUpdated', { players: room.players });

        checkWinConditions(roomCode);
    });

    socket.on('callMeeting', (roomCode) => {
        const room = rooms[roomCode];
        if (!room || room.state !== 'running') return;

        const caller = room.players.find(p => p.id === socket.id);
        if (!caller || caller.status === 'dead' || caller.meetingsLeft <= 0) return;

        caller.meetingsLeft--;
        triggerAssembly(roomCode, 'Emergency Meeting', socket.id);
    });

    socket.on('reportBody', (roomCode) => {
        const room = rooms[roomCode];
        if (!room || room.state !== 'running') return;

        const reporter = room.players.find(p => p.id === socket.id);
        if (!reporter || reporter.status === 'dead') return;

        triggerAssembly(roomCode, 'Body Report', socket.id);
    });

    socket.on('startMeeting', (roomCode) => {
        const room = rooms[roomCode];
        if (!room || room.hostId !== socket.id || room.state !== 'meeting_gather') return;

        room.state = 'meeting_discuss';
        room.votes = {};
        
        let duration = 60;
        io.to(roomCode).emit('meetingStarted', { phase: 'discussion', duration });

        clearInterval(room.timer);
        room.timer = setInterval(() => {
            duration--;
            if (duration <= 0) {
                clearInterval(room.timer);
                evaluateVotes(roomCode);
            }
        }, 1000);
    });

    socket.on('submitVote', (data) => {
        const room = rooms[data.room];
        if (!room || room.state !== 'meeting_discuss') return; 

        const voter = room.players.find(p => p.id === socket.id);
        if (!voter || voter.status === 'dead') return;

        room.votes[socket.id] = data.targetId;
        io.to(data.room).emit('voteCastFeedback', { voterId: socket.id });

        const alivePlayers = room.players.filter(p => p.status === 'alive');
        const totalVotesCast = Object.keys(room.votes).length;

        if (totalVotesCast >= alivePlayers.length) {
            clearInterval(room.timer);
            evaluateVotes(data.room);
        }
    });

    socket.on('actionKill', (data) => {
        const room = rooms[data.room];
        if (!room || room.state !== 'running') return;
        const target = room.players.find(p => p.id === data.targetId);
        if (target && target.status === 'alive') {
            target.status = 'dead';
            target.tasksCompleted = target.tasksRequired;
            io.to(data.room).emit('updateGame', room.players);
            checkWinConditions(data.room);
        }
    });

    socket.on('actionSheriffKill', (data) => {
        const room = rooms[data.room];
        if (!room || room.state !== 'running') return;
        
        const sheriff = room.players.find(p => p.id === socket.id);
        const target = room.players.find(p => p.id === data.targetId);
        
        if (sheriff && target && sheriff.status === 'alive' && target.status === 'alive') {
            if (target.role === 'imposter') {
                target.status = 'dead';
            } else {
                if (target.role !== 'jester') {
                    sheriff.status = 'dead';
                    sheriff.tasksCompleted = sheriff.tasksRequired;
                }
                target.status = 'dead';
                target.tasksCompleted = target.tasksRequired;
            }
            io.to(data.room).emit('updateGame', room.players);
            checkWinConditions(data.room);
        }
    });

    socket.on('actionJail', (data) => {
        const room = rooms[data.room];
        if (!room || room.state !== 'running') return;
        
        const jailor = room.players.find(p => p.id === socket.id);
        const target = room.players.find(p => p.id === data.targetId);
        
        if (jailor && target && jailor.role === 'jailor' && jailor.status === 'alive' && target.status === 'alive' && jailor.jailorUses > 0) {
            target.jailedBy = jailor.id;
            jailor.jailorUses--;
            io.to(target.id).emit('playerJailed');
            io.to(data.room).emit('updateGame', room.players);
        }
    });

    socket.on('actionExecute', (data) => {
        const room = rooms[data.room];
        if (!room) return;
        
        const jailor = room.players.find(p => p.id === socket.id);
        const target = room.players.find(p => p.id === data.targetId);
        
        if (jailor && target && jailor.role === 'jailor' && jailor.status === 'alive' && target.jailedBy === jailor.id) {
            target.status = 'dead';
            target.tasksCompleted = target.tasksRequired;
            if (target.role !== 'imposter' && target.role !== 'jester') {
                jailor.jailorUses = 0;
            }
            target.jailedBy = null;
            if (room.state === 'meeting_discuss') {
                room.votes = {};
                io.to(data.room).emit('votesReset');
            }
            io.to(data.room).emit('updateGame', room.players);
            if (room.state === 'running' || room.state === 'meeting_discuss') {
                checkWinConditions(data.room);
            }
        }
    });

    socket.on('returnToLobby', (roomCode) => {
        const room = rooms[roomCode];
        if (!room || room.hostId !== socket.id) return;
        
        room.state = 'lobby';
        room.players.forEach(p => { p.status = 'alive'; p.role = 'crewmate'; p.jailedBy = null; p.jailorUses = 0; });
        io.to(roomCode).emit('updateLobby', { roomCode, hostId: room.hostId, players: room.players, config: room.roleConfig });
    });

    socket.on('disconnect', () => {
        for (const code in rooms) {
            rooms[code].players = rooms[code].players.filter(p => p.id !== socket.id);
            if (rooms[code].players.length === 0) {
                clearInterval(rooms[code].timer);
                delete rooms[code];
            } else {
                io.to(code).emit('updateLobby', { roomCode: code, hostId: rooms[code].hostId, players: rooms[code].players });
                checkWinConditions(code);
            }
        }
    });
});

function joinPlayerToRoom(socket, username, uuid, roomCode) {
    const room = rooms[roomCode];
    const newPlayer = { id: socket.id, username, uuid, status: 'alive', role: 'crewmate', meetingsLeft: 1 };
    room.players.push(newPlayer);
    socket.join(roomCode);
    
    io.to(roomCode).emit('updateLobby', { roomCode, hostId: room.hostId, players: room.players, config: room.roleConfig });
}

function triggerAssembly(roomCode, type, callerId) {
    const room = rooms[roomCode];
    room.state = 'meeting_gather';
    io.to(roomCode).emit('meetingCalled', { type, caller: callerId });
}

function evaluateVotes(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    const tally = { 'skip': 0 };
    Object.values(room.votes).forEach(target => {
        tally[target] = (tally[target] || 0) + 1;
    });

    let ejected = 'skip';
    let maxVotes = tally['skip'];
    let tie = false;

    for (const id in tally) {
        if (id === 'skip') continue;
        if (tally[id] > maxVotes) {
            maxVotes = tally[id];
            ejected = id;
            tie = false;
        } else if (tally[id] === maxVotes) {
            tie = true;
        }
    }

    if (tie || ejected === 'skip') {
        io.to(roomCode).emit('playerEjected', 'Nobody (Tie / Skipped)');
    } else {
        let targetPlayer = room.players.find(p => p.id === ejected);
        if (targetPlayer) {
            targetPlayer.status = 'dead';
            io.to(roomCode).emit('playerEjected', targetPlayer.username);
            // Check if jester was voted out
            if (targetPlayer.role === 'jester') {
                triggerGameOver(roomCode, 'Jester (Voted Out!)');
                return;
            }
        } else {
            io.to(roomCode).emit('playerEjected', 'Nobody (Skipped)');
        }
    }

    room.players.forEach(p => p.jailedBy = null);
    
    if (!checkWinConditions(roomCode)) {
        room.state = 'running';
        io.to(roomCode).emit('meetingEnded', room.players);
    }
    
    const deadPlayers = room.players.filter(p => p.status === 'dead');
    if (deadPlayers.length > 0) {
        const deadNames = deadPlayers.map(p => p.username).join(', ');
        io.to(roomCode).emit('meetingOutcome', { message: `${deadNames} has been eliminated.` });
    } else {
        io.to(roomCode).emit('meetingOutcome', { message: 'Nobody was eliminated.' });
    }
}

function checkWinConditions(roomCode) {
    const room = rooms[roomCode];
    if (!room || room.state === 'lobby' || room.state === 'game_over') return false;

    const aliveImposters = room.players.filter(p => p.status === 'alive' && p.role === 'imposter').length;
    const aliveNonImposters = room.players.filter(p => p.status === 'alive' && p.role !== 'imposter').length;
    const allTasksComplete = room.players.filter(p => p.role !== 'imposter').every(p => p.tasksCompleted >= p.tasksRequired);

    if (allTasksComplete) {
        triggerGameOver(roomCode, 'Crewmates (All Tasks Completed!)');
        return true;
    }
    if (aliveImposters === 0) {
        triggerGameOver(roomCode, 'Crewmates (Imposters Eliminated!)');
        return true;
    }

    // FIX: Aaa testing override conditional check
    const isTestingOverride = room.players.some(p => p.username === 'Aaa');

    if (isTestingOverride) {
        // If "Aaa" is present, Imposters must actually kill the final crewmate to win (Testing Rules)
        if (aliveNonImposters === 0) {
            triggerGameOver(roomCode, 'Imposters (Crew Eliminated!)');
            return true;
        }
    } else {
        // Standard Rules: Imposters win immediately upon matching or exceeding living crew counts
        if (aliveImposters >= aliveNonImposters) {
            triggerGameOver(roomCode, 'Imposters (Crew Overrun!)');
            return true;
        }
    }

    return false;
}

function triggerGameOver(roomCode, winnerGroup) {
    rooms[roomCode].state = 'game_over';
    clearInterval(rooms[roomCode].timer);
    io.to(roomCode).emit('gameOverState', { winner: winnerGroup });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server executing safely on port ${PORT}`));