// Main app controller for WordWeft web client
const App = (() => {
    let pendingAction = null;

    async function init() {
        await Auth.init();
        await Auth.ensureSignedIn();
        Auth.updateUI();

        // Check URL params for room code (shared link)
        const params = new URLSearchParams(window.location.search);
        const roomParam = params.get('room');
        if (roomParam) {
            requireProfile(() => joinRoom(roomParam));
        }

        bindEvents();
    }

    function bindEvents() {
        // Home screen buttons
        document.getElementById('btn-join').addEventListener('click', () => {
            requireProfile(() => {
                document.getElementById('join-dialog').classList.remove('hidden');
                document.getElementById('room-code-input').value = '';
                document.getElementById('room-code-input').focus();
            });
        });

        document.getElementById('btn-create').addEventListener('click', () => {
            requireProfile(() => createRoom());
        });

        // Join dialog
        document.getElementById('btn-join-cancel').addEventListener('click', () => {
            document.getElementById('join-dialog').classList.add('hidden');
        });

        document.getElementById('room-code-input').addEventListener('input', (e) => {
            const val = e.target.value.toUpperCase();
            e.target.value = val;
            document.getElementById('btn-join-confirm').disabled = val.trim().length < 6;
        });

        document.getElementById('btn-join-confirm').addEventListener('click', () => {
            const code = document.getElementById('room-code-input').value.trim();
            document.getElementById('join-dialog').classList.add('hidden');
            joinRoom(code);
        });

        // Enter key in room code input
        document.getElementById('room-code-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                document.getElementById('btn-join-confirm').click();
            }
        });

        // Name dialog
        setupNameDialog();

        // Google sign-in
        document.getElementById('btn-google-signin').addEventListener('click', async () => {
            await Auth.signInWithGoogle();
        });

        // Lobby
        document.getElementById('btn-lobby-back').addEventListener('click', () => {
            Room.leave();
            Game.cleanup();
            showScreen('home');
        });

        document.getElementById('btn-copy-code').addEventListener('click', () => {
            const code = document.getElementById('lobby-room-code').textContent;
            navigator.clipboard.writeText(code).then(() => {
                const btn = document.getElementById('btn-copy-code');
                btn.textContent = 'Copied!';
                setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
            });
        });

        document.getElementById('btn-start-game').addEventListener('click', () => {
            Room.startGame('ONE_WORD', 0);
        });

        // Game input
        document.getElementById('word-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                Game.submitWord(e.target.value);
            }
        });

        // Typing indicator
        let typingTimeout = null;
        document.getElementById('word-input').addEventListener('input', () => {
            Room.setTyping(Room.myIndex, true);
            if (typingTimeout) clearTimeout(typingTimeout);
            typingTimeout = setTimeout(() => {
                Room.setTyping(Room.myIndex, false);
            }, 3000);
        });

        document.getElementById('btn-submit-word').addEventListener('click', () => {
            const input = document.getElementById('word-input');
            Game.submitWord(input.value);
        });

        document.getElementById('btn-vote-finish').addEventListener('click', () => {
            Game.toggleFinishVote();
        });

        // Results
        document.getElementById('btn-play-again').addEventListener('click', () => {
            Room.leave();
            Game.cleanup();
            showScreen('home');
        });

        document.getElementById('btn-go-home').addEventListener('click', () => {
            Room.leave();
            Game.cleanup();
            showScreen('home');
        });
    }

    function setupNameDialog() {
        const grid = document.getElementById('avatar-grid');
        let selectedAvatar = '';

        Auth.AVATARS.forEach(emoji => {
            const option = document.createElement('div');
            option.className = 'avatar-option';
            option.textContent = emoji;
            option.addEventListener('click', () => {
                grid.querySelectorAll('.avatar-option').forEach(el => el.classList.remove('selected'));
                if (selectedAvatar === emoji) {
                    selectedAvatar = '';
                } else {
                    selectedAvatar = emoji;
                    option.classList.add('selected');
                }
            });
            grid.appendChild(option);
        });

        document.getElementById('player-name-input').addEventListener('input', (e) => {
            document.getElementById('btn-name-confirm').disabled = e.target.value.trim().length === 0;
        });

        document.getElementById('player-name-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.target.value.trim()) {
                document.getElementById('btn-name-confirm').click();
            }
        });

        document.getElementById('btn-name-cancel').addEventListener('click', () => {
            document.getElementById('name-dialog').classList.add('hidden');
            pendingAction = null;
        });

        document.getElementById('btn-name-confirm').addEventListener('click', () => {
            const name = document.getElementById('player-name-input').value.trim();
            if (!name) return;
            Auth.saveLocalProfile(name, selectedAvatar);
            Auth.saveProfileToFirebase();
            Auth.updateUI();
            document.getElementById('name-dialog').classList.add('hidden');
            if (pendingAction) {
                const action = pendingAction;
                pendingAction = null;
                action();
            }
        });
    }

    function requireProfile(action) {
        if (Auth.name) {
            action();
        } else {
            pendingAction = action;
            document.getElementById('player-name-input').value = '';
            document.getElementById('name-dialog').classList.remove('hidden');
            document.getElementById('player-name-input').focus();
        }
    }

    async function createRoom() {
        const color = Auth.PLAYER_COLORS[Math.floor(Math.random() * Auth.PLAYER_COLORS.length)];
        const code = await Room.create(Auth.name, Auth.avatar, color);
        if (code) {
            document.getElementById('lobby-room-code').textContent = code;
            document.getElementById('game-room-code').textContent = code;
            document.getElementById('lobby-host-controls').classList.remove('hidden');
            document.getElementById('lobby-status').textContent = 'Share the room code with friends!';
            Game.startListening();
            showScreen('lobby');
        } else {
            alert('Failed to create room. Please try again.');
        }
    }

    async function joinRoom(code) {
        try {
            const color = Auth.PLAYER_COLORS[Math.floor(Math.random() * Auth.PLAYER_COLORS.length)];
            await Room.join(code, Auth.name, Auth.avatar, color);
            document.getElementById('lobby-room-code').textContent = code.toUpperCase();
            document.getElementById('game-room-code').textContent = code.toUpperCase();
            document.getElementById('lobby-host-controls').classList.add('hidden');
            document.getElementById('lobby-status').textContent = 'Waiting for host to start...';
            Game.startListening();
            showScreen('lobby');
        } catch (e) {
            alert(e.message || 'Failed to join room');
        }
    }

    function showScreen(name) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        const screen = document.getElementById('screen-' + name);
        if (screen) screen.classList.add('active');

        // Clean up URL params when leaving game
        if (name === 'home') {
            window.history.replaceState({}, '', window.location.pathname);
        }
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    return {
        showScreen,
        requireProfile
    };
})();
