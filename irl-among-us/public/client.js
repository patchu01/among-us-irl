const socket = io({ transports: ['websocket'] });
let currentRoom = '';
let myRole = '';
let gamePlayers = [];
let cooldownTimer = null;
let canAct = true;
let amIHost = false;

function switchTab(tabName) {
    document.getElementById('createTab').classList.add('hidden');
    document.getElementById('joinTab').classList.add('hidden');
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    
    if (tabName === 'create') {
        document.getElementById('createTab').classList.remove('hidden');
        document.querySelectorAll('.tab-btn')[0].classList.add('active');
    } else {
        document.getElementById('joinTab').classList.remove('hidden');
        document.querySelectorAll('.tab-btn')[1].classList.add('active');
    }
}

function createRoom() {
    const username = document.getElementById('createUsername').value.trim();
    if (!username) return alert("Enter a username.");
    socket.emit('createRoom', { username });
}

function joinRoom() {
    const username = document.getElementById('joinUsername').value.trim();
    currentRoom = document.getElementById('joinRoomCode').value.trim();
    if (!username || currentRoom.length !== 6) return alert("Invalid credentials.");
    socket.emit('joinLobby', { username, room: currentRoom });
}

function startGame() { socket.emit('startGame', currentRoom); }
function reportBody() { socket.emit('reportBody', currentRoom); }
function callMeeting() { socket.emit('callMeeting', currentRoom); }
function startMeeting() { socket.emit('startMeeting', currentRoom); document.getElementById('hostMeetingBtn').classList.add('hidden'); }

socket.on('joinError', (err) => alert(err));

socket.on('updateLobby', (data) => {
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('lobbyScreen').classList.remove('hidden');
    currentRoom = data.roomCode;
    document.getElementById('lobbyRoomCodeDisplay').innerText = data.roomCode;
    
    amIHost = (socket.id === data.hostId);
    if (amIHost) document.getElementById('startBtn').classList.remove('hidden');
    
    const list = document.getElementById('playerList');
    list.innerHTML = '';
    data.players.forEach(p => {
        let div = document.createElement('div');
        div.className = 'player-card';
        div.innerText = `${p.username} ${p.id === data.hostId ? '👑' : ''}`;
        list.appendChild(div);
    });
});

