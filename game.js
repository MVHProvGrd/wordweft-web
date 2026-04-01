// Game logic module for WordWeft web client
const Game = (() => {
    let players = [];
    let words = [];
    let currentPlayerIndex = 0;
    let turnWordCount = 0;
    let turnWordsNeeded = 1;
    let gameMode = 'ONE_WORD';
    let turnTimerSeconds = 0;
    let timerInterval = null;
    let timerRemaining = 0;
    let hasVotedToFinish = false;
    let finishVoteCount = 0;

    // Player color hex values for display
    const COLOR_MAP = {
        [0xFFFF6B6B]: '#FF6B6B',
        [0xFF4ECDC4]: '#4ECDC4',
        [0xFF45B7D1]: '#45B7D1',
        [0xFF96CEB4]: '#96CEB4',
        [0xFFFFEAA7]: '#FFEAA7',
        [0xFFDDA0DD]: '#DDA0DD',
        [0xFF98D8C8]: '#98D8C8',
        [0xFFF7DC6F]: '#F7DC6F'
    };

    function getPlayerColor(colorValue) {
        return COLOR_MAP[colorValue] || '#A0A0B8';
    }

    function startListening() {
        // Players
        Room.listen('players', (snap) => {
            const data = snap.val();
            if (!data) return;
            players = [];
            Object.keys(data).sort((a, b) => parseInt(a) - parseInt(b)).forEach((key) => {
                const p = data[key];
                players.push({
                    id: parseInt(key),
                    name: p.name,
                    color: p.color,
                    avatar: p.avatar || '',
                    isAI: p.isAI || false,
                    isHost: p.isHost || false,
                    uid: p.uid
                });
            });
            updatePlayerList();
            updateLobbyPlayers();
        });

        // Words
        Room.listen('words', (snap) => {
            const data = snap.val();
            const oldLength = words.length;
            words = [];
            if (data) {
                Object.keys(data).sort((a, b) => parseInt(a) - parseInt(b)).forEach((key) => {
                    const w = data[key];
                    words.push({
                        word: w.word,
                        playerId: w.playerId,
                        position: w.position
                    });
                });
            }
            renderStory(oldLength);
        });

        // Turn state
        Room.listen('turn', (snap) => {
            const data = snap.val();
            if (!data) return;
            const oldIndex = currentPlayerIndex;
            currentPlayerIndex = data.currentPlayerIndex || 0;
            turnWordCount = data.turnWordCount || 0;
            turnWordsNeeded = data.turnWordsNeeded || 1;
            updateTurnIndicator();
            updateInputState();

            // Reset timer on turn change
            if (oldIndex !== currentPlayerIndex && turnTimerSeconds > 0) {
                startTimer();
            }
        });

        // Game started
        Room.listen('meta/isStarted', (snap) => {
            if (snap.val() === true) {
                App.showScreen('game');
            }
        });

        // Game mode
        Room.listen('meta/gameMode', (snap) => {
            gameMode = snap.val() || 'ONE_WORD';
            const modeLabel = document.getElementById('game-mode-label');
            const labels = {
                'ONE_WORD': '1 Word',
                'THREE_WORDS': '3 Words',
                'FIVE_WORDS': '5 Words',
                'SENTENCE': 'Sentence',
                'CUSTOM': 'Custom'
            };
            if (modeLabel) modeLabel.textContent = labels[gameMode] || gameMode;
        });

        // Timer
        Room.listen('meta/turnTimerSeconds', (snap) => {
            turnTimerSeconds = snap.val() || 0;
        });

        // Finish votes
        Room.listen('votes/finish', (snap) => {
            finishVoteCount = snap.numChildren();
            const voteEl = document.getElementById('vote-count');
            const humanCount = players.filter(p => !p.isAI).length;
            if (voteEl) {
                voteEl.textContent = finishVoteCount > 0 ? '(' + finishVoteCount + '/' + humanCount + ')' : '';
            }
        });

        // Typing indicators
        Room.listen('typing', (snap) => {
            const data = snap.val();
            const indicator = document.getElementById('typing-indicator');
            const nameEl = document.getElementById('typing-name');
            if (!data || Object.keys(data).length === 0) {
                indicator.classList.add('hidden');
                return;
            }
            const typingIds = Object.keys(data).map(Number).filter(id => id !== Room.myIndex);
            if (typingIds.length === 0) {
                indicator.classList.add('hidden');
                return;
            }
            const typingNames = typingIds.map(id => {
                const p = players.find(pl => pl.id === id);
                return p ? p.name : '?';
            });
            indicator.classList.remove('hidden');
            nameEl.textContent = typingNames.join(', ') + ' typing...';
        });

        // Hidden objectives
        Room.listen('objectives', (snap) => {
            const data = snap.val();
            const area = document.getElementById('secret-word-area');
            const wordEl = document.getElementById('secret-word');
            if (!data) {
                area.classList.add('hidden');
                return;
            }
            // Find my objective
            const myObj = data[Room.myIndex];
            if (myObj && myObj.secretWord) {
                area.classList.remove('hidden');
                wordEl.textContent = myObj.secretWord;
                if (myObj.completed) {
                    wordEl.style.textDecoration = 'line-through';
                    wordEl.style.opacity = '0.5';
                }
            }
        });

        // Result
        Room.listen('result', (snap) => {
            const data = snap.val();
            if (!data) return;
            showResults(data);
        });
    }

    function updateLobbyPlayers() {
        const list = document.getElementById('player-list');
        const count = document.getElementById('player-count');
        if (!list) return;

        list.innerHTML = '';
        players.forEach(p => {
            const item = document.createElement('div');
            item.className = 'player-item';
            item.innerHTML = `
                <span class="player-item-avatar">${p.avatar || '\u{1F60A}'}</span>
                <span class="player-item-name" style="color: ${getPlayerColor(p.color)}">${p.name}</span>
                ${p.isHost ? '<span class="player-item-host">Host</span>' : ''}
                ${p.isAI ? '<span class="player-item-host" style="color:#F59E0B;background:rgba(245,158,11,0.15)">AI</span>' : ''}
            `;
            list.appendChild(item);
        });
        if (count) count.textContent = '(' + players.length + '/8)';

        // Enable start button for host with 2+ players
        const startBtn = document.getElementById('btn-start-game');
        if (startBtn) {
            startBtn.disabled = players.length < 2;
        }
    }

    function updatePlayerList() {
        // Update for game screen if needed
    }

    function renderStory(oldLength) {
        const textEl = document.getElementById('story-text');
        if (!textEl) return;

        if (words.length === 0) {
            textEl.innerHTML = '<span class="story-placeholder">The story begins when someone submits a word...</span>';
            return;
        }

        textEl.innerHTML = '';
        words.forEach((w, i) => {
            const span = document.createElement('span');
            span.className = 'story-word';
            const player = players.find(p => p.id === w.playerId);
            if (player) {
                span.style.color = getPlayerColor(player.color);
            } else if (w.playerId === -1) {
                // Prompt word
                span.style.color = '#666680';
                span.style.fontStyle = 'italic';
            }
            span.textContent = (i > 0 ? ' ' : '') + w.word;
            if (i >= oldLength) {
                span.classList.add('new');
            }
            textEl.appendChild(span);
        });

        // Auto-scroll to bottom
        const storyArea = document.getElementById('story-area');
        if (storyArea) {
            storyArea.scrollTop = storyArea.scrollHeight;
        }
    }

    function updateTurnIndicator() {
        const el = document.getElementById('turn-indicator');
        if (!el) return;
        const player = players[currentPlayerIndex];
        if (!player) return;

        const isMyTurn = currentPlayerIndex === Room.myIndex;
        if (isMyTurn) {
            el.innerHTML = '<span class="current-player">Your turn!</span>';
        } else {
            el.innerHTML = '<span style="color:' + getPlayerColor(player.color) + '">' +
                (player.avatar ? player.avatar + ' ' : '') + player.name + '</span>\'s turn';
        }
    }

    function updateInputState() {
        const input = document.getElementById('word-input');
        const btn = document.getElementById('btn-submit-word');
        const isMyTurn = currentPlayerIndex === Room.myIndex;

        if (input) {
            input.disabled = !isMyTurn;
            input.placeholder = isMyTurn ? getPlaceholder() : 'Wait for your turn...';
            if (isMyTurn) input.focus();
        }
        if (btn) btn.disabled = !isMyTurn;
    }

    function getPlaceholder() {
        switch (gameMode) {
            case 'ONE_WORD': return 'Type one word...';
            case 'THREE_WORDS': return 'Type three words...';
            case 'FIVE_WORDS': return 'Type five words...';
            case 'SENTENCE': return 'Type until punctuation...';
            case 'CUSTOM': return 'Type words...';
            default: return 'Type your word...';
        }
    }

    function submitWord(text) {
        text = text.trim();
        if (!text) return;
        if (currentPlayerIndex !== Room.myIndex) return;

        const wordsToSubmit = splitWords(text);
        if (!isValidSubmission(wordsToSubmit)) return;

        // Clear typing
        Room.setTyping(Room.myIndex, false);

        // Submit each word
        const submitPromises = wordsToSubmit.map(w => Room.submitWord(w, Room.myIndex));

        Promise.all(submitPromises).then(() => {
            const newCount = turnWordCount + wordsToSubmit.length;
            const needed = getWordsNeeded();

            if (needed && newCount >= needed) {
                // Turn complete
                const nextIndex = (currentPlayerIndex + 1) % players.length;
                Room.advanceTurn(nextIndex, needed);
            } else if (gameMode === 'SENTENCE') {
                const lastWord = wordsToSubmit[wordsToSubmit.length - 1];
                if (lastWord.endsWith('.') || lastWord.endsWith('!') || lastWord.endsWith('?')) {
                    const nextIndex = (currentPlayerIndex + 1) % players.length;
                    Room.advanceTurn(nextIndex, 0);
                } else {
                    Room.updateTurnWordCount(newCount);
                }
            } else {
                Room.updateTurnWordCount(newCount);
            }
        });

        // Clear input
        document.getElementById('word-input').value = '';
    }

    function splitWords(text) {
        const sanitized = text.replace(/[<>{}[\]\\|`~^]/g, '');
        if (gameMode === 'ONE_WORD') {
            const parts = sanitized.split(/[\s,;]+/).filter(w => w.length > 0);
            return parts.length > 0 ? [parts[0]] : [];
        }
        return sanitized.split(/\s+/).filter(w => w.length > 0);
    }

    function getWordsNeeded() {
        switch (gameMode) {
            case 'ONE_WORD': return 1;
            case 'THREE_WORDS': return 3;
            case 'FIVE_WORDS': return 5;
            default: return null;
        }
    }

    function isValidSubmission(wordList) {
        if (wordList.length === 0) return false;
        if (!wordList.some(w => /[a-zA-Z]/.test(w))) return false;
        return true;
    }

    function toggleFinishVote() {
        hasVotedToFinish = !hasVotedToFinish;
        if (hasVotedToFinish) {
            Room.voteFinish(Room.myIndex);
        } else {
            Room.unvoteFinish(Room.myIndex);
        }
        const btn = document.getElementById('btn-vote-finish');
        if (btn) {
            btn.style.background = hasVotedToFinish ? 'rgba(239,68,68,0.2)' : 'transparent';
            btn.style.color = hasVotedToFinish ? '#EF4444' : 'var(--text-secondary)';
        }
    }

    function startTimer() {
        if (timerInterval) clearInterval(timerInterval);
        if (turnTimerSeconds <= 0) {
            document.getElementById('timer-display').classList.add('hidden');
            return;
        }

        timerRemaining = turnTimerSeconds;
        const display = document.getElementById('timer-display');
        display.classList.remove('hidden');
        display.textContent = timerRemaining;

        timerInterval = setInterval(() => {
            timerRemaining--;
            display.textContent = timerRemaining;
            display.className = 'timer-display' + (timerRemaining <= 5 ? ' urgent' : '');

            if (timerRemaining <= 0) {
                clearInterval(timerInterval);
                // Auto-advance turn if it's our turn
                if (currentPlayerIndex === Room.myIndex) {
                    const input = document.getElementById('word-input');
                    const text = input ? input.value.trim() : '';
                    if (text) {
                        submitWord(text);
                    } else {
                        // Skip turn
                        const nextIndex = (currentPlayerIndex + 1) % players.length;
                        Room.advanceTurn(nextIndex, getWordsNeeded() || 1);
                    }
                }
            }
        }, 1000);
    }

    function showResults(data) {
        if (timerInterval) clearInterval(timerInterval);

        App.showScreen('results');

        document.getElementById('result-grade').textContent = data.storyGrade || 'C';
        document.getElementById('result-genre').textContent =
            (data.genreDetected || '') + (data.moodDetected ? ' \u2022 ' + data.moodDetected : '');
        document.getElementById('result-story-text').textContent = data.fullStory || '';

        // Score bars
        const scores = [
            { id: 'coherence', value: data.coherenceScore || 0, color: 'score-coherence' },
            { id: 'creativity', value: data.creativityScore || 0, color: 'score-creativity' },
            { id: 'humor', value: data.humorScore || 0, color: 'score-humor' },
            { id: 'vocabulary', value: data.vocabularyScore || 0, color: 'score-vocabulary' },
            { id: 'flow', value: data.flowScore || 0, color: 'score-flow' }
        ];
        scores.forEach(s => {
            const bar = document.getElementById('bar-' + s.id);
            const val = document.getElementById('score-' + s.id);
            if (bar) {
                bar.className = 'score-fill ' + s.color;
                setTimeout(() => { bar.style.width = s.value + '%'; }, 100);
            }
            if (val) val.textContent = s.value;
        });

        // Player stats
        const statsList = document.getElementById('player-stats-list');
        statsList.innerHTML = '';
        if (data.playerStats) {
            const statsArray = Array.isArray(data.playerStats) ? data.playerStats : Object.values(data.playerStats);
            statsArray.sort((a, b) => (b.impactScore || 0) - (a.impactScore || 0));
            statsArray.forEach(ps => {
                const card = document.createElement('div');
                card.className = 'player-stat-card';
                card.innerHTML = `
                    <div class="player-stat-header">
                        <span class="player-stat-avatar">${ps.playerAvatar || '\u{1F60A}'}</span>
                        <div style="flex:1">
                            <div class="player-stat-name">${ps.playerName || ps.player?.name || '?'}</div>
                            <div class="player-stat-title">${ps.title || ''}</div>
                        </div>
                        <span class="player-stat-impact">${ps.impactScore || 0}</span>
                    </div>
                    <div class="player-stat-details">
                        <span>${ps.wordCount || 0} words</span>
                        <span>${ps.languageLevel || 'A1'} ${ps.languageLevelName || ''}</span>
                        <span>Best: ${ps.bestWord || '-'}</span>
                    </div>
                `;
                statsList.appendChild(card);
            });
        }
    }

    function cleanup() {
        if (timerInterval) clearInterval(timerInterval);
        players = [];
        words = [];
        currentPlayerIndex = 0;
        turnWordCount = 0;
        hasVotedToFinish = false;
        finishVoteCount = 0;
    }

    return {
        startListening,
        submitWord,
        toggleFinishVote,
        cleanup,
        get players() { return players; },
        get words() { return words; },
        get currentPlayerIndex() { return currentPlayerIndex; },
        get gameMode() { return gameMode; }
    };
})();
