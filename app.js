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

        // Lobby
        document.getElementById('btn-lobby-back').addEventListener('click', () => {
            Room.leave();
            Game.cleanup();
            showScreen('home');
        });

        document.getElementById('btn-copy-code').addEventListener('click', () => {
            if (typeof Sound !== 'undefined') Sound.playClick();
            const code = document.getElementById('lobby-room-code').textContent;
            navigator.clipboard.writeText(code).then(() => {
                const btn = document.getElementById('btn-copy-code');
                btn.textContent = 'Copied!';
                setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
            });
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

        // Add bot button
        document.getElementById('btn-add-bot').addEventListener('click', () => {
            Room.addBot();
        });

        document.getElementById('btn-start-game').addEventListener('click', () => {
            if (typeof Sound !== 'undefined') Sound.playGameStart();
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
        }
    }

    async function loadProfile() {
        document.getElementById('profile-avatar').textContent = Auth.avatar || '\u{1F60A}';
        document.getElementById('profile-name').textContent = Auth.name || 'Guest';

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
            entries.forEach((entry, i) => {
                const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
                const isMe = entry.uid === Auth.uid;
                const div = document.createElement('div');
                div.className = 'lb-entry' + (isMe ? ' me' : '');
                div.innerHTML =
                    '<div class="lb-rank ' + rankClass + '">' + (i + 1) + '</div>' +
                    '<div class="lb-avatar">' + (entry.avatar || '\u{1F60A}') + '</div>' +
                    '<div class="lb-info">' +
                        '<div class="lb-name">' + (entry.displayName || 'Anonymous') + '</div>' +
                        '<div class="lb-level">Lv.' + Auth.calculateLevel(entry.xp || 0) + ' ' + Auth.getRank(Auth.calculateLevel(entry.xp || 0)) + '</div>' +
                    '</div>' +
                    '<div class="lb-xp">' + (entry.xp || 0) + ' XP</div>';
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
                dateStr = '<div class="ach-date">' + new Date(unlocked[id].unlockedAt).toLocaleDateString() + '</div>';
            }
            card.innerHTML =
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
                        '<button class="btn btn-small btn-ghost btn-share-story">Copy</button>' +
                        '<button class="btn btn-small btn-ghost btn-delete-story" style="color:var(--accent-red)">Delete</button>' +
                    '</div>';

                // Bind copy
                div.querySelector('.btn-share-story').addEventListener('click', () => {
                    navigator.clipboard.writeText(entry.story || '').then(() => {
                        const btn = div.querySelector('.btn-share-story');
                        btn.textContent = 'Copied!';
                        setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
                    });
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

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    return {
        showScreen,
        requireProfile,
        checkAchievements,
        saveStory
    };
})();
