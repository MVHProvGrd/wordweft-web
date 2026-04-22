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

        // Check for rejoinable game
        if (!roomParam) {
            const activeRoom = Room.getActiveRoom();
            if (activeRoom) {
                showRejoinPrompt(activeRoom.code, activeRoom.playerIndex);
            }
        }

        bindEvents();

        // Start home music on first user interaction (AudioContext needs gesture)
        // Lobby music plays everywhere except during a match
        const startHomeMusic = () => {
            if (typeof Sound !== 'undefined' && selectedMusicStyle !== 'none') {
                Sound.startMusic(selectedMusicStyle || 'jazz');
            }
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
            requireProfile(() => {
                const dlg = document.getElementById('host-mode-dialog');
                if (!dlg) { createRoom(); return; }
                // Disable the Public option for anonymous users — same gate
                // as Android. Anonymous accounts can't be banned for griefing.
                const publicBtn = document.getElementById('btn-host-public');
                const publicHint = document.getElementById('host-public-hint');
                const canHostPublic = !Auth.isAnonymous;
                if (publicBtn) publicBtn.disabled = !canHostPublic;
                if (publicHint) publicHint.classList.toggle('hidden', canHostPublic);
                dlg.classList.remove('hidden');
            });
        });

        // Host-mode dialog wiring
        const hostModeDialog = document.getElementById('host-mode-dialog');
        if (hostModeDialog) {
            document.getElementById('btn-host-private').addEventListener('click', () => {
                hostModeDialog.classList.add('hidden');
                createRoom({ isPublic: false });
            });
            document.getElementById('btn-host-public').addEventListener('click', () => {
                if (document.getElementById('btn-host-public').disabled) return;
                hostModeDialog.classList.add('hidden');
                createRoom({ isPublic: true });
            });
            document.getElementById('btn-host-cancel').addEventListener('click', () => {
                hostModeDialog.classList.add('hidden');
            });
        }

        // Find Public Game — public-lobbies discovery screen.
        const btnFindPublic = document.getElementById('btn-find-public');
        if (btnFindPublic) {
            btnFindPublic.addEventListener('click', () => {
                if (typeof Sound !== 'undefined') Sound.playClick();
                requireProfile(() => showScreen('public-lobbies'));
            });
        }

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
            btn.textContent = 'Shared!';
            setTimeout(() => { btn.textContent = 'Share'; }, 2000);
        });

        document.getElementById('btn-invite-friends').addEventListener('click', () => {
            document.getElementById('btn-copy-code').click();
        });

        // Game mode selector — selectedMode lives at module scope (hoisted above).
        function refreshObjectivesAvailability() {
            const toggle = document.getElementById('toggle-objectives');
            const group = document.getElementById('objectives-setting-group');
            const desc = document.getElementById('objectives-setting-desc');
            if (!toggle || !group) return;
            const oneWord = selectedMode === 'ONE_WORD';
            toggle.disabled = oneWord;
            group.style.opacity = oneWord ? '0.5' : '';
            if (desc) {
                desc.textContent = oneWord
                    ? 'Not available in One-Word mode'
                    : 'Each player gets a secret word to sneak into the story';
            }
            if (oneWord && toggle.checked) {
                toggle.checked = false;
                objectivesEnabled = false;
            }
        }
        document.querySelectorAll('.btn-mode').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.btn-mode').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                selectedMode = btn.dataset.mode;
                refreshObjectivesAvailability();
                Room.updateLobbyMode(selectedMode);
            });
        });
        refreshObjectivesAvailability();

        // Story starter selector
        document.querySelectorAll('.btn-starter').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.btn-starter').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                selectedStarter = btn.dataset.starter;
                Room.updateLobbyStarter(selectedStarter);
            });
        });

        // Timer selector — restore last choice from localStorage so it sticks across games
        try {
            const savedTimer = parseInt(localStorage.getItem('wordweft_timer'));
            if (!isNaN(savedTimer)) selectedTimer = savedTimer;
        } catch (e) {}
        document.querySelectorAll('.btn-timer').forEach(btn => {
            const v = parseInt(btn.dataset.timer) || 0;
            btn.classList.toggle('active', v === selectedTimer);
            btn.addEventListener('click', () => {
                document.querySelectorAll('.btn-timer').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                selectedTimer = parseInt(btn.dataset.timer) || 0;
                try { localStorage.setItem('wordweft_timer', String(selectedTimer)); } catch (e) {}
                Room.updateLobbyTimer(selectedTimer);
            });
        });

        // Hidden objectives toggle
        document.getElementById('toggle-objectives').addEventListener('change', (e) => {
            objectivesEnabled = e.target.checked;
            Room.updateLobbyObjectives(objectivesEnabled);
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
            // Generate hidden objectives if enabled (not in ONE_WORD mode — secret words don't fit)
            if (objectivesEnabled && selectedMode !== 'ONE_WORD') {
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
            Screens.loadLeaderboard('alltime');
            showScreen('leaderboard');
        });
        document.getElementById('btn-leaderboard-back').addEventListener('click', () => {
            showScreen('home');
        });
        document.querySelectorAll('.btn-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.btn-tab').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                Screens.loadLeaderboard(btn.dataset.tab);
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
            Screens.loadAchievements();
            showScreen('achievements');
        });
        document.getElementById('btn-achievements-back').addEventListener('click', () => {
            showScreen('home');
        });

        // Story History
        document.getElementById('btn-history').addEventListener('click', (e) => {
            e.preventDefault();
            Screens.loadHistory();
            showScreen('history');
        });
        document.getElementById('btn-history-back').addEventListener('click', () => {
            showScreen('home');
        });

        // Friends
        document.getElementById('btn-friends').addEventListener('click', (e) => {
            e.preventDefault();
            Screens.loadFriends();
            showScreen('friends');
        });
        document.getElementById('btn-friends-back').addEventListener('click', () => {
            showScreen('home');
        });

        // Tutorial
        let tutorialSlide = 0;
        document.getElementById('btn-tutorial-next').addEventListener('click', () => {
            tutorialSlide++;
            if (tutorialSlide >= 5) {
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
                Sound.startMusic(selectedWaitingMusic || 'jazz', true);
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
                Sound.startMusic(selectedMusicStyle || 'jazz', true);
                btn.innerHTML = '&#9632; Stop';
                previewPlaying = true;
            }
        });

        // Theme toggle
        const themeToggle = document.getElementById('theme-toggle');
        themeToggle.checked = darkTheme;
        themeToggle.addEventListener('change', () => {
            darkTheme = themeToggle.checked;
            document.body.classList.toggle('light-theme', !darkTheme);
            localStorage.setItem('wordweft_theme', darkTheme ? 'dark' : 'light');
            document.querySelector('meta[name="theme-color"]').content = darkTheme ? '#0F0F23' : '#F5F5FA';
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
    // Lobby music plays everywhere except in-match; waiting music plays in-match when waiting for others
    let darkTheme = localStorage.getItem('wordweft_theme') !== 'light';

    // Apply theme on load
    if (!darkTheme) document.body.classList.add('light-theme');
    let selectedStarter = '';
    let selectedTimer = 0;
    let objectivesEnabled = false;
    let selectedMode = 'ONE_WORD';  // hoisted so createRoom() can broadcast initial settings

    // Joiner waiting-panel state. When joining an online room as non-host
    // we mirror the host's lobby selections live and run a fun animation
    // (matches Android WaitingForHostPanel).
    const MODE_LABELS = {
        'ONE_WORD': '1 Word',
        'THREE_WORDS': '3 Words',
        'FIVE_WORDS': '5 Words',
        'SENTENCE': 'Sentence',
        'CUSTOM': 'Custom'
    };
    const STARTER_LABELS = {
        '': 'Free Play',
        'Once upon a time': 'Once Upon a Time',
        'The spaceship launched into': 'Space Adventure',
        'The detective found a': 'Mystery',
        'In the dark forest': 'Horror Night',
        'They first met at': 'Love Story',
        'The warrior raised their': 'Epic Battle',
        'The time machine activated and': 'Time Travel',
        'The chef accidentally added': 'Cooking Disaster',
        'The clever fox decided to': 'Animal Kingdom',
        'The ordinary person suddenly gained': 'Superhero Origin',
        'Stranded on the island they': 'Desert Island'
    };
    const WAITING_MESSAGES = [
        'Sharpening pencils\u2026',
        'Brewing fresh ideas\u2026',
        'Threading the loom\u2026',
        'Warming up the typewriter\u2026',
        'Stretching imagination\u2026',
        'Polishing punctuation\u2026',
        'Untangling plot threads\u2026',
        'Picking the perfect words\u2026'
    ];
    let waitingMessageTimer = null;
    let waitingDotsTimer = null;
    let waitingHostMode = 'ONE_WORD';

    function teardownLobbyJoinerView() {
        if (waitingMessageTimer) { clearInterval(waitingMessageTimer); waitingMessageTimer = null; }
        if (waitingDotsTimer) { clearInterval(waitingDotsTimer); waitingDotsTimer = null; }
    }

    function setupLobbyJoinerView() {
        teardownLobbyJoinerView();
        const panel = document.getElementById('lobby-waiting-panel');
        const status = document.getElementById('lobby-status');
        if (!panel) return;
        // Show the new animated panel; hide the legacy one-line status.
        panel.classList.remove('hidden');
        if (status) status.classList.add('hidden');

        // Cycling fun message
        const msgEl = document.getElementById('waiting-message');
        let msgIdx = 0;
        if (msgEl) msgEl.textContent = WAITING_MESSAGES[0];
        waitingMessageTimer = setInterval(() => {
            msgIdx = (msgIdx + 1) % WAITING_MESSAGES.length;
            if (!msgEl) return;
            msgEl.style.opacity = 0;
            setTimeout(() => {
                msgEl.textContent = WAITING_MESSAGES[msgIdx];
                msgEl.style.opacity = 1;
            }, 250);
        }, 2600);

        // Three-dot cycle after "Waiting for host"
        const dotsEl = document.getElementById('waiting-dots');
        let dotPhase = 0;
        if (dotsEl) dotsEl.textContent = '';
        waitingDotsTimer = setInterval(() => {
            dotPhase = (dotPhase + 1) % 4;
            if (dotsEl) dotsEl.textContent = '.'.repeat(dotPhase);
        }, 450);

        // Mirror host's settings from Firebase. Room.listen registers via the
        // shared listener registry so leave() cleans these up automatically.
        const modeEl = document.getElementById('lobby-host-mode');
        const timerEl = document.getElementById('lobby-host-timer');
        const starterEl = document.getElementById('lobby-host-starter');
        const objEl = document.getElementById('lobby-host-objectives');
        const objRow = document.getElementById('lobby-host-objectives-row');

        function refreshObjectivesRow() {
            if (!objRow) return;
            objRow.style.display = (waitingHostMode === 'ONE_WORD') ? 'none' : '';
        }

        Room.listen('meta/gameMode', (snap) => {
            waitingHostMode = snap.val() || 'ONE_WORD';
            if (modeEl) modeEl.textContent = MODE_LABELS[waitingHostMode] || waitingHostMode;
            refreshObjectivesRow();
        });
        Room.listen('meta/turnTimerSeconds', (snap) => {
            const sec = snap.val() || 0;
            if (timerEl) timerEl.textContent = sec === 0 ? 'Off' : (sec + 's');
        });
        Room.listen('meta/storyStarter', (snap) => {
            const starter = snap.val() || '';
            const label = STARTER_LABELS[starter] || (starter ? starter : 'Free Play');
            if (starterEl) starterEl.textContent = label;
        });
        Room.listen('meta/hiddenObjectivesEnabled', (snap) => {
            if (objEl) objEl.textContent = snap.val() ? 'On' : 'Off';
        });
    }

    function hideLobbyJoinerView() {
        teardownLobbyJoinerView();
        const panel = document.getElementById('lobby-waiting-panel');
        if (panel) panel.classList.add('hidden');
    }

    // ── Public lobbies discovery ─────────────────────────────────────
    let publicRoomsCallback = null;
    function setupPublicLobbiesView() {
        teardownPublicLobbiesView();
        const list = document.getElementById('public-rooms-list');
        if (!list) return;
        list.innerHTML = '<div class="public-empty">Loading\u2026</div>';
        publicRoomsCallback = (rooms) => renderPublicRooms(rooms);
        Room.listenPublicRooms(publicRoomsCallback);
    }
    function teardownPublicLobbiesView() {
        if (publicRoomsCallback) {
            Room.unlistenPublicRooms(publicRoomsCallback);
            publicRoomsCallback = null;
        }
    }
    function modeLabelFor(name) {
        return MODE_LABELS[name] || name || 'Unknown';
    }
    function starterLabelFor(starter) {
        return STARTER_LABELS[starter || ''] || (starter ? starter : 'Free Play');
    }
    function renderPublicRooms(rooms) {
        const list = document.getElementById('public-rooms-list');
        if (!list) return;
        list.innerHTML = '';
        if (!rooms || rooms.length === 0) {
            list.innerHTML = '<div class="public-empty">' +
                '<div class="public-empty-emoji">\uD83C\uDFAE</div>' +
                '<div class="public-empty-title">No public games right now</div>' +
                '<div class="public-empty-sub">Try hosting one!</div>' +
                '</div>';
            return;
        }
        rooms.forEach((r) => {
            const full = (r.playerCount || 0) >= (r.maxPlayers || 8);
            const card = document.createElement('div');
            card.className = 'public-room-card' + (full ? ' is-full' : '');
            const timerLabel = r.turnTimerSeconds === 0 ? 'Off' : (r.turnTimerSeconds + 's');
            card.innerHTML =
                '<div class="public-room-avatar">' + (r.hostAvatar || '\uD83D\uDE0A') + '</div>' +
                '<div class="public-room-info">' +
                    '<div class="public-room-host">' + (r.hostName || 'Player') + '</div>' +
                    '<div class="public-room-meta">' +
                        modeLabelFor(r.gameMode) + ' \u2022 ' + timerLabel + ' \u2022 ' +
                        starterLabelFor(r.storyStarter) +
                    '</div>' +
                    (r.hiddenObjectivesEnabled
                        ? '<div class="public-room-objectives">Hidden Objectives</div>'
                        : '') +
                '</div>' +
                '<div class="public-room-count">' +
                    '<div class="public-room-count-num">' + (r.playerCount || 0) + '/' + (r.maxPlayers || 8) + '</div>' +
                    '<div class="public-room-count-label">' + (full ? 'Full' : 'Open') + '</div>' +
                '</div>';
            if (!full) {
                card.addEventListener('click', () => {
                    if (typeof Sound !== 'undefined') Sound.playClick();
                    teardownPublicLobbiesView();
                    joinRoom(r.code);
                });
            }
            list.appendChild(card);
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
            // Reject profane / reserved / leetspeak-bypassed names so they
            // don't reach the leaderboard, friends list, or other players.
            if (typeof Game !== 'undefined' && Game.rejectUsername) {
                const reason = Game.rejectUsername(name);
                if (reason) { Game.showToast(reason, '#EF4444'); return; }
            }
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
        const objectives = {};
        const usedWords = new Set();
        for (let i = 0; i < players.length; i++) {
            const cat = categories[Math.floor(Math.random() * categories.length)];
            const pool = SECRET_WORD_POOLS[cat].filter(w => !usedWords.has(w));
            if (pool.length === 0) continue;
            const word = pool[Math.floor(Math.random() * pool.length)];
            usedWords.add(word);
            objectives[i] = { secretWord: word, playerId: i, completed: false, busted: false };
        }
        if (Room.ref) {
            Room.ref.child('objectives').set(objectives);
            Room.ref.child('meta/hiddenObjectivesEnabled').set(true);
        }
    }

    async function createRoom(opts) {
        const wantPublic = !!(opts && opts.isPublic);
        if (wantPublic && Auth.isAnonymous) {
            if (typeof Game !== 'undefined' && Game.showToast) {
                Game.showToast('Sign in with Google to host a public game.', '#EF4444');
            } else {
                alert('Sign in with Google to host a public game.');
            }
            return;
        }
        const code = await Room.create(Auth.name, Auth.avatar, selectedColor, { isPublic: wantPublic });
        if (code) {
            document.getElementById('lobby-room-code').textContent = code;
            document.getElementById('game-room-code').textContent = code;
            document.getElementById('lobby-host-controls').classList.remove('hidden');
            document.getElementById('lobby-status').textContent = wantPublic
                ? 'Your lobby is public \u2014 anyone can find and join it.'
                : 'Share the room code with friends!';
            document.getElementById('lobby-status').classList.remove('hidden');
            hideLobbyJoinerView();
            Game.startListening();
            // Push current local lobby selections to Firebase so any joiner who
            // arrives between room-create and start sees the host's real choices.
            Room.updateLobbyMode(selectedMode);
            Room.updateLobbyTimer(selectedTimer);
            Room.updateLobbyObjectives(objectivesEnabled);
            Room.updateLobbyStarter(selectedStarter);
            showScreen('lobby');
            if (typeof Sound !== 'undefined') Sound.startMusic(selectedMusicStyle || 'jazz');
        } else {
            alert('Failed to create room. Please try again.');
        }
    }

    function showRejoinPrompt(code, playerIndex) {
        // Create a simple modal overlay for the rejoin prompt
        const overlay = document.createElement('div');
        overlay.id = 'rejoin-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999';
        overlay.innerHTML = `
            <div style="background:var(--bg-card,#1a1a2e);border-radius:16px;padding:24px;max-width:340px;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,0.3)">
                <h3 style="margin:0 0 8px;color:var(--text-primary,#fff)">Rejoin Game?</h3>
                <p style="color:var(--text-secondary,#a0a0b8);margin:0 0 20px;font-size:14px">
                    You have an ongoing game in room <strong style="color:var(--accent,#6366f1)">${code}</strong>. Would you like to rejoin?
                </p>
                <div style="display:flex;gap:12px;justify-content:center">
                    <button id="rejoin-dismiss" style="padding:8px 20px;border-radius:8px;border:1px solid var(--border,#333);background:transparent;color:var(--text-secondary,#a0a0b8);cursor:pointer;font-size:14px">Leave Game</button>
                    <button id="rejoin-confirm" style="padding:8px 20px;border-radius:8px;border:none;background:var(--accent,#6366f1);color:#fff;cursor:pointer;font-size:14px;font-weight:600">Rejoin</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        document.getElementById('rejoin-confirm').addEventListener('click', async () => {
            overlay.remove();
            await rejoinRoom(code, playerIndex);
        });
        document.getElementById('rejoin-dismiss').addEventListener('click', () => {
            overlay.remove();
            Room.clearActiveRoom();
        });
    }

    async function rejoinRoom(code, playerIndex) {
        try {
            const success = await Room.rejoin(code, playerIndex);
            if (!success) {
                Room.clearActiveRoom();
                alert('Game is no longer available.');
                return;
            }
            document.getElementById('lobby-room-code').textContent = code;
            document.getElementById('game-room-code').textContent = code;
            Game.startListening();
            // If game is already started, go straight to game screen
            const meta = await db.ref('rooms/' + code + '/meta').once('value');
            if (meta.val() && meta.val().isStarted) {
                hideLobbyJoinerView();
                showScreen('game');
            } else {
                document.getElementById('lobby-host-controls').classList.toggle('hidden', !Room.isHost);
                document.getElementById('lobby-status').textContent = Room.isHost ? '' : 'Waiting for host to start...';
                if (Room.isHost) hideLobbyJoinerView();
                else setupLobbyJoinerView();
                showScreen('lobby');
            }
        } catch (e) {
            Room.clearActiveRoom();
            alert('Failed to rejoin: ' + (e.message || 'Unknown error'));
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
            setupLobbyJoinerView();
            showScreen('lobby');
            if (typeof Sound !== 'undefined') Sound.startMusic(selectedMusicStyle || 'jazz');
        } catch (e) {
            alert(e.message || 'Failed to join room');
        }
    }

    function showScreen(name) {
        // Stop TTS when navigating
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();

        // Stop the joiner waiting animation when leaving the lobby so timers
        // don't keep running across screens.
        if (name !== 'lobby') hideLobbyJoinerView();
        // Detach the public-rooms listener when leaving the discovery screen.
        if (name !== 'public-lobbies') teardownPublicLobbiesView();
        // ...and attach when entering it.
        if (name === 'public-lobbies') setupPublicLobbiesView();

        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        const screen = document.getElementById('screen-' + name);
        if (screen) screen.classList.add('active');

        // Clean up URL params when leaving game
        if (name === 'home') {
            window.history.replaceState({}, '', window.location.pathname);
            // Play lobby music on home screen (lobby music plays everywhere except in-match)
            if (typeof Sound !== 'undefined') {
                if (selectedMusicStyle === 'none') {
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
            if (typeof Game !== 'undefined' && Game.rejectUsername) {
                const reason = Game.rejectUsername(newName);
                if (reason) { Game.showToast(reason, '#EF4444'); return; }
            }
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

        const deleteBtn = document.getElementById('btn-profile-delete');
        if (deleteBtn) {
            deleteBtn.onclick = async () => {
                const ok = confirm(
                    "Delete your account?\n\n" +
                    "This permanently deletes your profile, progress, leaderboard " +
                    "entries, and friends list. Stories you co-authored with others " +
                    "remain visible to those players but lose your attribution.\n\n" +
                    "This cannot be undone."
                );
                if (!ok) return;
                const result = await Auth.deleteAccount();
                if (result === 'success') {
                    alert('Account deleted.');
                    loadProfile();
                } else if (result === 'requires-reauth') {
                    alert(
                        "For your security, Google requires a recent sign-in before " +
                        "a permanent account can be deleted. Sign out, sign back in " +
                        "with Google, then try Delete again."
                    );
                } else if (result === 'no-user') {
                    alert('Not signed in.');
                } else {
                    alert('Delete failed — try again or email wordweftgame@gmail.com.');
                }
            };
        }

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
            document.getElementById('stat-streak').textContent = stats.dayStreak || 0;
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

    // loadLeaderboard, checkAchievements, loadAchievements, saveStory, loadHistory,
    // gradeColor, wrapText, wrapColoredText, generateStoryCard, shareStory
    // are now in the Screens module (screens.js)


    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // --- Tutorial ---
    function showTutorialSlide(idx) {
        for (let i = 0; i < 5; i++) {
            const slide = document.getElementById('tutorial-slide-' + i);
            if (slide) slide.classList.toggle('hidden', i !== idx);
        }
        document.querySelectorAll('.tutorial-dot').forEach((d, i) => {
            d.classList.toggle('active', i === idx);
        });
        const nextBtn = document.getElementById('btn-tutorial-next');
        if (nextBtn) nextBtn.textContent = idx >= 4 ? "Let's Go!" : 'Next';
    }

    // --- Friends ---
    // loadFriends is now in the Screens module (screens.js)


    return {
        showScreen,
        requireProfile,
        checkAchievements: (...args) => Screens.checkAchievements(...args),
        saveStory: (...args) => Screens.saveStory(...args),
        shareStory: (...args) => Screens.shareStory(...args),
        get selectedMusicStyle() { return selectedMusicStyle; },
        get selectedWaitingMusic() { return selectedWaitingMusic; }
    };
})();
