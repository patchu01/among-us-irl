const socket = io({ transports: ['websocket', 'polling'] });

let currentRoom = '';
let myRole = '';
let gamePlayers = [];
let cooldownTimer = null;
let taskTimer = null;
let meetingTimerInterval = null;
let canAct = true;
let canTask = true;
let amIHost = false;
let meetingPhase = 'gather';
let selectedVoteTarget = null;
let privacyOpen = false; // Tracks flip screen state

if (!sessionStorage.getItem('irl_user_uuid')) {
    sessionStorage.setItem('irl_user_uuid', 'user_' + Math.random().toString(36).substring(2, 15));
}
const myUUID = sessionStorage.getItem('irl_user_uuid');

window.addEventListener('DOMContentLoaded', () => {
    const savedRoom = sessionStorage.getItem('irl_room_code');
    const savedUser = sessionStorage.getItem('irl_username');
    if (savedRoom && savedUser) {
        if(document.getElementById('createUsername')) document.getElementById('createUsername').value = savedUser;
        if(document.getElementById('joinUsername')) document.getElementById('joinUsername').value = savedUser;
        if(document.getElementById('joinRoomCode')) document.getElementById('joinRoomCode').value = savedRoom;
        socket.emit('registerSession', { username: savedUser, room: savedRoom, uuid: myUUID });
    }
});

window.switchTab = function(tabName) {
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
};

window.createRoom = function() {
    const username = document.getElementById('createUsername').value.trim();
    if (!username) return alert("Enter a username.");
    sessionStorage.setItem('irl_username', username);
    socket.emit('createRoom', { username, uuid: myUUID });
};

window.joinRoom = function() {
    const username = document.getElementById('joinUsername').value.trim();
    currentRoom = document.getElementById('joinRoomCode').value.trim();
    if (!username || currentRoom.length !== 6) return alert("Invalid credentials.");
    
    sessionStorage.setItem('irl_username', username);
    sessionStorage.setItem('irl_room_code', currentRoom);
    socket.emit('joinLobby', { username, room: currentRoom, uuid: myUUID });
};

window.pushRoleConfig = function() {
    if (!amIHost) return;
    const config = {
        imposters: document.getElementById('cfgImposters').value,
        doctors: document.getElementById('cfgDoctors').value,
        sheriffs: document.getElementById('cfgSheriffs').value,
        jailors: document.getElementById('cfgJailors').value
    };
    socket.emit('updateRoleConfig', { room: currentRoom, config });
};

window.startGame = function() { socket.emit('startGame', currentRoom); };
window.reportBody = function() { socket.emit('reportBody', currentRoom); };
window.callMeeting = function() { socket.emit('callMeeting', currentRoom); };
window.startMeeting = function() { 
    socket.emit('startMeeting', currentRoom); 
    document.getElementById('hostMeetingBtn').classList.add('hidden'); 
};

// Flip Screen Logic Control
window.togglePrivacy = function() {
    privacyOpen = !privacyOpen;
    const container = document.getElementById('privacyContainer');
    const btn = document.getElementById('togglePrivacyBtn');
    if (privacyOpen) {
        container.classList.remove('hidden');
        btn.innerText = "🔒 Hide Privacy Screen";
        btn.style.background = "#ff453a";
    } else {
        container.classList.add('hidden');
        btn.innerText = "👀 Reveal Privacy Screen";
        btn.style.background = "#0a84ff";
    }
};

window.triggerReturnLobby = function() {
    if (amIHost) socket.emit('returnToLobby', currentRoom);
};

window.submitTaskDone = function() {
    if (!canTask) return;
    socket.emit('logTask', currentRoom);
    
    canTask = false;
    let left = 30;
    const taskBtn = document.getElementById('taskBtn');
    const cooldownText = document.getElementById('taskCooldownDisplay');
    
    taskBtn.classList.add('btn-disabled');
    cooldownText.innerText = `Task Log Cooldown: ${left}s`;
    
    clearInterval(taskTimer);
    taskTimer = setInterval(() => {
        left--;
        cooldownText.innerText = `Task Log Cooldown: ${left}s`;
        if (left <= 0) {
            clearInterval(taskTimer);
            canTask = true;
            cooldownText.innerText = '';
            const me = gamePlayers.find(p => p.id === socket.id);
            if (me && me.status === 'alive') taskBtn.classList.remove('btn-disabled');
        }
    }, 1000);
};

socket.on('joinError', (err) => {
    sessionStorage.clear();
    alert(err);
});

socket.on('roomCreated', (data) => {
    currentRoom = data.room;
    sessionStorage.setItem('irl_room_code', currentRoom);
});

socket.on('roleConfigUpdated', (config) => {
    if (!amIHost) {
        document.getElementById('cfgImposters').value = config.imposters;
        document.getElementById('cfgDoctors').value = config.doctors;
        document.getElementById('cfgSheriffs').value = config.sheriffs;
        document.getElementById('cfgJailors').value = config.jailors;
    }
});

