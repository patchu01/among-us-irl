const socket = io({ transports: ['websocket', 'polling'] });

let currentRoom = '';
let myRole = '';
let gamePlayers = [];
let myTasksRequired = 0;
let myTasksCompleted = 0;
let cooldownTimer = null;
let taskTimer = null;
let meetingTimerInterval = null;
let canAct = true;
let canTask = true;
let amIHost = false;
let meetingPhase = 'gather';
let selectedVoteTarget = null;
let privacyOpen = false;
let myVoteTargetId = null;
let myVoteTargetName = '';
let voteTallyAnimationActive = false;
let voteTallyAnimationTimer = null;
let meetingEndedPendingPlayers = null;

let sheriffCooldownLeft = 0; 
let sheriffTimerInterval = null;

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

// Clears layout states completely between sessions to fix carry-over UI leakage bugs
function purgeAllRoleUIElements() {
    myRole = '';
    canAct = true;
    canTask = true;
    selectedVoteTarget = null;
    sheriffCooldownLeft = 0;

    clearInterval(cooldownTimer);
    clearInterval(taskTimer);
    clearInterval(meetingTimerInterval);
    clearInterval(sheriffTimerInterval);

    // Hide all specialized submenus explicitly
    document.getElementById('doctorUI').classList.add('hidden');
    document.getElementById('jailorUI').classList.add('hidden');
    document.getElementById('jailorExecuteUI').classList.add('hidden');
    document.getElementById('taskModuleWrapper').classList.add('hidden');
    
    // Wipe dynamic HTML wrappers completely cleanly
    document.getElementById('roleActionsWrapper').innerHTML = '';
    document.getElementById('docTargetSelect').innerHTML = '';
    document.getElementById('jailorTargetSelect').innerHTML = '';
    document.getElementById('timers').innerText = '';
    document.getElementById('taskCooldownDisplay').innerText = '';
    document.getElementById('roleDisplay').innerText = '';
    
    // Close privacy screen filter
    privacyOpen = false;
    document.getElementById('privacyContainer').classList.add('hidden');
    document.getElementById('togglePrivacyBtn').innerText = "👀 Reveal Role Information";
    document.getElementById('togglePrivacyBtn').style.background = "#0a84ff";

    myVoteTargetId = null;
    myVoteTargetName = '';
    voteTallyAnimationActive = false;
    meetingEndedPendingPlayers = null;
    clearTimeout(voteTallyAnimationTimer);
    document.getElementById('voteTallyAnimation').classList.add('hidden');
    document.getElementById('voteTallyAnimation').innerHTML = '';
}

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
        jailors: document.getElementById('cfgJailors').value,
        jesters: document.getElementById('cfgJesters').value
    };
    socket.emit('updateRoleConfig', { room: currentRoom, config });
    
    const tasks = document.getElementById('cfgTasksPerPlayer')?.value;
    if (tasks) {
        socket.emit('updateTasksPerPlayer', { room: currentRoom, tasks });
    }
};

window.startGame = function() { socket.emit('startGame', currentRoom); };
window.reportBody = function() { socket.emit('reportBody', currentRoom); };
window.callMeeting = function() { socket.emit('callMeeting', currentRoom); };
window.startMeeting = function() { 
    socket.emit('startMeeting', currentRoom); 
    document.getElementById('hostMeetingBtn').classList.add('hidden'); 
};

window.togglePrivacy = function() {
    privacyOpen = !privacyOpen;
    const container = document.getElementById('privacyContainer');
    const btn = document.getElementById('togglePrivacyBtn');
    if (privacyOpen) {
        container.classList.remove('hidden');
        btn.innerText = "🔒 Hide Role Information";
        btn.style.background = "#ff453a";
    } else {
        container.classList.add('hidden');
        btn.innerText = "👀 Reveal Role Information";
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
        document.getElementById('cfgJesters').value = config.jesters;
    }
});

