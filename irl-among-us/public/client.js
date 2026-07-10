const socket = io();

let currentRoomCode = null;
let localPlayer = { id: null, username: '', role: 'crewmate', status: 'alive' };
let currentGameState = 'lobby'; 

// DOM Elements
const authScreen = document.getElementById('authScreen');
const lobbyScreen = document.getElementById('lobbyScreen');
const gameScreen = document.getElementById('gameScreen');
const usernameInput = document.getElementById('usernameInput');
const roomCodeInput = document.getElementById('roomCodeInput');
const playerList = document.getElementById('playerList');
const gamePlayers = document.getElementById('gamePlayers');
const roleDisplay = document.getElementById('roleDisplay');
const gameLog = document.getElementById('gameLog');

// Configuration Elements
const imposterSelect = document.getElementById('imposterSelect');
const doctorSelect = document.getElementById('doctorSelect');
const sheriffSelect = document.getElementById('sheriffSelect');
const jailorSelect = document.getElementById('jailorSelect');

// Auth Handlers
function createRoom() {
    const username = usernameInput.value.trim() || 'Player';
    localPlayer.username = username;
    socket.emit('createRoom', { username, uuid: generateUUID() });
}

function joinRoom() {
    const username = usernameInput.value.trim() || 'Player';
    const room = roomCodeInput.value.trim();
    if (!room) return alert('Enter a room code!');
    localPlayer.username = username;
    socket.emit('joinLobby', { username, room, uuid: generateUUID() });
}

function sendConfigUpdate() {
    if (!currentRoomCode) return;
    const config = {
        imposters: imposterSelect.value,
        doctors: doctorSelect.value,
        sheriffs: sheriffSelect.value,
        jailors: jailorSelect.value
    };
    socket.emit('updateRoleConfig', { room: currentRoomCode, config });
}

function startGame() {
    if (!currentRoomCode) return;
    socket.emit('startGame', currentRoomCode);
}

function logTask() {
    if (!currentRoomCode) return;
    socket.emit('logTask', currentRoomCode);
}

function callMeeting() {
    if (!currentRoomCode) return;
    socket.emit('callMeeting', currentRoomCode);
}

function reportBody() {
    if (!currentRoomCode) return;
    socket.emit('reportBody', currentRoomCode);
}

function hostStartMeeting() {
    if (!currentRoomCode) return;
    socket.emit('startMeeting', currentRoomCode);
}

function castVote(targetId) {
    if (!currentRoomCode) return;
    socket.emit('submitVote', { room: currentRoomCode, targetId });
}

function executeKill(targetId) {
    if (!currentRoomCode) return;
    socket.emit('actionKill', { room: currentRoomCode, targetId });
}

function executeSheriffKill(targetId) {
    if (!currentRoomCode) return;
    socket.emit('actionSheriffKill', { room: currentRoomCode, targetId });
}

function jailPlayer(targetId) {
    if (!currentRoomCode) return;
    socket.emit('actionJail', { room: currentRoomCode, targetId });
}

function executeJailedPlayer() {
    if (!currentRoomCode) return;
    socket.emit('actionJailorExecute', { room: currentRoomCode });
}

// Socket Listeners
socket.on('connect', () => {
    localPlayer.id = socket.id;
});

socket.on('roomCreated', (data) => {
    currentRoomCode = data.room;
    showScreen(lobbyScreen);
    document.getElementById('roomDisplay').innerText = `Room: ${currentRoomCode}`;
});

socket.on('updateLobby', (data) => {
    currentRoomCode = data.roomCode;
    currentGameState = 'lobby';
    showScreen(lobbyScreen);
    document.body.style.border = "none"; 
    
    document.getElementById('roomDisplay').innerText = `Room: ${currentRoomCode}`;
    playerList.innerHTML = data.players.map(p => `<li>${p.username} ${p.id === data.hostId ? '⭐' : ''}</li>`).join('');
    
    const isHost = socket.id === data.hostId;
    document.getElementById('hostControls').style.display = isHost ? 'block' : 'none';
    
    if (data.config) {
        imposterSelect.value = data.config.imposters;
        doctorSelect.value = data.config.doctors;
        sheriffSelect.value = data.config.sheriffs;
        jailorSelect.value = data.config.jailors;
    }
});

socket.on('roleConfigUpdated', (config) => {
    imposterSelect.value = config.imposters;
    doctorSelect.value = config.doctors;
    sheriffSelect.value = config.sheriffs;
    jailorSelect.value = config.jailors;
});

socket.on('joinError', (msg) => alert(msg));

