const socket = io();
let currentRoom = '';

function createRoom() {
    socket.emit('createRoom', { username: document.getElementById('username').value });
}

function joinRoom() {
    currentRoom = document.getElementById('roomCode').value;
    socket.emit('joinLobby', { username: document.getElementById('username').value, room: currentRoom });
}

socket.on('roomCreated', (data) => {
    currentRoom = data.room;
    alert("Room Created: " + currentRoom);
});

socket.on('gameStarted', (data) => {
    document.getElementById('lobbyScreen').classList.add('hidden');
    document.getElementById('gameScreen').classList.remove('hidden');
    document.getElementById('roleDisplay').innerText = "Role: " + data.role;
});

socket.on('joinError', (err) => alert(err));