socket.on('updateLobby', (data) => {
    // Purge elements directly when updating the setup phase layout
    purgeAllRoleUIElements();

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
    // Structural purge to guarantee a clean starting canvas
    purgeAllRoleUIElements();

    myRole = data.role;
    gamePlayers = data.players;
    myTasksRequired = data.tasksRequired || 0;
    myTasksCompleted = 0;
    
    document.getElementById('lobbyScreen').classList.add('hidden');
    document.getElementById('gameScreen').classList.remove('hidden');
    
    renderPrivacyPanel();
    
    if (myRole !== 'imposter' && myRole !== 'jester') {
        const percentage = myTasksRequired > 0 ? (myTasksCompleted / myTasksRequired) * 100 : 0;
        const bar = document.getElementById('taskBarFill');
        if(bar) bar.style.width = `${percentage}%`;
        const txt = document.getElementById('taskBarText');
        if(txt) txt.innerText = `${myTasksCompleted} / ${myTasksRequired}`;
    }
    
    if (myRole === 'imposter' || myRole === 'jester') {
        document.getElementById('taskModuleWrapper').classList.add('hidden');
    } else {
        document.getElementById('taskModuleWrapper').classList.remove('hidden');
        document.getElementById('taskBtn').classList.remove('btn-disabled');
    }

    if (myRole === 'sheriff') {
        sheriffCooldownLeft = 0;
        startSheriffCooldownLoop();
    } else {
        startLocalCooldown((myRole === 'imposter') ? 90 : 0);
    }
});

socket.on('tasksUpdated', (data) => {
    if (myRole !== 'imposter' && myRole !== 'jester' && data.players) {
        const me = data.players.find(p => p.id === socket.id);
        if (me) {
            myTasksCompleted = me.tasksCompleted || 0;
            myTasksRequired = me.tasksRequired || myTasksRequired;
            const percentage = myTasksRequired > 0 ? (myTasksCompleted / myTasksRequired) * 100 : 0;
            const bar = document.getElementById('taskBarFill');
            if(bar) bar.style.width = `${percentage}%`;
            const txt = document.getElementById('taskBarText');
            if(txt) txt.innerText = `${myTasksCompleted} / ${myTasksRequired}`;
        }
    }
    renderActionPanel();
});

