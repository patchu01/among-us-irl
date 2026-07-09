const socket = io({ transports: ['websocket'] });
let currentRoom = '';
let myRole = '';
let gamePlayers = [];
let cooldownTimer = null;
let meetingTimerInterval = null;
let canAct = true;
let amIHost = false;

if (!sessionStorage.getItem('irl_user_uuid')) {
    sessionStorage.setItem('irl_user_uuid', 'user_' + Math.random().toString(36).substring(2, 15));
}
const myUUID = sessionStorage.getItem('irl_user_uuid');

window.addEventListener('load', () => {
    const savedRoom = sessionStorage.getItem('irl_room_code');
    const savedUser = sessionStorage.getItem('irl_username');
    if (savedRoom && savedUser) {
        document.getElementById('createUsername').value = savedUser;
        document.getElementById('joinUsername').value = savedUser;
        document.getElementById('joinRoomCode').value = savedRoom;
        socket.emit('registerSession', { username: savedUser, room: savedRoom, uuid: myUUID });
    }
});

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
    sessionStorage.setItem('irl_username', username);
    socket.emit('createRoom', { username, uuid: myUUID });
}

function joinRoom() {
    const username = document.getElementById('joinUsername').value.trim();
    currentRoom = document.getElementById('joinRoomCode').value.trim();
    if (!username || currentRoom.length !== 6) return alert("Invalid credentials.");
    
    sessionStorage.setItem('irl_username', username);
    sessionStorage.setItem('irl_room_code', currentRoom);
    socket.emit('joinLobby', { username, room: currentRoom, uuid: myUUID });
}

function startGame() { socket.emit('startGame', currentRoom); }
function reportBody() { socket.emit('reportBody', currentRoom); }
function callMeeting() { socket.emit('callMeeting', currentRoom); }
function startMeeting() { socket.emit('startMeeting', currentRoom); document.getElementById('hostMeetingBtn').classList.add('hidden'); }

socket.on('joinError', (err) => {
    sessionStorage.clear();
    alert(err);
});

socket.on('roomCreated', (data) => {
    currentRoom = data.room;
    sessionStorage.setItem('irl_room_code', currentRoom);
});

socket.on('updateLobby', (data) => {
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('lobbyScreen').classList.remove('hidden');
    document.getElementById('gameScreen').classList.add('hidden');
    document.getElementById('meetingScreen').classList.add('hidden');
    
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
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('gameScreen').classList.remove('hidden');
    document.getElementById('meetingScreen').classList.add('hidden');
    
    const roleEl = document.getElementById('roleDisplay');
    roleEl.innerText = "Role: " + myRole.toUpperCase();
    roleEl.style.color = (myRole === 'imposter') ? '#ff453a' : '#30d158';
    
    const currentUsername = sessionStorage.getItem('irl_username');
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
        panel.innerHTML = '<div style="color:#ff453a; font-weight:bold;">YOU ARE DEAD (GHOST MODE)</div>';
        document.getElementById('doctorUI').classList.add('hidden');
        document.getElementById('jailorUI').classList.add('hidden');
        return;
    }

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
    clearInterval(meetingTimerInterval);
    document.getElementById('gameScreen').classList.add('hidden');
    document.getElementById('meetingScreen').classList.remove('hidden');
    
    document.getElementById('votingUI').classList.remove('hidden');
    document.getElementById('jailorExecuteUI').classList.add('hidden');
    renderVotingPanel();
    
    if (data && data.type) {
        const callerName = gamePlayers.find(p => p.id === data.caller)?.username || "The Room Creator";
        document.getElementById('meetingStatus').innerText = `${data.type} called by ${callerName}. Gather and deliberate!`;
    }
    
    if (amIHost) document.getElementById('hostMeetingBtn').classList.remove('hidden');
});

socket.on('meetingStarted', (data) => {
    document.getElementById('meetingStatus').innerText = `PHASE: ${data.phase.toUpperCase()}`;
    let left = data.duration;
    
    if (myRole === 'jailor' && data.phase === 'discussion' && data.jailedId) {
        document.getElementById('jailorExecuteUI').classList.remove('hidden');
    }

    if (socket.id === data.jailedId) {
        document.getElementById('votingUI').className = 'hidden';
        document.getElementById('meetingStatus').innerText = `PHASE: ${data.phase.toUpperCase()} (YOU ARE JAILED)`;
    }
    
    clearInterval(meetingTimerInterval);
    document.getElementById('meetingTimer').innerText = `${left}s`;
    
    meetingTimerInterval = setInterval(() => {
        left--;
        document.getElementById('meetingTimer').innerText = `${left}s`;
        if(left <= 0) clearInterval(meetingTimerInterval);
    }, 1000);
});

function renderVotingPanel() {
    const container = document.getElementById('voteList');
    container.innerHTML = '';
    
    const me = gamePlayers.find(p => p.id === socket.id);
    if (me && me.status === 'dead') {
        container.innerHTML = '<h4 style="color:#ff453a;">Ghosts cannot vote.</h4>';
        document.getElementById('skipVoteBtn').className = 'hidden';
        return;
    }
    
    document.getElementById('skipVoteBtn').className = 'btn btn-alt';

    gamePlayers.forEach(p => {
        if (p.status === 'alive') {
            let btn = document.createElement('button');
            btn.className = 'btn btn-alt';
            btn.id = `vote-btn-${p.id}`;
            btn.innerText = p.username;
            btn.onclick = () => submitVote(p.id);
            container.appendChild(btn);
        }
    });
}

function submitVote(targetId) {
    socket.emit('submitVote', { room: currentRoom, targetId });
    document.getElementById('votingUI').innerHTML = '<h4>Vote Logged. Waiting for other crew responses...</h4>';
}

socket.on('voteCastFeedback', (data) => {
    const targetBtn = document.getElementById(`vote-btn-${data.voterId}`);
    if (targetBtn) {
        targetBtn.innerText += " (Voted ✓)";
        targetBtn.style.background = "#30d158";
        targetBtn.disabled = true;
    }
});

socket.on('playerEjected', (result) => alert(`Assembly Verdict: ${result} was exiled.`));

socket.on('meetingEnded', (players) => {
    gamePlayers = players;
    clearInterval(meetingTimerInterval);
    document.getElementById('meetingScreen').classList.add('hidden');
    document.getElementById('gameScreen').classList.remove('hidden');
    document.getElementById('votingUI').classList.add('hidden');
    document.getElementById('jailorExecuteUI').classList.add('hidden');
    startLocalCooldown((myRole === 'imposter') ? 90 : 0);
});

socket.on('gameOver', (data) => {
    sessionStorage.removeItem('irl_room_code'); 
    alert(`Scenario Complete! Winners: ${data.winner}`);
    window.location.reload();
});