// Resets interface comprehensively (especially when returning from a GameOver state)
socket.on('updateLobby', (data) => {
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('lobbyScreen').classList.remove('hidden');
    document.getElementById('gameScreen').classList.add('hidden');
    document.getElementById('meetingScreen').classList.add('hidden');
    document.getElementById('gameOverScreen').classList.add('hidden');
    
    currentRoom = data.roomCode;
    document.getElementById('lobbyRoomCodeDisplay').innerText = data.roomCode;
    
    amIHost = (socket.id === data.hostId);
    if (amIHost) {
        document.getElementById('startBtn').classList.remove('hidden');
        document.querySelectorAll('#hostSettingsPanel select').forEach(s => s.disabled = false);
    } else {
        document.getElementById('startBtn').classList.add('hidden');
        document.querySelectorAll('#hostSettingsPanel select').forEach(s => s.disabled = true);
    }
    
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
    
    // Ensure privacy filter is securely closed before starting
    privacyOpen = false;
    document.getElementById('privacyContainer').classList.add('hidden');
    document.getElementById('togglePrivacyBtn').innerText = "👀 Reveal Privacy Screen";
    document.getElementById('togglePrivacyBtn').style.background = "#0a84ff";

    document.getElementById('lobbyScreen').classList.add('hidden');
    document.getElementById('gameScreen').classList.remove('hidden');
    
    const roleEl = document.getElementById('roleDisplay');
    roleEl.innerText = "Role: " + myRole.toUpperCase();
    roleEl.style.color = (myRole === 'imposter') ? '#ff453a' : '#30d158';
    
    if (myRole !== 'imposter') {
        document.getElementById('taskBtn').classList.remove('hidden');
    } else {
        document.getElementById('taskBtn').classList.add('hidden');
    }

    startLocalCooldown((myRole === 'imposter') ? 90 : 0);
});

socket.on('tasksUpdated', (data) => {
    const percentage = (data.completed / data.required) * 100;
    document.getElementById('taskBarFill').style.width = `${percentage}%`;
    document.getElementById('taskBarText').innerText = `Tasks: ${data.completed} / ${data.required}`;
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
        document.getElementById('taskBtn').classList.add('hidden');
        document.getElementById('reportBtn').classList.add('hidden');
        document.getElementById('emergencyBtn').classList.add('hidden');
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
                btn.onclick = () => { socket.emit('actionKill', { room: currentRoom, targetId: p.id }); startLocalCooldown(90); };
                card.appendChild(btn);
            }
        }
        panel.appendChild(card);
    });
}

window.executeDoctorShield = function() {
    const val = document.getElementById('docTargetSelect').value;
    if(val) socket.emit('actionShield', { room: currentRoom, targetId: val });
};

window.executeJailorDetain = function() {
    if(!canAct) return alert("Jailing ability is on cooldown!");
    const val = document.getElementById('jailorTargetSelect').value;
    if(val) { socket.emit('actionJail', { room: currentRoom, targetId: val }); startLocalCooldown(20); }
};

window.executeJailedSuspect = function() {
    const val = document.getElementById('jailorTargetSelect').value;
    if(val) socket.emit('actionExecute', { room: currentRoom, targetId: val });
};

socket.on('updateGame', (players) => { gamePlayers = players; renderActionPanel(); });

socket.on('meetingCalled', (data) => {
    meetingPhase = 'gather';
    selectedVoteTarget = null; 
    clearInterval(cooldownTimer);
    clearInterval(meetingTimerInterval);
    
    // Automatically close the privacy filter to prevent leaving it open
    privacyOpen = false;
    document.getElementById('privacyContainer').classList.add('hidden');
    document.getElementById('togglePrivacyBtn').innerText = "👀 Reveal Privacy Screen";
    document.getElementById('togglePrivacyBtn').style.background = "#0a84ff";

    document.getElementById('gameScreen').classList.add('hidden');
    document.getElementById('meetingScreen').classList.remove('hidden');
    
    document.getElementById('votingUI').classList.add('hidden');
    document.getElementById('jailorExecuteUI').classList.add('hidden');
    document.getElementById('gatherPrompt').classList.remove('hidden'); 
    document.getElementById('meetingTimer').innerText = '--';
    
    if (data && data.type) {
        const callerName = gamePlayers.find(p => p.id === data.caller)?.username || "System Call";
        document.getElementById('meetingStatus').innerText = `${data.type} initiated by ${callerName}. Gather at location!`;
    }
    
    if (amIHost) document.getElementById('hostMeetingBtn').classList.remove('hidden');
});