socket.on('gameStarted', (data) => {
    currentGameState = 'running';
    showScreen(gameScreen);
    localPlayer.role = data.role;
    roleDisplay.innerText = `Your Role: ${data.role.toUpperCase()}`;
    gameLog.innerHTML = `<p>Game started! Task requirement calculated.</p>`;
});

socket.on('updateGame', (players) => {
    const me = players.find(p => p.id === socket.id);
    if (me) localPlayer.status = me.status;

    gamePlayers.innerHTML = '';
    players.forEach(p => {
        const item = document.createElement('div');
        item.className = `player-item ${p.status}`;
        item.innerHTML = `<span>${p.username} (${p.status})</span>`;
        
        // Render Contextual Action Buttons
        if (p.id !== socket.id && p.status === 'alive') {
            if (currentGameState === 'running') {
                if (localPlayer.role === 'imposter') {
                    item.innerHTML += `<button onclick="executeKill('${p.id}')" class="btn-kill">Kill</button>`;
                }
                if (localPlayer.role === 'sheriff') {
                    item.innerHTML += `<button onclick="executeSheriffKill('${p.id}')" class="btn-sheriff">Execute</button>`;
                }
                if (localPlayer.role === 'jailor') {
                    item.innerHTML += `<button onclick="jailPlayer('${p.id}')" class="btn-jail">Jail</button>`;
                }
            }
            if (currentGameState === 'meeting_discuss' && localPlayer.status === 'alive') {
                item.innerHTML += `<button onclick="castVote('${p.id}')" class="btn-vote">Vote</button>`;
            }
        }
        gamePlayers.appendChild(item);
    });

    // Add standalone Execution Option for Jailor during active meetings
    const existingExecBtn = document.getElementById('jailorExecBtn');
    if (existingExecBtn) existingExecBtn.remove();

    if (currentGameState === 'meeting_discuss' && localPlayer.role === 'jailor' && localPlayer.status === 'alive') {
        const execBtn = document.createElement('button');
        execBtn.id = 'jailorExecBtn';
        execBtn.className = 'btn-execute';
        execBtn.innerText = 'Execute Jailed Target';
        execBtn.onclick = executeJailedPlayer;
        document.getElementById('meetingControls').appendChild(execBtn);
    }
});

socket.on('tasksUpdated', (data) => {
    document.getElementById('taskProgress').innerText = `Tasks completed: ${data.completed} / ${data.required}`;
});

socket.on('meetingCalled', (data) => {
    currentGameState = 'meeting_gather';
    document.getElementById('meetingControls').style.display = 'block';
    gameLog.innerHTML += `<p style="color: #e53e3e; font-weight:bold;">${data.type} called!</p>`;
});

socket.on('meetingStarted', (data) => {
    currentGameState = 'meeting_discuss';
    gameLog.innerHTML += `<p>Discussion started! ${data.duration} seconds remaining.</p>`;
    // Force rebuild layout to show voting/execution buttons
    socket.emit('submitVote', { room: currentRoomCode, targetId: null }); 
});

socket.on('voteCastFeedback', (data) => {
    console.log(`Vote registered from user: ${data.voterId}`);
});

socket.on('playerEjected', (msg) => {
    gameLog.innerHTML += `<p style="color: #f6ad55; font-weight:bold;">Ejection Result: ${msg}</p>`;
});

socket.on('meetingEnded', () => {
    currentGameState = 'running';
    document.getElementById('meetingControls').style.display = 'none';
    const existingExecBtn = document.getElementById('jailorExecBtn');
    if (existingExecBtn) existingExecBtn.remove();
    gameLog.innerHTML += `<p>Returning to roaming loop phase...</p>`;
});

socket.on('playerJailed', (data) => {
    alert(data.message);
    if (data.message.includes('executed')) {
        document.body.style.border = "5px solid #e53e3e";
    } else {
        document.body.style.border = "5px solid #4a5568";
    }
});

socket.on('actionFeedback', (data) => {
    gameLog.innerHTML += `<p style="color: #4ecca3;">${data.message}</p>`;
});

socket.on('gameOverState', (data) => {
    currentGameState = 'game_over';
    alert(`Game Over! Winners: ${data.winner}`);
    location.reload();
});

// Helper Layout functions
function showScreen(screen) {
    authScreen.style.display = 'none';
    lobbyScreen.style.display = 'none';
    gameScreen.style.display = 'none';
    screen.style.display = 'block';
}

function generateUUID() {
    return 'id-' + Math.random().toString(36).substr(2, 9);
}