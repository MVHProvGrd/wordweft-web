// Room management module for WordWeft web client
const Room = (() => {
    let roomCode = '';
    let roomRef = null;
    let listeners = [];
    let isHost = false;
    let myPlayerIndex = -1;
    let connectedListener = null;

    // Re-assert isConnected when Firebase reconnects (prevents false disconnects)
    function setupConnectionMonitor() {
        if (connectedListener) {
            db.ref('.info/connected').off('value', connectedListener);
        }
        connectedListener = db.ref('.info/connected').on('value', (snap) => {
            if (snap.val() === true && roomRef && myPlayerIndex >= 0) {
                const connRef = roomRef.child('players/' + myPlayerIndex + '/isConnected');
                connRef.set(true);
                connRef.onDisconnect().set(false);
            }
        });
    }

    const PREFIXES = ['WEFT', 'YARN', 'TALE', 'WORD', 'PLOT', 'SAGA', 'MYTH', 'LORE'];

    function generateCode() {
        const prefix = PREFIXES[Math.floor(Math.random() * PREFIXES.length)];
        const suffix = Math.floor(1000 + Math.random() * 9000);
        return prefix + suffix;
    }

    async function create(name, avatar, color) {
        const uid = Auth.uid;
        if (!uid) return null;

        // Try up to 3 codes
        for (let i = 0; i < 3; i++) {
            const code = generateCode();
            const ref = db.ref('rooms/' + code);
            try {
                const existing = await ref.child('meta').once('value');
                if (existing.exists()) continue;

                await ref.child('meta').set({
                    hostId: uid,
                    hostName: name,
                    createdAt: firebase.database.ServerValue.TIMESTAMP,
                    gameMode: 'ONE_WORD',
                    turnTimerSeconds: 0,
                    hiddenObjectivesEnabled: false,
                    isStarted: false,
                    isFinished: false,
                    maxPlayers: 8
                });

                await ref.child('players/0').set({
                    uid: uid,
                    name: name,
                    color: color,
                    avatar: avatar,
                    isAI: false,
                    isHost: true,
                    isConnected: true
                });

                // Disconnect cleanup
                ref.child('players/0/isConnected').onDisconnect().set(false);

                roomCode = code;
                roomRef = ref;
                isHost = true;
                myPlayerIndex = 0;
                saveActiveRoom();
                setupConnectionMonitor();

                return code;
            } catch (e) {
                console.error('Failed to create room:', e);
            }
        }
        return null;
    }

    async function join(code, name, avatar, color) {
        const uid = Auth.uid;
        if (!uid) return false;

        code = code.toUpperCase().trim();
        const ref = db.ref('rooms/' + code);

        try {
            const meta = await ref.child('meta').once('value');
            if (!meta.exists()) {
                throw new Error('Room not found');
            }
            if (meta.val().isStarted) {
                throw new Error('Game already started');
            }

            const playersSnap = await ref.child('players').once('value');
            const existingCount = playersSnap.numChildren();
            const maxPlayers = meta.val().maxPlayers || 8;
            if (existingCount >= maxPlayers) {
                throw new Error('Room is full');
            }

            // Auto-switch color if already taken
            const existingPlayers = playersSnap.val() || {};
            const takenColors = new Set(Object.values(existingPlayers).map(p => p.color));
            if (takenColors.has(color)) {
                const ALL_COLORS = [0xFF6366F1, 0xFFEC4899, 0xFF10B981, 0xFFF59E0B, 0xFF8B5CF6, 0xFF06B6D4, 0xFFEF4444, 0xFF84CC16];
                color = ALL_COLORS.find(c => !takenColors.has(c)) || color;
            }

            const playerIndex = existingCount;
            await ref.child('players/' + playerIndex).set({
                uid: uid,
                name: name,
                color: color,
                avatar: avatar,
                isAI: false,
                isHost: false,
                isConnected: true
            });

            ref.child('players/' + playerIndex + '/isConnected').onDisconnect().set(false);

            roomCode = code;
            roomRef = ref;
            isHost = false;
            myPlayerIndex = playerIndex;
            saveActiveRoom();
            setupConnectionMonitor();

            return true;
        } catch (e) {
            console.error('Failed to join room:', e);
            throw e;
        }
    }



    function listen(path, callback) {
        if (!roomRef) return;
        const ref = roomRef.child(path);
        ref.on('value', callback);
        listeners.push({ ref, callback });
    }

    function stopListening() {
        listeners.forEach(({ ref, callback }) => {
            ref.off('value', callback);
        });
        listeners = [];
    }

    async function submitWord(word, playerId) {
        if (!roomRef) return;
        const snap = await roomRef.child('words').once('value');
        const nextIndex = snap.numChildren();
        await roomRef.child('words/' + nextIndex).set({
            word: word,
            playerId: playerId,
            position: nextIndex
        });
    }

    async function advanceTurn(nextPlayerIndex, wordsNeeded) {
        if (!roomRef) return;
        await roomRef.child('turn').set({
            currentPlayerIndex: nextPlayerIndex,
            turnWordCount: 0,
            turnWordsNeeded: wordsNeeded,
            timerStartedAt: firebase.database.ServerValue.TIMESTAMP
        });
        await roomRef.child('typing').remove();
    }

    async function updateTurnWordCount(count) {
        if (!roomRef) return;
        await roomRef.child('turn/turnWordCount').set(count);
    }

    async function voteFinish(playerId) {
        if (!roomRef) return;
        await roomRef.child('votes/finish/' + playerId).set(true);
    }

    async function unvoteFinish(playerId) {
        if (!roomRef) return;
        await roomRef.child('votes/finish/' + playerId).remove();
    }

    function setTyping(playerId, typing) {
        if (!roomRef) return;
        if (typing) {
            roomRef.child('typing/' + playerId).set(true);
        } else {
            roomRef.child('typing/' + playerId).remove();
        }
    }

    async function postResult(result) {
        if (!roomRef) return;
        await roomRef.child('result').set(result);
        await roomRef.child('meta/isFinished').set(true);
    }

    async function pauseGame() {
        if (!roomRef) return;
        await roomRef.child('meta/isPaused').set(true);
        await roomRef.child('meta/pausedAt').set(firebase.database.ServerValue.TIMESTAMP);
    }

    async function unpauseGame() {
        if (!roomRef) return;
        await roomRef.child('meta/isPaused').set(false);
        await roomRef.child('meta/pausedAt').remove();
    }

    async function startGame(gameMode, turnTimerSeconds) {
        if (!roomRef || !isHost) return;
        await roomRef.child('meta/isStarted').set(true);
        await roomRef.child('meta/gameMode').set(gameMode);
        await roomRef.child('meta/turnTimerSeconds').set(turnTimerSeconds);
        await roomRef.child('turn').set({
            currentPlayerIndex: 0,
            turnWordCount: 0,
            turnWordsNeeded: gameMode === 'ONE_WORD' ? 1 :
                             gameMode === 'THREE_WORDS' ? 3 :
                             gameMode === 'FIVE_WORDS' ? 5 : 0,
            timerStartedAt: firebase.database.ServerValue.TIMESTAMP
        });
    }

    function saveActiveRoom() {
        try {
            localStorage.setItem('wordweft_active_room', JSON.stringify({
                code: roomCode,
                playerIndex: myPlayerIndex,
                timestamp: Date.now()
            }));
        } catch (e) {}
    }

    function clearActiveRoom() {
        try { localStorage.removeItem('wordweft_active_room'); } catch (e) {}
    }

    function getActiveRoom() {
        try {
            const data = JSON.parse(localStorage.getItem('wordweft_active_room'));
            if (!data || !data.code) return null;
            // Expire after 2 hours
            if (Date.now() - data.timestamp > 2 * 60 * 60 * 1000) {
                clearActiveRoom();
                return null;
            }
            return data;
        } catch (e) { return null; }
    }

    async function rejoin(code, playerIdx) {
        const uid = Auth.uid;
        if (!uid) return false;

        const ref = db.ref('rooms/' + code);
        try {
            const meta = await ref.child('meta').once('value');
            if (!meta.exists()) return false;
            if (meta.val().isFinished) return false;

            // Verify player slot
            const playerSnap = await ref.child('players/' + playerIdx).once('value');
            if (!playerSnap.exists()) return false;
            if (playerSnap.val().uid !== uid) return false;

            // Reconnect
            await ref.child('players/' + playerIdx + '/isConnected').set(true);
            ref.child('players/' + playerIdx + '/isConnected').onDisconnect().set(false);

            roomCode = code;
            roomRef = ref;
            isHost = meta.val().hostId === uid;
            myPlayerIndex = playerIdx;
            setupConnectionMonitor();
            saveActiveRoom();

            // Unpause if game was paused (2-player disconnect)
            if (meta.val().isPaused) {
                await unpauseGame();
            }

            return true;
        } catch (e) {
            console.error('Failed to rejoin room:', e);
            return false;
        }
    }

    function leave() {
        stopListening();
        clearActiveRoom();
        if (connectedListener) {
            db.ref('.info/connected').off('value', connectedListener);
            connectedListener = null;
        }
        roomRef = null;
        roomCode = '';
        isHost = false;
        myPlayerIndex = -1;
    }

    async function deleteRoom() {
        const code = roomCode;
        leave();
        if (code) {
            try {
                await db.ref('rooms/' + code).remove();
            } catch (e) {
                console.error('Failed to delete room:', e);
            }
        }
    }

    return {
        create,
        join,
        rejoin,
        listen,
        stopListening,
        submitWord,
        advanceTurn,
        updateTurnWordCount,
        voteFinish,
        unvoteFinish,
        setTyping,
        postResult,
        startGame,
        pauseGame,
        unpauseGame,
        leave,
        deleteRoom,
        saveActiveRoom,
        clearActiveRoom,
        getActiveRoom,
        get code() { return roomCode; },
        get ref() { return roomRef; },
        get isHost() { return isHost; },
        get myIndex() { return myPlayerIndex; },
        set myIndex(v) { myPlayerIndex = v; }
    };
})();
