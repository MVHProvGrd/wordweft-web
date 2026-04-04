// Main app controller for WordWeft web client
const App = (() => {
    let pendingAction = null;

    async function init() {
        await Auth.init();
        await Auth.ensureSignedIn();
        Auth.updateUI();

        // Load saved preferences
        const savedColor = localStorage.getItem('wordweft_color');
        if (savedColor) selectedColor = parseInt(savedColor);
        if (Auth.uid) {
            try {
                const profSnap = await db.ref('users/' + Auth.uid + '/profile').once('value');
                const prof = profSnap.val() || {};
                if (prof.color) { selectedColor = prof.color; localStorage.setItem('wordweft_color', prof.color); }
                if (prof.musicStyle) { selectedMusicStyle = prof.musicStyle; localStorage.setItem('wordweft_music', prof.musicStyle); }
                if (prof.waitingMusic) { selectedWaitingMusic = prof.waitingMusic; localStorage.setItem('wordweft_waiting_music', prof.waitingMusic); }
            } catch (e) {}
        }

        // Check URL params for room code (shared link)
        const params = new URLSearchParams(window.location.search);
        const roomParam = params.get('room');
        if (roomParam) {
            requireProfile(() => joinRoom(roomParam));
        }

        bindEvents();

        // Start home music on first user interaction (AudioContext needs gesture)
        const startHomeMusic = () => {
            if (typeof Sound !== 'undefined') Sound.startMusic(selectedMusicStyle || 'jazz');
            document.removeEventListener('click', startHomeMusic);
            document.removeEventListener('touchstart', startHomeMusic);
        };
        document.addEventListener('click', startHomeMusic, { once: true });
        document.addEventListener('touchstart', startHomeMusic, { once: true });
    }

    function bindEvents() {
        // Home screen buttons
        document.getElementById('btn-join').addEventListener('click', () => {
            if (typeof Sound !== 'undefined') Sound.playClick();
            requireProfile(() => {
                document.getElementById('join-dialog').classList.remove('hidden');
                document.getElementById('room-code-input').value = '';
                document.getElementById('room-code-input').focus();
            });
        });

        document.getElementById('btn-create').addEventListener('click', () => {
            if (typeof Sound !== 'undefined') Sound.playClick();
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

        // Sign out
        document.getElementById('btn-sign-out').addEventListener('click', async () => {
            await Auth.signOut();
        });

        // Lobby
        document.getElementById('btn-lobby-back').addEventListener('click', () => {
            if (typeof Sound !== 'undefined') Sound.stopMusic();
            Room.leave();
            Game.cleanup();
            showScreen('home');
        });

        // Lobby music toggle
        let lobbyMusicOn = true;
        document.getElementById('btn-lobby-music').addEventListener('click', () => {
            lobbyMusicOn = !lobbyMusicOn;
            const btn = document.getElementById('btn-lobby-music');
            if (lobbyMusicOn) {
                btn.classList.remove('muted');
                if (typeof Sound !== 'undefined') Sound.startMusic(selectedMusicStyle || 'jazz');
            } else {
                btn.classList.add('muted');
                if (typeof Sound !== 'undefined') Sound.stopMusic();
            }
        });

        document.getElementById('btn-copy-code').addEventListener('click', () => {
            if (typeof Sound !== 'undefined') Sound.playClick();
            const code = document.getElementById('lobby-room-code').textContent;
            const inviteText = 'Hey, come play a round of WordWeft with me! \u{1F4DD}\n\nRoom code: ' + code + '\nJoin here: https://wordweft.net?room=' + code;

            if (navigator.share) {
                navigator.share({ text: inviteText }).catch(() => {
                    navigator.clipboard.writeText(inviteText);
                });
            } else {
                navigator.clipboard.writeText(inviteText);
            }
            const btn = document.getElementById('btn-copy-code');
            btn.textContent = 'Copied!';
            setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
        });

        // Game mode selector
        let selectedMode = 'ONE_WORD';
        document.querySelectorAll('.btn-mode').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.btn-mode').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                selectedMode = btn.dataset.mode;
            });
        });

        // Story starter selector
        document.querySelectorAll('.btn-starter').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.btn-starter').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                selectedStarter = btn.dataset.starter;
            });
        });

        // Timer selector
        document.querySelectorAll('.btn-timer').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.btn-timer').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                selectedTimer = parseInt(btn.dataset.timer) || 0;
            });
        });

        // Hidden objectives toggle
        document.getElementById('toggle-objectives').addEventListener('change', (e) => {
            objectivesEnabled = e.target.checked;
        });

        document.getElementById('btn-start-game').addEventListener('click', () => {
            if (typeof Sound !== 'undefined') { Sound.stopMusic(); Sound.playGameStart(); }
            // Submit story starter words first
            if (selectedStarter) {
                const starterWords = selectedStarter.split(/\s+/);
                (async () => {
                    for (const w of starterWords) {
                        await Room.submitWord(w, -1);
                    }
                })();
            }
            // Generate hidden objectives if enabled
            if (objectivesEnabled) {
                generateAndPostObjectives();
            }
            Room.startGame(selectedMode, selectedTimer);
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

        // Profile & Leaderboard
        document.getElementById('btn-profile').addEventListener('click', (e) => {
            e.preventDefault();
            loadProfile();
            showScreen('profile');
        });
        document.getElementById('btn-profile-back').addEventListener('click', () => {
            if (typeof Sound !== 'undefined') Sound.stopMusic();
            showScreen('home');
        });
        document.getElementById('btn-leaderboard').addEventListener('click', (e) => {
            e.preventDefault();
            loadLeaderboard('alltime');
            showScreen('leaderboard');
        });
        document.getElementById('btn-leaderboard-back').addEventListener('click', () => {
            showScreen('home');
        });
        document.querySelectorAll('.btn-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.btn-tab').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                loadLeaderboard(btn.dataset.tab);
            });
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

        // Achievements
        document.getElementById('btn-achievements').addEventListener('click', (e) => {
            e.preventDefault();
            loadAchievements();
            showScreen('achievements');
        });
        document.getElementById('btn-achievements-back').addEventListener('click', () => {
            showScreen('home');
        });

        // Story History
        document.getElementById('btn-history').addEventListener('click', (e) => {
            e.preventDefault();
            loadHistory();
            showScreen('history');
        });
        document.getElementById('btn-history-back').addEventListener('click', () => {
            showScreen('home');
        });

        // Friends
        document.getElementById('btn-friends').addEventListener('click', (e) => {
            e.preventDefault();
            loadFriends();
            showScreen('friends');
        });
        document.getElementById('btn-friends-back').addEventListener('click', () => {
            showScreen('home');
        });

        // Tutorial
        let tutorialSlide = 0;
        document.getElementById('btn-tutorial-next').addEventListener('click', () => {
            tutorialSlide++;
            if (tutorialSlide >= 4) {
                localStorage.setItem('wordweft_tutorial_done', '1');
                showScreen('home');
                tutorialSlide = 0;
            } else {
                showTutorialSlide(tutorialSlide);
            }
        });
        document.getElementById('btn-tutorial-skip').addEventListener('click', () => {
            localStorage.setItem('wordweft_tutorial_done', '1');
            showScreen('home');
            tutorialSlide = 0;
        });
        document.querySelectorAll('.tutorial-dot').forEach(dot => {
            dot.addEventListener('click', () => {
                tutorialSlide = parseInt(dot.dataset.slide);
                showTutorialSlide(tutorialSlide);
            });
        });

        // Replay tutorial from profile
        document.getElementById('btn-replay-tutorial').addEventListener('click', () => {
            tutorialSlide = 0;
            showTutorialSlide(0);
            showScreen('tutorial');
        });

        // Waiting music preview
        let waitPreviewPlaying = false;
        document.getElementById('btn-waiting-preview').addEventListener('click', () => {
            const btn = document.getElementById('btn-waiting-preview');
            if (waitPreviewPlaying) {
                Sound.stopMusic();
                btn.innerHTML = '&#9654; Preview';
                waitPreviewPlaying = false;
            } else {
                Sound.startMusic(selectedWaitingMusic || 'jazz');
                btn.innerHTML = '&#9632; Stop';
                waitPreviewPlaying = true;
            }
        });

        // Lobby music preview
        let previewPlaying = false;
        document.getElementById('btn-music-preview').addEventListener('click', () => {
            const btn = document.getElementById('btn-music-preview');
            if (previewPlaying) {
                Sound.stopMusic();
                btn.innerHTML = '&#9654; Preview';
                previewPlaying = false;
            } else {
                Sound.startMusic(selectedMusicStyle || 'jazz');
                btn.innerHTML = '&#9632; Stop';
                previewPlaying = true;
            }
        });

        // Home music selector
        document.querySelectorAll('[data-homemusic]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('[data-homemusic]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                homeMusicMode = btn.dataset.homemusic;
                localStorage.setItem('wordweft_home_music', homeMusicMode);
            });
        });

        // Font size slider
        const fontSlider = document.getElementById('font-size-slider');
        const fontValue = document.getElementById('font-size-value');
        const savedFontSize = localStorage.getItem('wordweft_font_size') || '100';
        fontSlider.value = savedFontSize;
        fontValue.textContent = savedFontSize + '%';
        document.documentElement.style.fontSize = (parseInt(savedFontSize) / 100 * 16) + 'px';
        fontSlider.addEventListener('input', () => {
            const size = fontSlider.value;
            fontValue.textContent = size + '%';
            document.documentElement.style.fontSize = (parseInt(size) / 100 * 16) + 'px';
            localStorage.setItem('wordweft_font_size', size);
        });

        // Show tutorial on first visit
        if (!localStorage.getItem('wordweft_tutorial_done')) {
            setTimeout(() => showScreen('tutorial'), 500);
        }
    }

    // Player colors matching Android app
    const PLAYER_COLORS = [
        { name: 'Indigo', hex: '#6366F1', value: 0xFF6366F1 },
        { name: 'Pink', hex: '#EC4899', value: 0xFFEC4899 },
        { name: 'Emerald', hex: '#10B981', value: 0xFF10B981 },
        { name: 'Amber', hex: '#F59E0B', value: 0xFFF59E0B },
        { name: 'Violet', hex: '#8B5CF6', value: 0xFF8B5CF6 },
        { name: 'Cyan', hex: '#06B6D4', value: 0xFF06B6D4 },
        { name: 'Red', hex: '#EF4444', value: 0xFFEF4444 },
        { name: 'Lime', hex: '#84CC16', value: 0xFF84CC16 }
    ];

    // Story starters matching Android
    const STORY_STARTERS = [
        { emoji: '\u{1F3B2}', label: 'Free Play', text: '' },
        { emoji: '\u{1F451}', label: 'Once Upon a Time', text: 'Once upon a time' },
        { emoji: '\u{1F680}', label: 'Space Adventure', text: 'The spaceship launched into' },
        { emoji: '\u{1F50D}', label: 'Mystery', text: 'The detective found a' },
        { emoji: '\u{1F319}', label: 'Horror Night', text: 'In the dark forest' },
        { emoji: '\u2764\uFE0F', label: 'Love Story', text: 'They first met at' },
        { emoji: '\u2694\uFE0F', label: 'Epic Battle', text: 'The warrior raised their' },
        { emoji: '\u231B', label: 'Time Travel', text: 'The time machine activated and' },
        { emoji: '\u{1F468}\u200D\u{1F373}', label: 'Cooking Disaster', text: 'The chef accidentally added' },
        { emoji: '\u{1F98A}', label: 'Animal Kingdom', text: 'The clever fox decided to' },
        { emoji: '\u{1F9B8}', label: 'Superhero Origin', text: 'The ordinary person suddenly gained' },
        { emoji: '\u{1F3DD}\uFE0F', label: 'Desert Island', text: 'Stranded on the island they' }
    ];

    // Secret word pools matching Android
    const SECRET_WORD_POOLS = {
        Animals: ['elephant', 'penguin', 'dolphin', 'butterfly', 'falcon', 'octopus', 'panther', 'hamster'],
        Food: ['spaghetti', 'chocolate', 'pineapple', 'cinnamon', 'avocado', 'marshmallow', 'pretzel', 'muffin'],
        Nature: ['volcano', 'avalanche', 'rainbow', 'tornado', 'glacier', 'waterfall', 'canyon', 'meadow'],
        Objects: ['umbrella', 'telescope', 'chandelier', 'compass', 'lantern', 'hammock', 'trampoline', 'backpack'],
        Actions: ['vanished', 'shattered', 'whispered', 'stumbled', 'launched', 'discovered', 'escaped', 'transformed']
    };

    let selectedColor = PLAYER_COLORS[0].value;
    let selectedMusicStyle = localStorage.getItem('wordweft_music') || 'jazz';
    let selectedWaitingMusic = localStorage.getItem('wordweft_waiting_music') || 'jazz';
    let homeMusicMode = localStorage.getItem('wordweft_home_music') || 'same';
    let selectedStarter = '';
    let selectedTimer = 0;
    let objectivesEnabled = false;

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

        // Color picker
        const colorGrid = document.getElementById('color-grid');
        PLAYER_COLORS.forEach((c, i) => {
            const option = document.createElement('div');
            option.className = 'color-option' + (i === 0 ? ' selected' : '');
            option.style.background = c.hex;
            option.addEventListener('click', () => {
                colorGrid.querySelectorAll('.color-option').forEach(el => el.classList.remove('selected'));
                option.classList.add('selected');
                selectedColor = c.value;
            });
            colorGrid.appendChild(option);
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

    function generateAndPostObjectives() {
        const categories = Object.keys(SECRET_WORD_POOLS);
        const players = Game.players.length > 0 ? Game.players : [];
        // Use room ref to get player count
        const objectives = {};
        const usedWords = new Set();
        for (let i = 0; i < 8; i++) {
            const cat = categories[Math.floor(Math.random() * categories.length)];
            const pool = SECRET_WORD_POOLS[cat].filter(w => !usedWords.has(w));
            if (pool.length === 0) continue;
            const word = pool[Math.floor(Math.random() * pool.length)];
            usedWords.add(word);
            objectives[i] = { word: word, category: cat, completed: false, busted: false };
        }
        if (Room.ref) {
            Room.ref.child('objectives').set(objectives);
            Room.ref.child('meta/hiddenObjectivesEnabled').set(true);
        }
    }

    async function createRoom() {
        const code = await Room.create(Auth.name, Auth.avatar, selectedColor);
        if (code) {
            document.getElementById('lobby-room-code').textContent = code;
            document.getElementById('game-room-code').textContent = code;
            document.getElementById('lobby-host-controls').classList.remove('hidden');
            document.getElementById('lobby-status').textContent = 'Share the room code with friends!';
            Game.startListening();
            showScreen('lobby');
            if (typeof Sound !== 'undefined') Sound.startMusic(selectedMusicStyle || 'jazz');
        } else {
            alert('Failed to create room. Please try again.');
        }
    }

    async function joinRoom(code) {
        try {
            await Room.join(code, Auth.name, Auth.avatar, selectedColor);
            document.getElementById('lobby-room-code').textContent = code.toUpperCase();
            document.getElementById('game-room-code').textContent = code.toUpperCase();
            document.getElementById('lobby-host-controls').classList.add('hidden');
            document.getElementById('lobby-status').textContent = 'Waiting for host to start...';
            Game.startListening();
            showScreen('lobby');
            if (typeof Sound !== 'undefined') Sound.startMusic(selectedMusicStyle || 'jazz');
        } catch (e) {
            alert(e.message || 'Failed to join room');
        }
    }

    function showScreen(name) {
        // Stop TTS when navigating
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();

        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        const screen = document.getElementById('screen-' + name);
        if (screen) screen.classList.add('active');

        // Clean up URL params when leaving game
        if (name === 'home') {
            window.history.replaceState({}, '', window.location.pathname);
            // Play home screen music (respect home music setting)
            if (typeof Sound !== 'undefined') {
                if (homeMusicMode === 'none') {
                    Sound.stopMusic();
                } else {
                    Sound.startMusic(selectedMusicStyle || 'jazz');
                }
            }
        }
    }

    async function loadProfile() {
        document.getElementById('profile-avatar').textContent = Auth.avatar || '\u{1F60A}';

        // Editable name field
        const nameInput = document.getElementById('profile-name-input');
        const saveBtn = document.getElementById('btn-save-name');
        nameInput.value = Auth.name || '';
        saveBtn.style.display = 'none';
        nameInput.oninput = () => {
            const changed = nameInput.value.trim() !== Auth.name;
            saveBtn.style.display = changed ? 'inline-block' : 'none';
        };
        saveBtn.onclick = () => {
            const newName = nameInput.value.trim();
            if (!newName) return;
            Auth.saveLocalProfile(newName, Auth.avatar);
            Auth.saveProfileToFirebase();
            Auth.updateUI();
            saveBtn.style.display = 'none';
        };

        // Auth section in profile
        const authStatus = document.getElementById('profile-auth-status');
        const googleBtn = document.getElementById('btn-profile-google-signin');
        const signOutBtn = document.getElementById('btn-profile-sign-out');
        if (Auth.user && !Auth.isAnonymous) {
            authStatus.textContent = 'Signed in as ' + (Auth.user.email || Auth.user.displayName);
            googleBtn.classList.add('hidden');
            signOutBtn.classList.remove('hidden');
        } else {
            authStatus.textContent = 'Playing as guest — sign in to sync across devices';
            googleBtn.classList.remove('hidden');
            signOutBtn.classList.add('hidden');
        }
        googleBtn.onclick = async () => {
            await Auth.signInWithGoogle();
            loadProfile(); // refresh
        };
        signOutBtn.onclick = async () => {
            await Auth.signOut();
            loadProfile(); // refresh
        };

        if (!Auth.uid) return;
        try {
            const snap = await db.ref('users/' + Auth.uid + '/stats').once('value');
            const stats = snap.val() || {};
            const xp = stats.totalXp || 0;
            const level = Auth.calculateLevel(xp);
            const rank = Auth.getRank(level);
            const currentLevelXp = xp - Auth.xpForLevel(level);
            const nextLevelXp = Auth.xpForLevel(level + 1) - Auth.xpForLevel(level);
            const progress = nextLevelXp > 0 ? (currentLevelXp / nextLevelXp * 100) : 0;

            document.getElementById('profile-rank').textContent = 'Lv.' + level + ' — ' + rank;
            document.getElementById('profile-xp-fill').style.width = progress + '%';
            document.getElementById('profile-xp-text').textContent = xp + ' / ' + Auth.xpForLevel(level + 1) + ' XP';
            document.getElementById('stat-games').textContent = stats.gamesPlayed || 0;
            document.getElementById('stat-wins').textContent = stats.gamesWon || 0;
            document.getElementById('stat-words').textContent = stats.totalWordsWritten || 0;
            document.getElementById('stat-best-grade').textContent = stats.bestGrade || '—';
            document.getElementById('stat-avg-score').textContent = stats.gamesPlayed
                ? Math.round((stats.totalScore || 0) / stats.gamesPlayed) : 0;
            document.getElementById('stat-streak').textContent = stats.currentStreak || 0;
        } catch (e) {
            console.error('Failed to load profile stats:', e);
        }

        // Avatar picker
        const avatarGrid = document.getElementById('profile-avatar-grid');
        if (avatarGrid && !avatarGrid.hasChildNodes()) {
            Auth.AVATARS.forEach(emoji => {
                const opt = document.createElement('div');
                opt.className = 'avatar-option' + (emoji === Auth.avatar ? ' selected' : '');
                opt.textContent = emoji;
                opt.addEventListener('click', () => {
                    avatarGrid.querySelectorAll('.avatar-option').forEach(el => el.classList.remove('selected'));
                    opt.classList.add('selected');
                    Auth.saveLocalProfile(Auth.name, emoji);
                    Auth.saveProfileToFirebase();
                    document.getElementById('profile-avatar').textContent = emoji;
                });
                avatarGrid.appendChild(opt);
            });
        }

        // Color picker
        const colorGrid = document.getElementById('profile-color-grid');
        if (colorGrid && !colorGrid.hasChildNodes()) {
            PLAYER_COLORS.forEach(c => {
                const opt = document.createElement('div');
                opt.className = 'color-option' + (c.value === selectedColor ? ' selected' : '');
                opt.style.background = c.hex;
                opt.addEventListener('click', () => {
                    colorGrid.querySelectorAll('.color-option').forEach(el => el.classList.remove('selected'));
                    opt.classList.add('selected');
                    selectedColor = c.value;
                    localStorage.setItem('wordweft_color', c.value);
                    if (Auth.uid) {
                        db.ref('users/' + Auth.uid + '/profile/color').set(c.value);
                    }
                });
                colorGrid.appendChild(opt);
            });
        }

        // Waiting music selector
        const waitGrid = document.getElementById('waiting-music-grid');
        if (waitGrid) {
            waitGrid.querySelectorAll('.btn-mode').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.waitmusic === selectedWaitingMusic);
                btn.onclick = () => {
                    waitGrid.querySelectorAll('.btn-mode').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    selectedWaitingMusic = btn.dataset.waitmusic;
                    localStorage.setItem('wordweft_waiting_music', selectedWaitingMusic);
                    if (Auth.uid) {
                        db.ref('users/' + Auth.uid + '/profile/waitingMusic').set(selectedWaitingMusic);
                    }
                };
            });
        }

        // Lobby music selector
        const musicGrid = document.getElementById('music-style-grid');
        if (musicGrid) {
            musicGrid.querySelectorAll('.btn-mode').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.music === selectedMusicStyle);
                btn.onclick = () => {
                    musicGrid.querySelectorAll('.btn-mode').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    selectedMusicStyle = btn.dataset.music;
                    localStorage.setItem('wordweft_music', selectedMusicStyle);
                    if (Auth.uid) {
                        db.ref('users/' + Auth.uid + '/profile/musicStyle').set(selectedMusicStyle);
                    }
                };
            });
        }
    }

    async function loadLeaderboard(tab) {
        const list = document.getElementById('leaderboard-list');
        list.innerHTML = '<div class="leaderboard-empty">Loading...</div>';

        try {
            const path = tab === 'weekly' ? 'leaderboard/weekly' : 'leaderboard/allTime';
            const snap = await db.ref(path).orderByChild('xp').limitToLast(50).once('value');
            const entries = [];
            snap.forEach(child => {
                entries.push({ uid: child.key, ...child.val() });
            });
            entries.sort((a, b) => (b.xp || 0) - (a.xp || 0));

            if (entries.length === 0) {
                list.innerHTML = '<div class="leaderboard-empty">No players yet. Play a game to get on the board!</div>';
                return;
            }

            list.innerHTML = '';
            // Load detailed stats for each user
            const statsPromises = entries.map(e =>
                db.ref('users/' + e.uid + '/stats').once('value').then(s => s.val()).catch(() => null)
            );
            const allStats = await Promise.all(statsPromises);

            entries.forEach((entry, i) => {
                const stats = allStats[i] || {};
                const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
                const medal = i === 0 ? '\u{1F947}' : i === 1 ? '\u{1F948}' : i === 2 ? '\u{1F949}' : '#' + (i + 1);
                const isMe = entry.uid === Auth.uid;
                const level = Auth.calculateLevel(entry.xp || 0);
                const wins = stats.gamesWon || 0;
                const games = stats.gamesPlayed || 0;
                const losses = games - wins;
                const words = stats.totalWordsWritten || 0;
                const div = document.createElement('div');
                div.className = 'lb-entry' + (isMe ? ' me' : '');
                div.innerHTML =
                    '<div class="lb-rank ' + rankClass + '">' + medal + '</div>' +
                    '<div class="lb-avatar">' + (entry.avatar || '\u{1F60A}') + '</div>' +
                    '<div class="lb-info">' +
                        '<div class="lb-name">' + (entry.displayName || 'Anonymous') + '</div>' +
                        '<div class="lb-level">Lv.' + level + ' ' + Auth.getRank(level) + '</div>' +
                        '<div class="lb-stats">' + wins + 'W ' + losses + 'L \u2022 ' + words + ' words</div>' +
                    '</div>' +
                    '<div class="lb-xp">' + (entry.xp || 0) + '<br><span class="lb-xp-label">XP</span></div>';
                list.appendChild(div);
            });
        } catch (e) {
            console.error('Failed to load leaderboard:', e);
            list.innerHTML = '<div class="leaderboard-empty">Failed to load leaderboard</div>';
        }
    }

    // --- Achievements ---
    async function checkAchievements(data, stats, myStats) {
        const uid = Auth.uid;
        if (!uid) return;

        try {
            const achRef = db.ref('users/' + uid + '/achievements');
            const achSnap = await achRef.once('value');
            const existing = achSnap.val() || {};
            const newlyUnlocked = [];

            function tryUnlock(id) {
                if (existing[id] && existing[id].unlocked) return;
                achRef.child(id).set({ unlocked: true, unlockedAt: firebase.database.ServerValue.TIMESTAMP });
                newlyUnlocked.push(id);
            }

            // Count-based achievements
            if (stats.gamesPlayed >= 1) tryUnlock('first_story');
            if (stats.gamesPlayed >= 10) tryUnlock('ten_stories');
            if (stats.gamesPlayed >= 50) tryUnlock('fifty_stories');
            if (stats.gamesWon >= 1) tryUnlock('first_win');
            if (stats.gamesWon >= 5) tryUnlock('five_wins');
            if (stats.totalWordsWritten >= 100) tryUnlock('hundred_words');
            if (stats.totalWordsWritten >= 500) tryUnlock('five_hundred_words');

            // Per-game achievements
            if (myStats && (myStats.impactScore || 0) >= 80) tryUnlock('high_impact');
            if (myStats && myStats.uniqueWords === myStats.wordCount && myStats.wordCount > 3) tryUnlock('perfect_unique');
            if (myStats && myStats.longestWord && myStats.longestWord.replace(/[^a-z]/gi,'').length >= 12) tryUnlock('long_word');
            if (data.storyGrade === 'A+') tryUnlock('a_plus');
            if ((data.genreDetected || '').toLowerCase().includes('comedy')) tryUnlock('comedy_king');
            if ((data.genreDetected || '').toLowerCase().includes('horror')) tryUnlock('horror_master');
            if (myStats && myStats.title === 'The Poet') tryUnlock('poet_title');
            if (myStats && myStats.title === 'The Action Hero') tryUnlock('action_hero');

            // Genre tracking for all_genres
            const genre = (data.genreDetected || '').toLowerCase();
            if (genre) {
                const ghRef = db.ref('users/' + uid + '/achievements/genreHistory');
                const ghSnap = await ghRef.once('value');
                const genres = ghSnap.val() || [];
                if (!genres.includes(genre)) {
                    genres.push(genre);
                    await ghRef.set(genres);
                }
                if (genres.length >= 5) tryUnlock('all_genres');
            }

            // Show toast for each new unlock
            const ACHS = Game.ACHIEVEMENTS;
            newlyUnlocked.forEach((id, i) => {
                setTimeout(() => {
                    const toast = document.getElementById('achievement-toast');
                    if (!toast || !ACHS[id]) return;
                    toast.textContent = ACHS[id].icon + ' ' + ACHS[id].name + ' Unlocked!';
                    toast.classList.remove('hidden');
                    toast.style.animation = 'none';
                    toast.offsetHeight;
                    toast.style.animation = '';
                    setTimeout(() => toast.classList.add('hidden'), 3000);
                }, i * 3200);
            });
        } catch (e) {
            console.error('Achievement check failed:', e);
        }
    }

    async function loadAchievements() {
        const grid = document.getElementById('achievements-grid');
        if (!grid) return;
        grid.innerHTML = '';

        const uid = Auth.uid;
        let unlocked = {};
        if (uid) {
            try {
                const snap = await db.ref('users/' + uid + '/achievements').once('value');
                unlocked = snap.val() || {};
            } catch (e) {}
        }

        const ACHS = Game.ACHIEVEMENTS;
        Object.entries(ACHS).forEach(([id, ach]) => {
            const isUnlocked = unlocked[id] && unlocked[id].unlocked;
            const card = document.createElement('div');
            card.className = 'achievement-card' + (isUnlocked ? '' : ' locked');
            let dateStr = '';
            if (isUnlocked && unlocked[id].unlockedAt) {
                dateStr = '<div class="ach-date">Unlocked ' + new Date(unlocked[id].unlockedAt).toLocaleDateString() + '</div>';
            }
            card.innerHTML =
                (isUnlocked ? '<span class="ach-check">\u2713</span>' : '') +
                '<div class="ach-icon">' + (isUnlocked ? ach.icon : '\u{1F512}') + '</div>' +
                '<div class="ach-name">' + ach.name + '</div>' +
                '<div class="ach-desc">' + ach.desc + '</div>' +
                dateStr;
            grid.appendChild(card);
        });
    }

    // --- Story History ---
    async function saveStory(data) {
        const uid = Auth.uid;
        if (!uid) return;
        try {
            const timestamp = Date.now();
            const entry = {
                story: data.fullStory || '',
                grade: data.storyGrade || 'C',
                genre: data.genreDetected || '',
                mood: data.moodDetected || '',
                playerNames: (Game.players || []).map(p => p.name),
                wordCount: data.totalWords || 0,
                timestamp: timestamp,
                tags: data.tags || [],
                illustration: data.illustration || ''
            };
            const histRef = db.ref('users/' + uid + '/stories');
            await histRef.child(String(timestamp)).set(entry);

            // Enforce 50-story limit
            const snap = await histRef.orderByKey().once('value');
            const keys = [];
            snap.forEach(child => keys.push(child.key));
            if (keys.length > 50) {
                const deletes = {};
                keys.slice(0, keys.length - 50).forEach(k => { deletes[k] = null; });
                await histRef.update(deletes);
            }
        } catch (e) {
            console.error('Failed to save story:', e);
        }
    }

    async function loadHistory() {
        const list = document.getElementById('history-list');
        if (!list) return;
        list.innerHTML = '<div class="leaderboard-empty">Loading...</div>';

        const uid = Auth.uid;
        if (!uid) {
            list.innerHTML = '<div class="leaderboard-empty">Sign in to see your stories</div>';
            return;
        }

        try {
            const snap = await db.ref('users/' + uid + '/stories')
                .orderByKey().limitToLast(50).once('value');
            const entries = [];
            snap.forEach(child => { entries.push({ key: child.key, ...child.val() }); });
            entries.reverse();

            if (entries.length === 0) {
                list.innerHTML = '<div class="leaderboard-empty">No stories yet. Play a game!</div>';
                return;
            }

            list.innerHTML = '';
            entries.forEach(entry => {
                const div = document.createElement('div');
                div.className = 'history-entry';
                const preview = (entry.story || '').substring(0, 80) + ((entry.story || '').length > 80 ? '...' : '');
                const date = new Date(entry.timestamp).toLocaleDateString();
                const playerCount = (entry.playerNames || []).length;

                let tagsHtml = '';
                if (entry.genre) tagsHtml += '<span class="history-tag">' + entry.genre + '</span>';
                if (entry.mood) tagsHtml += '<span class="history-tag">' + entry.mood + '</span>';

                div.innerHTML =
                    '<div class="history-header">' +
                        '<span class="history-grade-badge">' + (entry.grade || '?') + '</span>' +
                        '<div class="history-meta">' + date + ' &bull; ' + playerCount + ' players &bull; ' + (entry.wordCount || 0) + ' words</div>' +
                    '</div>' +
                    '<div class="history-preview">' + preview + '</div>' +
                    (tagsHtml ? '<div class="history-tags">' + tagsHtml + '</div>' : '') +
                    '<div class="history-actions">' +
                        '<button class="btn btn-small btn-ghost btn-share-story">Share</button>' +
                        '<button class="btn btn-small btn-ghost btn-delete-story" style="color:var(--accent-red)">Delete</button>' +
                    '</div>';

                // Bind share
                div.querySelector('.btn-share-story').addEventListener('click', () => {
                    shareStory(entry, div.querySelector('.btn-share-story'));
                });

                // Bind delete
                div.querySelector('.btn-delete-story').addEventListener('click', async () => {
                    await db.ref('users/' + uid + '/stories/' + entry.key).remove();
                    div.remove();
                    if (list.children.length === 0) {
                        list.innerHTML = '<div class="leaderboard-empty">No stories yet. Play a game!</div>';
                    }
                });

                list.appendChild(div);
            });
        } catch (e) {
            console.error('Failed to load history:', e);
            list.innerHTML = '<div class="leaderboard-empty">Failed to load stories</div>';
        }
    }

    function gradeColor(grade) {
        const g = (grade || '').charAt(0);
        if (g === 'A') return '#10B981';
        if (g === 'B') return '#6366F1';
        if (g === 'C') return '#F59E0B';
        return '#EF4444';
    }

    function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxHeight) {
        const words = text.split(' ');
        let line = '';
        let currentY = y;
        for (let i = 0; i < words.length; i++) {
            const test = line + words[i] + ' ';
            if (ctx.measureText(test).width > maxWidth && line) {
                ctx.fillText(line.trim(), x, currentY);
                line = words[i] + ' ';
                currentY += lineHeight;
                if (currentY - y > maxHeight) {
                    ctx.fillText('...', x, currentY);
                    return;
                }
            } else {
                line = test;
            }
        }
        if (line.trim()) ctx.fillText(line.trim(), x, currentY);
    }

    async function generateStoryCard(entry) {
        const canvas = document.createElement('canvas');
        canvas.width = 1080;
        canvas.height = 1920;
        const ctx = canvas.getContext('2d');

        // Background
        ctx.fillStyle = '#13111C';
        ctx.fillRect(0, 0, 1080, 1920);

        // Subtle border
        ctx.strokeStyle = 'rgba(99,102,241,0.3)';
        ctx.lineWidth = 4;
        ctx.roundRect(20, 20, 1040, 1880, 40);
        ctx.stroke();

        // Title
        ctx.fillStyle = '#8B5CF6';
        ctx.font = 'bold 48px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('WordWeft', 540, 100);

        // Illustration
        if (entry.illustration) {
            ctx.font = '100px system-ui';
            ctx.fillText(entry.illustration, 540, 230);
        }

        // Grade
        ctx.fillStyle = gradeColor(entry.grade);
        ctx.font = 'bold 180px system-ui';
        ctx.fillText(entry.grade || 'C', 540, entry.illustration ? 430 : 350);

        // Genre + mood
        ctx.fillStyle = '#9CA3AF';
        ctx.font = '36px system-ui';
        const genreMood = (entry.genre || '') + (entry.mood ? ' \u2022 ' + entry.mood : '');
        ctx.fillText(genreMood, 540, entry.illustration ? 490 : 410);

        // Tags
        const tags = entry.tags || [];
        if (tags.length > 0) {
            ctx.font = '28px system-ui';
            ctx.fillStyle = '#6366F1';
            ctx.fillText(tags.join('  \u2022  '), 540, entry.illustration ? 540 : 460);
        }

        // Story text
        const storyY = entry.illustration ? 620 : 540;
        ctx.fillStyle = '#E5E7EB';
        ctx.font = '32px system-ui';
        ctx.textAlign = 'left';
        wrapText(ctx, '\u201C' + (entry.story || '') + '\u201D', 80, storyY, 920, 44, 800);

        // Players
        ctx.fillStyle = '#6B7280';
        ctx.font = '28px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText((entry.playerNames || []).join('  \u2022  '), 540, 1780);

        // Word count
        ctx.font = '24px system-ui';
        ctx.fillText((entry.wordCount || 0) + ' words', 540, 1820);

        // Watermark
        ctx.fillStyle = '#4B5563';
        ctx.font = '24px system-ui';
        ctx.fillText('wordweft.net', 540, 1870);

        return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    }

    async function shareStory(entry, btn) {
        const shareText = 'WordWeft Story (Grade: ' + (entry.grade || '?') + ')\n\n' +
            '\u201C' + (entry.story || '') + '\u201D\n\n' +
            'Genre: ' + (entry.genre || 'Unknown') + ' | Mood: ' + (entry.mood || 'Unknown') + '\n' +
            'Players: ' + (entry.playerNames || []).join(', ');

        try {
            const blob = await generateStoryCard(entry);
            if (navigator.share && blob) {
                const file = new File([blob], 'wordweft-story.png', { type: 'image/png' });
                if (navigator.canShare && navigator.canShare({ files: [file] })) {
                    await navigator.share({ text: shareText, files: [file] });
                    return;
                }
            }
            if (navigator.share) {
                await navigator.share({ text: shareText });
                return;
            }
        } catch (e) {
            if (e.name === 'AbortError') return; // user cancelled
        }

        // Fallback: clipboard
        navigator.clipboard.writeText(shareText);
        if (btn) {
            btn.textContent = 'Copied!';
            setTimeout(() => { btn.textContent = 'Share'; }, 2000);
        }
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // --- Tutorial ---
    function showTutorialSlide(idx) {
        for (let i = 0; i < 4; i++) {
            const slide = document.getElementById('tutorial-slide-' + i);
            if (slide) slide.classList.toggle('hidden', i !== idx);
        }
        document.querySelectorAll('.tutorial-dot').forEach((d, i) => {
            d.classList.toggle('active', i === idx);
        });
        const nextBtn = document.getElementById('btn-tutorial-next');
        if (nextBtn) nextBtn.textContent = idx >= 3 ? "Let's Go!" : 'Next';
    }

    // --- Friends ---
    async function loadFriends() {
        const uid = Auth.uid;
        const card = document.getElementById('my-level-card');
        const list = document.getElementById('friends-list');

        // My level card
        if (card && uid) {
            try {
                const snap = await db.ref('users/' + uid + '/stats').once('value');
                const stats = snap.val() || {};
                const xp = stats.totalXp || 0;
                const level = Auth.calculateLevel(xp);
                card.innerHTML = '<div class="my-level-avatar">' + (Auth.avatar || '\u{1F60A}') + '</div>' +
                    '<div class="my-level-name">' + (Auth.name || 'You') + '</div>' +
                    '<div class="my-level-rank">Lv.' + level + ' ' + Auth.getRank(level) + '</div>';
            } catch (e) { card.innerHTML = ''; }
        }

        if (!list || !uid) return;
        list.innerHTML = '<div class="leaderboard-empty">Loading...</div>';

        try {
            const snap = await db.ref('users/' + uid + '/friends').once('value');
            const friends = snap.val();
            if (!friends || Object.keys(friends).length === 0) {
                list.innerHTML = '<div class="leaderboard-empty">No friends yet. Play games with others to see them here!</div>';
                return;
            }

            list.innerHTML = '';
            const entries = Object.entries(friends).sort((a, b) => (b[1].gamesTogether || 0) - (a[1].gamesTogether || 0));
            for (const [fuid, fdata] of entries) {
                // Load friend's profile
                let profile = {};
                try {
                    const pSnap = await db.ref('users/' + fuid + '/profile').once('value');
                    profile = pSnap.val() || {};
                } catch (e) {}
                let fStats = {};
                try {
                    const sSnap = await db.ref('users/' + fuid + '/stats').once('value');
                    fStats = sSnap.val() || {};
                } catch (e) {}

                const fLevel = Auth.calculateLevel(fStats.totalXp || 0);
                const wins = fdata.wins || 0;
                const losses = fdata.losses || 0;
                const games = fdata.gamesTogether || 0;

                const div = document.createElement('div');
                div.className = 'friend-entry';
                div.innerHTML =
                    '<div class="friend-avatar">' + (profile.avatar || fdata.avatar || '\u{1F60A}') + '</div>' +
                    '<div class="friend-info">' +
                        '<div class="friend-name">' + (profile.displayName || fdata.name || 'Player') + '</div>' +
                        '<div class="friend-level">Lv.' + fLevel + ' ' + Auth.getRank(fLevel) + '</div>' +
                        '<div class="friend-games">' + games + ' games together</div>' +
                    '</div>' +
                    '<div class="friend-record">' +
                        '<div class="friend-wl">' + wins + 'W - ' + losses + 'L</div>' +
                        '<div class="friend-wl-label">vs record</div>' +
                    '</div>';
                list.appendChild(div);
            }
        } catch (e) {
            console.error('Failed to load friends:', e);
            list.innerHTML = '<div class="leaderboard-empty">Failed to load friends</div>';
        }
    }

    return {
        showScreen,
        requireProfile,
        checkAchievements,
        saveStory,
        shareStory,
        get selectedMusicStyle() { return selectedMusicStyle; },
        get selectedWaitingMusic() { return selectedWaitingMusic; }
    };
})();
