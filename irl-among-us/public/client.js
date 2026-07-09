const socket = io({
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: 15,
    reconnectionDelay: 1000
});

let currentRoom = '';
let myRole = '';
let gamePlayers = [];
let cooldownTimer = null;
let canAct = true;
let amIHost = false;

function joinRoom() {
    const username = document.getElementById('username').value.trim();
    currentRoom = document.getElementById('roomCode').value.trim().toUpperCase();
    if(!currentRoom) return alert("Room code required.");
    
    socket.emit('joinLobby', { username, room: currentRoom });
    document.getElementById('joinForm').classList.add('hidden');
    document.getElementById('lobbyUI').classList.remove('hidden');
}

function sendSettings() {
    if(!amIHost) return;
    const settings = {
        imps: document.getElementById('setImps').value,
        docs: document.getElementById('setDocs').value,
        sheriffs: document.getElementById('setSheriffs').value,
        jailors: document.getElementById('setJailors').value
    };
    socket.emit('updateSettings', { room: currentRoom, settings });
}

function startGame() { socket.emit('startGame', currentRoom); }
function reportBody() { socket.emit('reportBody', currentRoom); }
function callMeeting() { socket.emit('callMeeting', currentRoom); }
function startMeeting() { socket.emit('startMeeting', currentRoom); document.getElementById('hostMeetingBtn').classList.add('hidden'); }

socket.on('updateLobby', (data) => {
    amIHost = (socket.id === data.hostId);
    if (amIHost) {
        document.getElementById('hostSettings').classList.remove('hidden');
        document.getElementById('startBtn').classList.remove('hidden');
    }
    
    const list = document.getElementById('playerList');
    list.innerHTML = '';
    data.players.forEach(p => {
        let div = document.createElement('div');
        div.className = 'player-card';
        div.innerHTML = `<span class="player-info">${p.username} ${p.id === data.hostId ? '👑' : ''}</span>`;
        list.appendChild(div);
    });
});

socket.on('gameStarted', (data) => {
    myRole = data.role;
    gamePlayers = data.players;
    document.getElementById('lobbyScreen').classList.add('hidden');
    document.getElementById('gameScreen').classList.remove('hidden');
    
    const roleEl = document.getElementById('myRole');
    roleEl.innerText = myRole.toUpperCase();
    roleEl.style.color = (myRole === 'imposter') ? '#ff453a' : '#30d158';
    
    // Set explicit initial custom operational cooldown parameters instantly
    startLocalCooldown((myRole === 'imposter') ? 90 : 0);
});

function startLocalCooldown(seconds) {
    if (seconds <= 0) {
        canAct = true;
        document.getElementById('timers').innerText = '';
        renderActionPanel();
        return;
    }
    canAct = false;
    renderActionPanel();
    let left = seconds;
    document.getElementById('timers').innerText = `ABILITY COOLDOWN: ${left}s`;
    
    clearInterval(cooldownTimer);
    cooldownTimer = setInterval(() => {
        left--;
        document.getElementById('timers').innerText = `ABILITY COOLDOWN: ${left}s`;
        if (left <= 0) {
            clearInterval(cooldownTimer);
            canAct = true;
            document.getElementById('timers').innerText = '';
            renderActionPanel();
        }
    }, 1000);
}