socket.on('meetingStarted', (data) => {
    meetingPhase = 'discuss';
    document.getElementById('gatherPrompt').classList.add('hidden'); 
    document.getElementById('meetingStatus').innerText = `PHASE: DISCUSSION / VOTING`;
    
    document.getElementById('votingUI').classList.remove('hidden'); 
    renderVotingPanel();

    let left = data.duration;
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
    
    if(meetingPhase !== 'discuss') return;

    const me = gamePlayers.find(p => p.id === socket.id);
    if (me && me.status === 'dead') {
        container.innerHTML = '<h4 style="color:#ff453a;">Ghosts cannot vote.</h4>';
        document.getElementById('skipVoteBtn').className = 'hidden';
        return;
    }
    
    const skipBtn = document.getElementById('skipVoteBtn');
    skipBtn.className = 'btn btn-alt';
    skipBtn.innerHTML = 'Skip Registration';
    skipBtn.onclick = () => window.selectVoteTarget('skip', skipBtn);

    gamePlayers.forEach(p => {
        if (p.status === 'alive') {
            let rowDiv = document.createElement('div');
            rowDiv.style.display = 'flex';
            rowDiv.style.alignItems = 'center';
            rowDiv.style.margin = '5px 0';
            rowDiv.id = `vote-row-${p.id}`;

            let btn = document.createElement('button');
            btn.className = 'btn btn-alt';
            btn.style.margin = '0';
            btn.style.flex = '1';
            btn.id = `vote-btn-${p.id}`;
            btn.innerText = p.username;
            btn.onclick = () => window.selectVoteTarget(p.id, rowDiv);
            
            rowDiv.appendChild(btn);
            container.appendChild(rowDiv);
        }
    });
}

window.selectVoteTarget = function(targetId, elementContainer) {
    const oldTick = document.getElementById('voteConfirmTick');
    if (oldTick) oldTick.remove();

    selectedVoteTarget = targetId;

    let confirmBtn = document.createElement('button');
    confirmBtn.id = 'voteConfirmTick';
    confirmBtn.className = 'btn btn-confirm';
    confirmBtn.innerText = '✓';
    confirmBtn.onclick = (e) => {
        e.stopPropagation();
        window.confirmAndSubmitVote();
    };

    elementContainer.appendChild(confirmBtn);
};

window.confirmAndSubmitVote = function() {
    if (!selectedVoteTarget) return;
    socket.emit('submitVote', { room: currentRoom, targetId: selectedVoteTarget });
    
    document.getElementById('skipVoteBtn').className = 'hidden';
    const oldTick = document.getElementById('voteConfirmTick');
    if (oldTick) oldTick.remove();
    
    document.querySelectorAll('#voteList button').forEach(btn => {
        btn.disabled = true;
        btn.onclick = null; 
    });

    if (!document.getElementById('voteStatusNotice')) {
        let notice = document.createElement('h4');
        notice.id = 'voteStatusNotice';
        notice.innerText = 'Vote Logged. Waiting for other crew responses...';
        document.getElementById('votingUI').appendChild(notice);
    }
};

socket.on('voteCastFeedback', (data) => {
    const targetBtn = document.getElementById(`vote-btn-${data.voterId}`);
    if (targetBtn) {
        targetBtn.innerText = targetBtn.innerText.replace(" (Voted ✓)", "") + " (Voted ✓)";
        targetBtn.style.background = "#30d158";
        targetBtn.disabled = true;
    }
});

socket.on('playerEjected', (result) => {
    document.getElementById('meetingStatus').innerText = `Assembly Result: ${result} was exiled.`;
});

socket.on('meetingEnded', (players) => {
    gamePlayers = players;
    selectedVoteTarget = null;
    clearInterval(meetingTimerInterval);
    document.getElementById('meetingScreen').classList.add('hidden');
    document.getElementById('gameScreen').classList.remove('hidden');
    
    const notice = document.getElementById('voteStatusNotice');
    if (notice) notice.remove();

    const me = gamePlayers.find(p => p.id === socket.id);
    if (me && me.status === 'alive') {
        document.getElementById('reportBtn').classList.remove('hidden');
        document.getElementById('emergencyBtn').classList.remove('hidden');
        if (myRole !== 'imposter') document.getElementById('taskBtn').classList.remove('hidden');
    }

    startLocalCooldown((myRole === 'imposter') ? 90 : 0);
});

socket.on('gameOverState', (data) => {
    clearInterval(cooldownTimer);
    clearInterval(taskTimer);
    clearInterval(meetingTimerInterval);
    
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('lobbyScreen').classList.add('hidden');
    document.getElementById('gameScreen').classList.add('hidden');
    document.getElementById('meetingScreen').classList.add('hidden');
    
    const goScreen = document.getElementById('gameOverScreen');
    const winHeader = document.getElementById('winHeader');
    
    goScreen.classList.remove('hidden');
    winHeader.innerText = `${data.winner.split(' ')[0]} Victory!`.toUpperCase();
    winHeader.style.color = data.winner.toLowerCase().includes('imposter') ? '#ff453a' : '#30d158';
    document.getElementById('winDetails').innerText = data.winner;
    
    if (amIHost) {
        document.getElementById('returnLobbyBtn').classList.remove('hidden');
        document.getElementById('waitingHostText').classList.add('hidden');
    } else {
        document.getElementById('returnLobbyBtn').classList.add('hidden');
        document.getElementById('waitingHostText').classList.remove('hidden');
    }
});