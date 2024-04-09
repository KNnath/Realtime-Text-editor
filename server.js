// server.js

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

// CRDT class for conflict-free replicated data types
class CRDT {
    constructor(siteId) {
        this.siteId = siteId;
        this.counter = 0;
        this.positions = new Map();
    }

    insert(char, index) {
        const position = this.generatePosition();
        this.positions.set(position, char);
        return position;
    }

    delete(position) {
        this.positions.delete(position);
    }

    generatePosition() {
        const timestamp = Date.now().toString(36);
        const id = (this.counter++).toString(36);
        return `${timestamp}_${this.siteId}_${id}`;
    }

    getPositionRelativeTo(index) {
        const positionArray = Array.from(this.positions.keys());
        const sortedPositions = positionArray.sort();
        return sortedPositions[index];
    }
}

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve Monaco Editor files
app.use('/vs', express.static(path.join(__dirname, 'node_modules/monaco-editor/min/vs')));

// Object to store editor content and connected users for each room
const rooms = {};

// Keep track of connected users, their cursors, and highlights
const userCursors = {};
const userHighlights = {};

// Keep track of typing status for each user
const userTypingStatus = {};

// Socket.io connection
io.on('connection', (socket) => {
    console.log('New client connected');

    // Receive join room request
    socket.on('joinRoom', ({ roomId, username }) => {
        socket.join(roomId);
        console.log(`${username} joined room ${roomId}`);

        // Store user in the room if not already present
        if (!rooms[roomId]) {
            rooms[roomId] = { users: [] };
        }
        if (!rooms[roomId].users.includes(username)) {
            rooms[roomId].users.push(username);
        }

        // Send current editor content and list of users to the newly joined user
        if (rooms[roomId].editorContent) {
            socket.emit('updateEditor', rooms[roomId].editorContent);
        }
        io.to(roomId).emit('updateUserList', rooms[roomId].users);
    });

    // Receive text changes from client
    socket.on('textChange', ({ roomId, newText }) => {
        // Update editor content for the room
        rooms[roomId].editorContent = newText;
        // Broadcast changes to all clients in the room
        io.to(roomId).emit('updateEditor', newText);
    });

    // Handle client disconnection
    socket.on('disconnect', () => {
        console.log('Client disconnected');

        // Find and remove user from the room
        for (const roomId in rooms) {
            const index = rooms[roomId].users.indexOf(socket.username);
            if (index !== -1) {
                rooms[roomId].users.splice(index, 1);
                io.to(roomId).emit('updateUserList', rooms[roomId].users);
                break;
            }
        }
    });

    // Handle leave room event
    socket.on('leaveRoom', ({ roomId, username }) => {
        // Remove user from the room
        if (rooms[roomId]) {
            const index = rooms[roomId].users.indexOf(username);
            if (index !== -1) {
                rooms[roomId].users.splice(index, 1);
                io.to(roomId).emit('updateUserList', rooms[roomId].users);
            }
        }
    });

    // Receive mouse movement data from client
    socket.on('mouseMove', ({ roomId, username, position }) => {
        // Broadcast mouse movement data to all clients in the room except the sender
        socket.to(roomId).emit('updateMousePointer', { username, position });
    });

    // Receive highlight text data from client
    socket.on('highlightText', ({ roomId, username, selectedText, selectionRange }) => {
        // Broadcast highlight data to all clients in the room except the sender
        socket.to(roomId).emit('updateHighlight', { username, selectedText, selectionRange });
    });

    // Handle turning off highlight when selection is empty
    socket.on('turnOffHighlight', ({ roomId, username }) => {
        // Broadcast to all clients in the room to remove the highlight
        socket.to(roomId).emit('removeHighlight', { username });
    });

    // Handle typing start event from client
    socket.on('typingStart', ({ roomId, username }) => {
        // Set user's typing status to true
        userTypingStatus[roomId] = userTypingStatus[roomId] || {};
        userTypingStatus[roomId][username] = true;
        // Broadcast typing status to all other clients in the room
        socket.to(roomId).emit('updateTypingStatus', { username, isTyping: true });
    });

    // Handle typing stop event from client
    socket.on('typingStop', ({ roomId, username }) => {
        // Set user's typing status to false
        userTypingStatus[roomId] = userTypingStatus[roomId] || {};
        userTypingStatus[roomId][username] = false;
        // Broadcast typing status to all other clients in the room
        socket.to(roomId).emit('updateTypingStatus', { username, isTyping: false });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