function renderActionPanel() {
    const panel = document.getElementById('playersActionList');
    panel.innerHTML = '';
    
    const me = gamePlayers.find(p => p.id === socket.id);
    if (!me) return;
    
    document.getElementById('meetCount').innerText = me.meetingsLeft;

    if (me.status === 'dead') {
        panel.innerHTML = '<div style="color:#ff453a; font-weight:bold; font-size:20px;">YOU ARE DEAD (GHOST MODE)</div>';
        return;
    }

    gamePlayers.forEach(p => {
        if (p.id === socket.id) return;
        
        let card = document.createElement('div');
        card.className = 'player-card';
        
        let displayStatus = p.status.toUpperCase();
        card.innerHTML = `<div class="player-info">${p.username}<br><span style="font-size:12px; color:#8e8e93;">STATUS: ${displayStatus}</span></div>`;
        
        let actionsDiv = document.createElement('div');
        actionsDiv.className = 'player-actions';
        
        if (p.status === 'alive') {
            if (myRole === 'imposter') {
                let btn = document.createElement('button');
                btn.className = canAct ? 'btn-kill' : 'btn-disabled';
                btn.innerText = 'Kill';
                btn.onclick = () => { if(canAct) { socket.emit('actionKill', { room: currentRoom, targetId: p.id, isSheriff: false }); startLocalCooldown(90); } };
                actionsDiv.appendChild(btn);
            } else if (myRole === 'doctor') {
                let btn = document.createElement('button');
                btn.style.background = '#0a84ff';
                btn.innerText = 'Shield';
                btn.onclick = () => socket.emit('actionShield', { room: currentRoom, targetId: p.id });
                actionsDiv.appendChild(btn);
            } else if (myRole === 'sheriff') {
                let btn = document.createElement('button');
                btn.className = canAct ? 'btn-kill' : 'btn-disabled';
                btn.style.background = '#bf5af2';
                btn.innerText = 'Execute';
                btn.onclick = () => { if(canAct) { socket.emit('actionKill', { room: currentRoom, targetId: p.id, isSheriff: true }); startLocalCooldown(30); } };
                actionsDiv.appendChild(btn);
            } else if (myRole === 'jailor') {
                let btnJail = document.createElement('button');
                btnJail.className = canAct ? '' : 'btn-disabled';
                btnJail.style.background = '#ff9f0a';
                btnJail.innerText = 'Jail';
                btnJail.onclick = () => { if(canAct) { socket.emit('actionJail', { room: currentRoom, targetId: p.id }); startLocalCooldown(20); } };
                actionsDiv.appendChild(btnJail);
            }
        }
        card.appendChild(actionsDiv);
        panel.appendChild(card);
    });
}

socket.on('updateGame', (players) => {
    gamePlayers = players;
    renderActionPanel();
});

socket.on('systemMessage', (msg) => {
    const el = document.getElementById('systemMessages');
    el.innerText = msg;
    setTimeout(() => { if(el.innerText === msg) el.innerText = ''; }, 6000);
});

socket.on('meetingCalled', (data) => {
    clearInterval(cooldownTimer);
    document.getElementById('gameScreen').classList.add('hidden');
    document.getElementById('meetingScreen').classList.remove('hidden');
    document.getElementById('votingUI').classList.add('hidden');
    document.getElementById('meetingTimer').innerText = '';
    
    const callerName = gamePlayers.find(p => p.id === data.caller)?.username || "Unknown";
    document.getElementById('meetingStatus').innerText = `${data.type} initiated by ${callerName}! Meet IRL.`;
    
    if (amIHost) {
        document.getElementById('hostMeetingBtn').classList.remove('hidden');
    }
});

socket.on('meetingStarted', (data) => {
    document.getElementById('meetingStatus').innerText = `PHASE: ${data.phase.toUpperCase()}`;
    let left = data.duration;
    
    if (data.phase === 'voting') {
        document.getElementById('votingUI').classList.remove('hidden');
        renderVotingPanel();
    }
    
    const timerEl = document.getElementById('meetingTimer');
    timerEl.innerText = `Time: ${left}s`;
    
    clearInterval(cooldownTimer);
    cooldownTimer = setInterval(() => {
        left--;
        timerEl.innerText = `Time: ${left}s`;
        if(left <= 0) clearInterval(cooldownTimer);
    }, 1000);
});

function renderVotingPanel() {
    const container = document.getElementById('voteList');
    container.innerHTML = '';
    gamePlayers.forEach(p => {
        if (p.status === 'alive') {
            let btn = document.createElement('button');
            btn.className = 'btn btn-alt';
            btn.innerText = p.username;
            btn.onclick = () => submitVote(p.id);
            container.appendChild(btn);
        }
    });
}

function submitVote(targetId) {
    socket.emit('submitVote', { room: currentRoom, targetId });
    document.getElementById('votingUI').innerHTML = '<h4>Vote Logged Successfully.</h4>';
}

socket.on('playerEjected', (result) => {
    alert(`Assembly Result: ${result} was exiled.`);
});

socket.on('meetingEnded', (players) => {
    gamePlayers = players;
    document.getElementById('meetingScreen').classList.add('hidden');
    document.getElementById('gameScreen').classList.remove('hidden');
    
    // Resume imposter parameters or roll operational updates automatically
    startLocalCooldown((myRole === 'imposter') ? 90 : 0);
});