socket.on('gameStarted', (data) => {
    myRole = data.role;
    gamePlayers = data.players;
    document.getElementById('lobbyScreen').classList.add('hidden');
    document.getElementById('gameScreen').classList.remove('hidden');
    
    const roleEl = document.getElementById('roleDisplay');
    roleEl.innerText = "Role: " + myRole.toUpperCase();
    roleEl.style.color = (myRole === 'imposter') ? '#ff453a' : '#30d158';
    
    // Check for admin user trigger dynamically
    const currentUsername = document.getElementById('createUsername').value.trim() || document.getElementById('joinUsername').value.trim();
    if (currentUsername === 'admin141211') {
        document.getElementById('adminPanel').classList.remove('hidden');
    }

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
    document.getElementById('timers').innerText = `COOLDOWN: ${left}s`;
    
    clearInterval(cooldownTimer);
    cooldownTimer = setInterval(() => {
        left--;
        document.getElementById('timers').innerText = `COOLDOWN: ${left}s`;
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
        panel.innerHTML = '<div style="color:#ff453a; font-weight:bold;">YOU ARE DEAD (DECEASED MANIFEST)</div>';
        document.getElementById('doctorUI').classList.add('hidden');
        document.getElementById('jailorUI').classList.add('hidden');
        return;
    }

    // Populate Select Dropdowns for Menu Interfaces
    if (myRole === 'doctor') {
        document.getElementById('doctorUI').classList.remove('hidden');
        const select = document.getElementById('docTargetSelect');
        select.innerHTML = '<option value="">-- Choose Patient --</option>';
        gamePlayers.forEach(p => { if(p.id !== socket.id && p.status === 'alive') select.innerHTML += `<option value="${p.id}">${p.username}</option>`; });
    } else if (myRole === 'jailor') {
        document.getElementById('jailorUI').classList.remove('hidden');
        const select = document.getElementById('jailorTargetSelect');
        select.innerHTML = '<option value="">-- Choose Suspect --</option>';
        gamePlayers.forEach(p => { if(p.id !== socket.id && p.status === 'alive') select.innerHTML += `<option value="${p.id}">${p.username}</option>`; });
    }

    // Main Status Manifest Table Screen Rendering
    gamePlayers.forEach(p => {
        let card = document.createElement('div');
        card.className = 'player-card';
        card.innerHTML = `<span>${p.username}</span><span style="color:${p.status==='alive'?'#30d158':'#ff453a'};">${p.status.toUpperCase()}</span>`;
        
        if (p.id !== socket.id && p.status === 'alive' && canAct) {
            if (myRole === 'imposter') {
                let btn = document.createElement('button');
                btn.className = 'btn btn-kill';
                btn.style.width = 'auto'; btn.style.margin = '0'; btn.style.padding = '8px 12px';
                btn.innerText = 'Kill';
                btn.onclick = () => { socket.emit('actionKill', { room: currentRoom, targetId: p.id, isSheriff: false }); startLocalCooldown(90); };
                card.appendChild(btn);
            } else if (myRole === 'sheriff') {
                let btn = document.createElement('button');
                btn.className = 'btn';
                btn.style.width = 'auto'; btn.style.margin = '0'; btn.style.padding = '8px 12px'; btn.style.background = '#bf5af2';
                btn.innerText = 'Shoot';
                btn.onclick = () => { socket.emit('actionKill', { room: currentRoom, targetId: p.id, isSheriff: true }); startLocalCooldown(30); };
                card.appendChild(btn);
            }
        }
        panel.appendChild(card);
    });
}

// Select Dropdown Executions
function executeDoctorShield() {
    const val = document.getElementById('docTargetSelect').value;
    if(val) socket.emit('actionShield', { room: currentRoom, targetId: val });
}

function executeJailorDetain() {
    if(!canAct) return alert("Jailing ability is on cooldown!");
    const val = document.getElementById('jailorTargetSelect').value;
    if(val) {
        socket.emit('actionJail', { room: currentRoom, targetId: val });
        startLocalCooldown(20);
    }
}

function executeJailedSuspect() {
    const val = document.getElementById('jailorTargetSelect').value;
    if(val) socket.emit('actionExecute', { room: currentRoom, targetId: val });
}

// Admin Panel Triggers
function adminRoleOverride() {
    const role = document.getElementById('adminRoleSelect').value;
    socket.emit('adminChangeRole', { room: currentRoom, role });
}

function adminScenario(scenario) {
    socket.emit('adminForceScenario', { room: currentRoom, scenario });
}

socket.on('updateGame', (players) => {
    gamePlayers = players;
    renderActionPanel();
});

socket.on('systemMessage', (msg) => {
    document.getElementById('systemMessages').innerText = msg;
});

socket.on('meetingCalled', (data) => {
    clearInterval(cooldownTimer);
    document.getElementById('gameScreen').classList.add('hidden');
    document.getElementById('meetingScreen').classList.remove('hidden');
    document.getElementById('votingUI').classList.add('hidden');
    document.getElementById('jailorExecuteUI').classList.add('hidden');
    
    const callerName = gamePlayers.find(p => p.id === data.caller)?.username || "Unknown System Switch";
    document.getElementById('meetingStatus').innerText = `${data.type} initiated by ${callerName}. Assemble in person!`;
    
    if (amIHost) document.getElementById('hostMeetingBtn').classList.remove('hidden');
});

socket.on('meetingStarted', (data) => {
    document.getElementById('meetingStatus').innerText = `PHASE: ${data.phase.toUpperCase()}`;
    let left = data.duration;
    
    if (myRole === 'jailor' && data.phase === 'discussion' && data.jailedId) {
        document.getElementById('jailorExecuteUI').classList.remove('hidden');
    }

    if (data.phase === 'voting') {
        document.getElementById('jailorExecuteUI').classList.add('hidden');
        if (socket.id !== data.jailedId) {
            document.getElementById('votingUI').classList.remove('hidden');
            renderVotingPanel();
        } else {
            document.getElementById('meetingStatus').innerText = "PHASE: VOTING (YOU ARE JAILED - VOTING RIGHTS REVOKED)";
        }
    }
    
    clearInterval(cooldownTimer);
    cooldownTimer = setInterval(() => {
        left--;
        document.getElementById('meetingTimer').innerText = `Time Remaining: ${left}s`;
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
            btn.onclick = () => {
                socket.emit('submitVote', { room: currentRoom, targetId: p.id });
                document.getElementById('votingUI').innerHTML = '<h4>Vote Logged. Waiting for synchronization...</h4>';
            };
            container.appendChild(btn);
        }
    });
}

socket.on('playerEjected', (result) => alert(`Result: ${result} was ejected.`));

socket.on('meetingEnded', (players) => {
    gamePlayers = players;
    document.getElementById('meetingScreen').classList.add('hidden');
    document.getElementById('gameScreen').classList.remove('hidden');
    document.getElementById('votingUI').classList.add('hidden');
    document.getElementById('jailorExecuteUI').classList.add('hidden');
    startLocalCooldown((myRole === 'imposter') ? 90 : 0);
});

socket.on('gameOver', (data) => {
    alert(`Game Concluded! Winners: ${data.winner}`);
    window.location.reload();
});