function startLocalCooldown(seconds) {
    if (myRole === 'sheriff') return; 
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

function startSheriffCooldownLoop() {
    if (myRole !== 'sheriff') return;
    
    if (sheriffCooldownLeft <= 0) {
        canAct = true;
        document.getElementById('timers').innerText = '';
        renderActionPanel();
        return;
    }
    
    canAct = false;
    renderActionPanel();
    document.getElementById('timers').innerText = `SHERIFF COOLDOWN: ${sheriffCooldownLeft}s`;
    
    clearInterval(sheriffTimerInterval);
    sheriffTimerInterval = setInterval(() => {
        sheriffCooldownLeft--;
        document.getElementById('timers').innerText = `SHERIFF COOLDOWN: ${sheriffCooldownLeft}s`;
        
        if (sheriffCooldownLeft <= 0) {
            clearInterval(sheriffTimerInterval);
            canAct = true;
            document.getElementById('timers').innerText = '';
            renderActionPanel();
        }
    }, 1000);
}

function renderPrivacyPanel() {
    const roleEl = document.getElementById('roleDisplay');
    if (!roleEl) return;

    const roleLabel = myRole ? `Role: ${myRole.toUpperCase()}` : 'Role: ?';
    let roleColor = '#ff453a';
    if (myRole === 'crewmate') roleColor = '#0a84ff';
    else if (myRole === 'doctor') roleColor = '#30d158';
    else if (myRole === 'sheriff') roleColor = '#ffd60a';
    else if (myRole === 'jailor') roleColor = '#8e8e93';
    else if (myRole === 'jester') roleColor = '#a855f7';

    roleEl.style.color = roleColor;

    const lines = [roleLabel];

    if (myRole === 'imposter') {
        const teammates = (gamePlayers || []).filter(p => p.role === 'imposter' && p.id !== socket.id);
        const teammateText = teammates.length ? teammates.map(t => t.username).join(', ') : 'None';
        lines.push(`<span style="color:#ff9f0a; font-size:16px;">Teammates: ${teammateText}</span>`);
    } else if (myRole === 'doctor') {
        const shieldTarget = (gamePlayers || []).find(p => p.shieldedBy === socket.id);
        const shieldText = shieldTarget ? shieldTarget.username : 'None';
        lines.push(`<span style="color:#ff9f0a; font-size:16px;">Shielded Player: ${shieldText}</span>`);
    } else if (myRole === 'jailor') {
        const jailedTarget = (gamePlayers || []).find(p => p.jailedBy === socket.id);
        const jailedText = jailedTarget ? jailedTarget.username : 'None';
        lines.push(`<span style="color:#ff9f0a; font-size:16px;">Jailed Player: ${jailedText}</span>`);
    }

    roleEl.innerHTML = lines.join('<br>');
}

function renderActionPanel() {
    const outerManifestList = document.getElementById('playersActionList');
    outerManifestList.innerHTML = '';
    
    const innerActionWrapper = document.getElementById('roleActionsWrapper');
    innerActionWrapper.innerHTML = '';
    
    const me = gamePlayers.find(p => p.id === socket.id);
    if (!me) return;
    
    document.getElementById('meetCount').innerText = me.meetingsLeft;

    if (me.status === 'dead') {
        outerManifestList.innerHTML = '<div style="color:#ff453a; font-weight:bold;">YOU ARE DEAD (GHOST MODE)</div>';
        document.getElementById('taskModuleWrapper').classList.add('hidden');
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
        let statusText = p.status.toUpperCase();
        let bgColor = 'transparent';
        let textColor = p.status === 'alive' ? '#30d158' : '#ff453a';
        if (p.status === 'dead') {
            bgColor = 'rgba(255, 59, 48, 0.2)';
        }
        card.style.backgroundColor = bgColor;
        card.innerHTML = `<span style="color:${p.status==='alive'?'white':'#ff453a'};">${p.username}</span><span style="color:${textColor};">${statusText}</span>`;
        outerManifestList.appendChild(card);

        if (p.id !== socket.id && p.status === 'alive' && canAct) {
            if (myRole === 'imposter') {
                if (p.role !== 'imposter') {
                    let btn = document.createElement('button');
                    btn.className = 'btn btn-kill';
                    btn.innerText = `Kill ${p.username}`;
                    btn.onclick = () => { socket.emit('actionKill', { room: currentRoom, targetId: p.id }); startLocalCooldown(90); };
                    innerActionWrapper.appendChild(btn);
                }
            } else if (myRole === 'sheriff') {
                let btn = document.createElement('button');
                btn.className = 'btn btn-kill';
                btn.style.background = "#0a84ff";
                btn.innerText = `Execute ${p.username}`;
                btn.onclick = () => { 
                    socket.emit('actionSheriffKill', { room: currentRoom, targetId: p.id }); 
                    sheriffCooldownLeft = 30; 
                    startSheriffCooldownLoop(); 
                };
                innerActionWrapper.appendChild(btn);
            }
        }
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
    const me = gamePlayers.find(p => p.id === socket.id);
    if (!me || me.role !== 'jailor') return;
    
    const jailedTarget = gamePlayers.find(p => p.jailedBy === socket.id);
    if (jailedTarget) {
        socket.emit('actionExecute', { room: currentRoom, targetId: jailedTarget.id });
    }
};

socket.on('playerJailed', () => {
    alert('You have been jailed by the Jailor! They can execute you during a meeting.');
});

socket.on('shieldBlocked', (data) => {
    const targetName = data.targetName || 'Someone';
    if (data.isTarget) {
        document.getElementById('systemMessages').innerText = 'You were protected by a shield';
    } else {
        document.getElementById('systemMessages').innerText = `${targetName} was protected by a shield`;
    }
});

socket.on('votesReset', () => {
    selectedVoteTarget = null;
    const oldTick = document.getElementById('voteConfirmTick');
    if (oldTick) oldTick.remove();
    document.querySelectorAll('#voteList .btn-confirm').forEach(b => b.remove());
});

socket.on('updateGame', (players) => {
    gamePlayers = players;
    renderPrivacyPanel();
    const me = players.find(p => p.id === socket.id);
    if (me && myRole !== 'imposter') {
        myTasksCompleted = me.tasksCompleted || 0;
        myTasksRequired = me.tasksRequired || myTasksRequired;
    }
    renderActionPanel();
    if (meetingPhase === 'discuss') {
        renderVotingPanel();
    }
});

socket.on('meetingCalled', (data) => {
    meetingPhase = 'gather';
    selectedVoteTarget = null;
    myVoteTargetId = null;
    myVoteTargetName = '';
    meetingEndedPendingPlayers = null;
    voteTallyAnimationActive = false;
    clearTimeout(voteTallyAnimationTimer);
    clearInterval(cooldownTimer);
    clearInterval(meetingTimerInterval);
    clearInterval(sheriffTimerInterval);

    privacyOpen = false;
    document.getElementById('privacyContainer').classList.add('hidden');
    document.getElementById('togglePrivacyBtn').innerText = "👀 Reveal Role Information";
    document.getElementById('togglePrivacyBtn').style.background = "#0a84ff";

    document.getElementById('gameScreen').classList.add('hidden');
    document.getElementById('meetingScreen').classList.remove('hidden');
    
    document.getElementById('votingUI').classList.add('hidden');
    document.getElementById('jailorExecuteUI').classList.add('hidden');
    document.getElementById('gatherPrompt').classList.remove('hidden'); 
    document.getElementById('meetingTimer').innerText = '--';
    document.getElementById('voteTallyAnimation').classList.add('hidden');
    document.getElementById('voteTallyAnimation').innerHTML = '';
    const existingNotice = document.getElementById('voteStatusNotice');
    if (existingNotice) existingNotice.remove();
    
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
    document.getElementById('jailorExecuteUI').classList.add('hidden');
    
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

    const existingNotice = document.getElementById('voteStatusNotice');
    if (existingNotice) existingNotice.remove();
    if (myVoteTargetId) {
        const notice = document.createElement('div');
        notice.id = 'voteStatusNotice';
        notice.style.marginBottom = '10px';
        notice.style.color = '#30d158';
        notice.style.fontWeight = 'bold';
        notice.innerText = myVoteTargetId === 'skip' ? 'You voted to skip.' : `You voted for ${myVoteTargetName}.`;
        container.appendChild(notice);
    }

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
            let buttonText = p.username;
            if (myVoteTargetId === p.id) {
                buttonText += ' ✓';
                btn.disabled = true;
                btn.style.opacity = '0.9';
            }
            if (p.jailedBy === socket.id) {
                buttonText += ' (YOU JAILED)';
            } else if (p.jailedBy) {
                buttonText += ' (JAILED)';
            }
            btn.innerText = buttonText;
            btn.onclick = () => window.selectVoteTarget(p.id, rowDiv);
            
            rowDiv.appendChild(btn);
            
            if (myRole === 'jailor' && p.jailedBy === socket.id) {
                let execBtn = document.createElement('button');
                execBtn.className = 'btn btn-kill';
                execBtn.style.flex = '0';
                execBtn.style.width = '80px';
                execBtn.style.margin = '0 0 0 10px';
                execBtn.id = `execute-btn-${p.id}`;
                execBtn.innerText = 'Execute';
                execBtn.onclick = (e) => {
                    e.stopPropagation();
                    socket.emit('actionExecute', { room: currentRoom, targetId: p.id });
                    execBtn.style.display = 'none';
                    selectedVoteTarget = null;
                    document.querySelectorAll('#voteList button').forEach(b => {
                        if (b.id.startsWith('vote-btn-')) b.disabled = false;
                        if (b.id.startsWith('execute-btn-')) b.disabled = true;
                    });
                    const oldTick = document.getElementById('voteConfirmTick');
                    if (oldTick) oldTick.remove();
                };
                rowDiv.appendChild(execBtn);
            }
            
            container.appendChild(rowDiv);
        } else {
            let rowDiv = document.createElement('div');
            rowDiv.style.display = 'flex';
            rowDiv.style.alignItems = 'center';
            rowDiv.style.margin = '5px 0';
            rowDiv.id = `vote-row-${p.id}`;
            rowDiv.style.opacity = '0.6';

            let btn = document.createElement('button');
            btn.className = 'btn btn-alt';
            btn.style.margin = '0';
            btn.style.flex = '1';
            btn.style.background = '#ff453a';
            btn.style.color = 'white';
            btn.id = `vote-btn-${p.id}`;
            btn.innerText = `${p.username} (DEAD)`;
            btn.disabled = true;
            
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

    const targetPlayer = gamePlayers.find(p => p.id === selectedVoteTarget);
    myVoteTargetId = selectedVoteTarget;
    myVoteTargetName = targetPlayer ? targetPlayer.username : 'skip';

    socket.emit('submitVote', { room: currentRoom, targetId: selectedVoteTarget });
    
    document.getElementById('skipVoteBtn').className = 'hidden';
    const oldTick = document.getElementById('voteConfirmTick');
    if (oldTick) oldTick.remove();
    
    document.querySelectorAll('#voteList button').forEach(btn => {
        if(btn.id !== 'voteConfirmTick') {
            btn.disabled = true;
            btn.onclick = null;
        }
    });

    const selectedBtn = document.getElementById(`vote-btn-${selectedVoteTarget}`);
    if (selectedBtn) {
        selectedBtn.innerText = `${selectedBtn.innerText.replace(/ ✓$/, '')} ✓`;
        selectedBtn.style.opacity = '0.9';
    }

    const notice = document.getElementById('voteStatusNotice');
    if (notice) notice.remove();

    let statusNotice = document.createElement('div');
    statusNotice.id = 'voteStatusNotice';
    statusNotice.style.marginBottom = '10px';
    statusNotice.style.color = '#30d158';
    statusNotice.style.fontWeight = 'bold';
    statusNotice.innerText = myVoteTargetId === 'skip' ? 'You voted to skip.' : `You voted for ${myVoteTargetName}.`;
    document.getElementById('voteList').prepend(statusNotice);
};

socket.on('voteCastFeedback', (data) => {
    const targetRow = document.getElementById(`vote-row-${data.voterId}`);
    if (targetRow && !document.getElementById(`checkmark-${data.voterId}`)) {
        let check = document.createElement('span');
        check.id = `checkmark-${data.voterId}`;
        check.innerText = ' ✅';
        check.style.marginLeft = '10px';
        check.style.fontSize = '20px';
        targetRow.appendChild(check);
    }
});

socket.on('playerEjected', (result) => {
    document.getElementById('meetingStatus').innerText = `Assembly Result: ${result} was exiled.`;
});

socket.on('meetingOutcome', (data) => {
    alert(`📋 Meeting Outcome: ${data.message}`);
});

function showVoteTallyAnimation(tally) {
    const container = document.getElementById('voteTallyAnimation');
    if (!container) return;

    voteTallyAnimationActive = true;
    clearTimeout(voteTallyAnimationTimer);
    container.classList.remove('hidden');
    container.innerHTML = '<h3 style="margin-top:0;color:#ff9f0a;">Vote tally</h3>' +
        (tally.length ? tally.map(item => `
            <div class="vote-tally-item">
                <span>${item.username}</span>
                <span class="vote-tally-value" data-target="${item.count}">0</span>
            </div>`).join('') : '<div style="color:#8e8e93;">No votes were cast.</div>');

    const counters = container.querySelectorAll('.vote-tally-value');
    counters.forEach(counter => {
        const target = parseInt(counter.dataset.target || '0', 10);
        let current = 0;
        const tick = () => {
            current = Math.min(target, current + 1);
            counter.innerText = current;
            if (current < target) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    });

    voteTallyAnimationTimer = setTimeout(() => {
        voteTallyAnimationActive = false;
        container.classList.add('hidden');
        container.innerHTML = '';
        if (meetingEndedPendingPlayers) {
            const pendingPlayers = meetingEndedPendingPlayers;
            meetingEndedPendingPlayers = null;
            finalizeMeetingTransition(pendingPlayers);
        }
    }, 1800);
}

function finalizeMeetingTransition(players) {
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
    }

    if (myRole === 'sheriff') {
        clearInterval(sheriffTimerInterval);
        sheriffCooldownLeft = 0;
        startSheriffCooldownLoop();
    } else {
        startLocalCooldown((myRole === 'imposter') ? 90 : 0);
    }

    renderActionPanel();
}

socket.on('meetingVoteTally', (data) => {
    showVoteTallyAnimation(data.tally || []);
});

socket.on('meetingEnded', (players) => {
    if (voteTallyAnimationActive) {
        meetingEndedPendingPlayers = players;
        return;
    }
    finalizeMeetingTransition(players);
});

socket.on('gameOverState', (data) => {
    clearInterval(cooldownTimer);
    clearInterval(taskTimer);
    clearInterval(meetingTimerInterval);
    clearInterval(sheriffTimerInterval);
    
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('lobbyScreen').classList.add('hidden');
    document.getElementById('gameScreen').classList.add('hidden');
    document.getElementById('meetingScreen').classList.add('hidden');
    
    const goScreen = document.getElementById('gameOverScreen');
    const winHeader = document.getElementById('winHeader');
    
    goScreen.classList.remove('hidden');
    winHeader.innerText = `${data.winner.split(' ')[0]} Victory!`.toUpperCase();
    let winColor = '#ff453a'; // default imposter red
    if (data.winner.startsWith('Crewmates')) winColor = '#0a84ff'; // crewmates blue
    else if (data.winner.startsWith('Jester')) winColor = '#a855f7'; // jester purple
    winHeader.style.color = winColor;
    document.getElementById('winDetails').innerText = data.winner;
    
    if (amIHost) {
        document.getElementById('returnLobbyBtn').classList.remove('hidden');
        document.getElementById('waitingHostText').classList.add('hidden');
    } else {
        document.getElementById('returnLobbyBtn').classList.add('hidden');
        document.getElementById('waitingHostText').classList.remove('hidden');
    }
});