socket.on('gameOver', (data) => {
    alert(`Scenario Concluded! Winner: ${data.winner}`);
    window.location.reload();
});const socket = io({
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: 15,
    reconnectionDelay: 1000
});

let currentRoom = '';
let myRole = '';
let gamePlayers = [];
let cooldownTimer = null;
let canAct = true;
let amIHost = false;

function joinRoom() {
    const username = document.getElementById('username').value.trim();
    currentRoom = document.getElementById('roomCode').value.trim().toUpperCase();
    if(!currentRoom) return alert("Room code required.");
    
    socket.emit('joinLobby', { username, room: currentRoom });
    document.getElementById('joinForm').classList.add('hidden');
    document.getElementById('lobbyUI').classList.remove('hidden');
}

function sendSettings() {
    if(!amIHost) return;
    const settings = {
        imps: document.getElementById('setImps').value,
        docs: document.getElementById('setDocs').value,
        sheriffs: document.getElementById('setSheriffs').value,
        jailors: document.getElementById('setJailors').value
    };
    socket.emit('updateSettings', { room: currentRoom, settings });
}

function startGame() { socket.emit('startGame', currentRoom); }
function reportBody() { socket.emit('reportBody', currentRoom); }
function callMeeting() { socket.emit('callMeeting', currentRoom); }
function startMeeting() { socket.emit('startMeeting', currentRoom); document.getElementById('hostMeetingBtn').classList.add('hidden'); }

socket.on('updateLobby', (data) => {
    amIHost = (socket.id === data.hostId);
    if (amIHost) {
        document.getElementById('hostSettings').classList.remove('hidden');
        document.getElementById('startBtn').classList.remove('hidden');
    }
    
    const list = document.getElementById('playerList');
    list.innerHTML = '';
    data.players.forEach(p => {
        let div = document.createElement('div');
        div.className = 'player-card';
        div.innerHTML = `<span class="player-info">${p.username} ${p.id === data.hostId ? '👑' : ''}</span>`;
        list.appendChild(div);
    });
});

socket.on('gameStarted', (data) => {
    myRole = data.role;
    gamePlayers = data.players;
    document.getElementById('lobbyScreen').classList.add('hidden');
    document.getElementById('gameScreen').classList.remove('hidden');
    
    const roleEl = document.getElementById('myRole');
    roleEl.innerText = myRole.toUpperCase();
    roleEl.style.color = (myRole === 'imposter') ? '#ff453a' : '#30d158';
    
    // Set explicit initial custom operational cooldown parameters instantly
    startLocalCooldown((myRole === 'imposter') ? 90 : 0);
});

function startLocalCooldown(seconds) {
    if (seconds <= 0) {
        canAct = true;
        document.getElementById('timers').innerText = '';
        renderActionPanel();
        return;
    }
    canAct = false;
    renderActionPanel();
    let left = seconds;
    document.getElementById('timers').innerText = `ABILITY COOLDOWN: ${left}s`;
    
    clearInterval(cooldownTimer);
    cooldownTimer = setInterval(() => {
        left--;
        document.getElementById('timers').innerText = `ABILITY COOLDOWN: ${left}s`;
        if (left <= 0) {
            clearInterval(cooldownTimer);
            canAct = true;
            document.getElementById('timers').innerText = '';
            renderActionPanel();
        }
    }, 1000);
}

function renderActionPanel() {
    const panel = document.getElementById('playersActionList');
    panel.innerHTML = '';
    
    const me = gamePlayers.find(p => p.id === socket.id);
    if (!me) return;
    
    document.getElementById('meetCount').innerText = me.meetingsLeft;

    if (me.status === 'dead') {
        panel.innerHTML = '<div style="color:#ff453a; font-weight:bold; font-size:20px;">YOU ARE DEAD (GHOST MODE)</div>';
        return;
    }

    gamePlayers.forEach(p => {
        if (p.id === socket.id) return;
        
        let card = document.createElement('div');
        card.className = 'player-card';
        
        let displayStatus = p.status.toUpperCase();
        card.innerHTML = `<div class="player-info">${p.username}<br><span style="font-size:12px; color:#8e8e93;">STATUS: ${displayStatus}</span></div>`;
        
        let actionsDiv = document.createElement('div');
        actionsDiv.className = 'player-actions';
        
        if (p.status === 'alive') {
            if (myRole === 'imposter') {
                let btn = document.createElement('button');
                btn.className = canAct ? 'btn-kill' : 'btn-disabled';
                btn.innerText = 'Kill';
                btn.onclick = () => { if(canAct) { socket.emit('actionKill', { room: currentRoom, targetId: p.id, isSheriff: false }); startLocalCooldown(90); } };
                actionsDiv.appendChild(btn);
            } else if (myRole === 'doctor') {
                let btn = document.createElement('button');
                btn.style.background = '#0a84ff';
                btn.innerText = 'Shield';
                btn.onclick = () => socket.emit('actionShield', { room: currentRoom, targetId: p.id });
                actionsDiv.appendChild(btn);
            } else if (myRole === 'sheriff') {
                let btn = document.createElement('button');
                btn.className = canAct ? 'btn-kill' : 'btn-disabled';
                btn.style.background = '#bf5af2';
                btn.innerText = 'Execute';
                btn.onclick = () => { if(canAct) { socket.emit('actionKill', { room: currentRoom, targetId: p.id, isSheriff: true }); startLocalCooldown(30); } };
                actionsDiv.appendChild(btn);
            } else if (myRole === 'jailor') {
                let btnJail = document.createElement('button');
                btnJail.className = canAct ? '' : 'btn-disabled';
                btnJail.style.background = '#ff9f0a';
                btnJail.innerText = 'Jail';
                btnJail.onclick = () => { if(canAct) { socket.emit('actionJail', { room: currentRoom, targetId: p.id }); startLocalCooldown(20); } };
                actionsDiv.appendChild(btnJail);
            }
        }
        card.appendChild(actionsDiv);
        panel.appendChild(card);
    });
}

socket.on('updateGame', (players) => {
    gamePlayers = players;
    renderActionPanel();
});

socket.on('systemMessage', (msg) => {
    const el = document.getElementById('systemMessages');
    el.innerText = msg;
    setTimeout(() => { if(el.innerText === msg) el.innerText = ''; }, 6000);
});

socket.on('meetingCalled', (data) => {
    clearInterval(cooldownTimer);
    document.getElementById('gameScreen').classList.add('hidden');
    document.getElementById('meetingScreen').classList.remove('hidden');
    document.getElementById('votingUI').classList.add('hidden');
    document.getElementById('meetingTimer').innerText = '';
    
    const callerName = gamePlayers.find(p => p.id === data.caller)?.username || "Unknown";
    document.getElementById('meetingStatus').innerText = `${data.type} initiated by ${callerName}! Meet IRL.`;
    
    if (amIHost) {
        document.getElementById('hostMeetingBtn').classList.remove('hidden');
    }
});

socket.on('meetingStarted', (data) => {
    document.getElementById('meetingStatus').innerText = `PHASE: ${data.phase.toUpperCase()}`;
    let left = data.duration;
    
    if (data.phase === 'voting') {
        document.getElementById('votingUI').classList.remove('hidden');
        renderVotingPanel();
    }
    
    const timerEl = document.getElementById('meetingTimer');
    timerEl.innerText = `Time: ${left}s`;
    
    clearInterval(cooldownTimer);
    cooldownTimer = setInterval(() => {
        left--;
        timerEl.innerText = `Time: ${left}s`;
        if(left <= 0) clearInterval(cooldownTimer);
    }, 1000);
});

function renderVotingPanel() {
    const container = document.getElementById('voteList');
    container.innerHTML = '';
    gamePlayers.forEach(p => {
        if (p.status === 'alive') {
            let btn = document.createElement('button');
            btn.className = 'btn btn-alt';
            btn.innerText = p.username;
            btn.onclick = () => submitVote(p.id);
            container.appendChild(btn);
        }
    });
}

function submitVote(targetId) {
    socket.emit('submitVote', { room: currentRoom, targetId });
    document.getElementById('votingUI').innerHTML = '<h4>Vote Logged Successfully.</h4>';
}

socket.on('playerEjected', (result) => {
    alert(`Assembly Result: ${result} was exiled.`);
});

socket.on('meetingEnded', (players) => {
    gamePlayers = players;
    document.getElementById('meetingScreen').classList.add('hidden');
    document.getElementById('gameScreen').classList.remove('hidden');
    
    // Resume imposter parameters or roll operational updates automatically
    startLocalCooldown((myRole === 'imposter') ? 90 : 0);
});

socket.on('gameOver', (data) => {
    alert(`Scenario Concluded! Winner: ${data.winner}`);
    window.location.reload();
});